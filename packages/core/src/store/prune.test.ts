import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Evidence, RunResult } from '../contracts/index.ts';
import { DEFAULT_PRUNE_POLICY } from './prune.ts';
import { openStore, type Store, type StoreOptions } from './store.ts';

/**
 * Real files in a temp directory, because half of what pruning does is unlink a body the
 * database only holds a path to, and a fake filesystem would not prove that half.
 */
let dir: string;
const stores: Store[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qai-store-prune-'));
});

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  rmSync(dir, { recursive: true, force: true });
});

function open(options: StoreOptions = {}, at = dir): Store {
  const store = openStore(at, options);
  stores.push(store);
  return store;
}

function run(runId: string, startedAt: string): RunResult {
  return {
    resultVersion: '0.1',
    runId,
    toolVersion: '0.1.0',
    startedAt,
    finishedAt: startedAt,
    spec: { hash: 'sha256:abc', specVersion: '0.1', files: ['spec/app.spec.yaml'] },
    target: { baseUrl: 'http://127.0.0.1:3000' },
    requirements: [
      { requirementId: 'REQ-001', verdict: 'verified', reason: 'ok', checkIds: ['CHK-a'] },
    ],
    checks: [
      {
        checkId: 'CHK-a',
        type: 'access',
        requirementId: 'REQ-001',
        verdict: 'pass',
        deterministic: true,
        severity: 'info',
        title: 'A check',
        evidence: ['EV-000001'],
      },
    ],
    structural: { specifiedNotObserved: [], observedNotSpecified: [], fieldMismatches: [] },
    summary: {
      requirements: { total: 1, verified: 1, failed: 0, unverified: 0 },
      checks: { total: 1, pass: 1, fail: 0, inconclusive: 0 },
      coverage: 1,
      findingsBySeverity: { high: 0, medium: 0, low: 0, info: 0 },
      modelAssistedCheckCount: 0,
    },
    unverifiedReasons: [],
  } as RunResult;
}

function evidence(id: string, bodyRef: string | undefined): Evidence {
  return {
    id,
    kind: 'http',
    capturedAt: '2026-08-18T00:00:05Z',
    actorId: 'owner',
    request: { method: 'GET', url: '/api/x', headers: { authorization: '[redacted]' } },
    ...(bodyRef === undefined
      ? {}
      : { response: { status: 200, headers: {}, bodyRef, truncated: false } }),
    redactions: ['request.headers.authorization'],
  } as Evidence;
}

/** Puts a body where the capture writer would have. */
function writeBody(bodyRef: string): string {
  const target = join(dir, bodyRef);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, '{"request":{},"response":{}}\n', 'utf8');
  return target;
}

/** An hour apart, so ordering is the run's own and not the tiebreak's. */
function startedAt(index: number): string {
  return `2026-08-18T${index.toString().padStart(2, '0')}:00:00Z`;
}

/**
 * `count` runs, oldest first, each carrying one evidence record with its own body file.
 *
 * Every id is distinct here so a test says what it means. The case where two runs share
 * one body path has its own test, because that is what the real id source does.
 */
function fill(store: Store, count: number, withEvidence = true): void {
  for (let index = 0; index < count; index += 1) {
    const bodyRef = `.qai/evidence/EV-${index}.json`;
    if (withEvidence) writeBody(bodyRef);
    store.saveRun(
      run(`RUN-${index.toString().padStart(2, '0')}`, startedAt(index)),
      withEvidence ? [evidence(`EV-${index}`, bodyRef)] : [],
    );
  }
}

describe('the retention window', () => {
  it('keeps the most recent runs and names the ones it removed', () => {
    const store = open();
    fill(store, 4, false);

    const report = store.pruneEvidence({ keepRuns: 2, keepEvidence: 2 });

    expect(report.runsRemoved).toStrictEqual(['RUN-01', 'RUN-00']);
    expect(report.runsRetained).toBe(2);
    expect(store.listRuns({ limit: 100 }).map((one) => one.runId)).toStrictEqual([
      'RUN-03',
      'RUN-02',
    ]);
  });

  it('defaults to the window the module states', () => {
    // Twenty runs and the evidence for five. Pinned because it is a product decision
    // written down in the module, and the behaviour that follows from it is tested
    // through a real write below rather than against this constant.
    expect(DEFAULT_PRUNE_POLICY).toStrictEqual({ keepRuns: 20, keepEvidence: 5 });
  });

  it('keeps evidence for the newest few runs only, and keeps the runs themselves', () => {
    const store = open();
    fill(store, 4);

    const report = store.pruneEvidence({ keepRuns: 4, keepEvidence: 2 });

    expect(report.runsRemoved).toStrictEqual([]);
    expect(report.evidenceRemoved.map((one) => one.runId)).toStrictEqual(['RUN-00', 'RUN-01']);
    // The runs survive their evidence. A verdict is still readable when the artifact
    // behind it has aged out.
    expect(store.getRun('RUN-00')?.runId).toBe('RUN-00');
    expect(store.listRuns({ limit: 100 })).toHaveLength(4);
  });

  it('takes the evidence of a removed run with it', () => {
    const store = open();
    fill(store, 3);

    const report = store.pruneEvidence({ keepRuns: 1, keepEvidence: 1 });

    expect(report.runsRemoved).toStrictEqual(['RUN-01', 'RUN-00']);
    expect(report.evidenceRemoved.map((one) => one.evidenceId)).toStrictEqual(['EV-0', 'EV-1']);
    expect(store.getRun('RUN-00')).toBeNull();
  });

  it('removes the rows rather than only reporting them', () => {
    // A second pass over an already pruned store has nothing left to say. Without this a
    // pruner that reported everything and deleted nothing would pass every test above.
    const store = open();
    fill(store, 4);

    store.pruneEvidence({ keepRuns: 2, keepEvidence: 1 });
    const second = store.pruneEvidence({ keepRuns: 2, keepEvidence: 1 });

    expect(second.runsRemoved).toStrictEqual([]);
    expect(second.evidenceRemoved).toStrictEqual([]);
    expect(second.bodiesDeleted).toStrictEqual([]);
  });

  it('prunes nothing when the store is inside both windows', () => {
    const store = open();
    fill(store, 3);

    const report = store.pruneEvidence({ keepRuns: 20, keepEvidence: 5 });

    expect(report).toMatchObject({
      runsRemoved: [],
      evidenceRemoved: [],
      bodiesDeleted: [],
      bodiesMissing: [],
      bodiesStillReferenced: [],
      runsRetained: 3,
    });
    expect(existsSync(join(dir, '.qai/evidence/EV-0.json'))).toBe(true);
  });

  it('reads recency the way listRuns does, not the order runs were written in', () => {
    // A run saved late but stamped early is old. Retention and the listing have to agree
    // about which runs are recent, or a user watches the top of their list get pruned.
    const store = open();
    store.saveRun(run('RUN-new', startedAt(9)), []);
    store.saveRun(run('RUN-old', startedAt(1)), []);

    expect(store.pruneEvidence({ keepRuns: 1, keepEvidence: 1 }).runsRemoved).toStrictEqual([
      'RUN-old',
    ]);
  });
});

describe('body files', () => {
  it('unlinks the body of pruned evidence, which no cascade would have reached', () => {
    const store = open();
    fill(store, 3);

    const report = store.pruneEvidence({ keepRuns: 3, keepEvidence: 1 });

    expect(report.bodiesDeleted).toStrictEqual([
      '.qai/evidence/EV-0.json',
      '.qai/evidence/EV-1.json',
    ]);
    expect(existsSync(join(dir, '.qai/evidence/EV-0.json'))).toBe(false);
    expect(existsSync(join(dir, '.qai/evidence/EV-1.json'))).toBe(false);
    // The kept run's body is untouched, so this is retention rather than a clear out.
    expect(existsSync(join(dir, '.qai/evidence/EV-2.json'))).toBe(true);
  });

  it('leaves a body alone while any surviving evidence row still names it', () => {
    // Evidence ids come from a per-run counter, so every run writes EV-000001.json and
    // two runs genuinely point at one file. Deleting the older run's body would delete
    // the newer run's evidence, which is the artifact behind a finding somebody is
    // reading right now.
    const store = open();
    const shared = '.qai/evidence/EV-000001.json';
    writeBody(shared);

    store.saveRun(run('RUN-00', startedAt(0)), [evidence('EV-000001', shared)]);
    store.saveRun(run('RUN-01', startedAt(1)), [evidence('EV-000001', shared)]);

    const report = store.pruneEvidence({ keepRuns: 2, keepEvidence: 1 });

    expect(report.evidenceRemoved.map((one) => one.runId)).toStrictEqual(['RUN-00']);
    expect(report.bodiesStillReferenced).toStrictEqual([shared]);
    expect(report.bodiesDeleted).toStrictEqual([]);
    expect(existsSync(join(dir, shared))).toBe(true);
  });

  it('deletes a shared body once the last run naming it is pruned', () => {
    // The other half of the rule. A guard that never released the file would be
    // indistinguishable from one that worked, until the directory filled up.
    const store = open();
    const shared = '.qai/evidence/EV-000001.json';
    writeBody(shared);

    store.saveRun(run('RUN-00', startedAt(0)), [evidence('EV-000001', shared)]);
    store.saveRun(run('RUN-01', startedAt(1)), [evidence('EV-000001', shared)]);

    const report = store.pruneEvidence({ keepRuns: 2, keepEvidence: 0 });

    expect(report.bodiesStillReferenced).toStrictEqual([]);
    expect(report.bodiesDeleted).toStrictEqual([shared]);
    expect(existsSync(join(dir, shared))).toBe(false);
  });

  it('reports a recorded body that was never on disk rather than claiming a deletion', () => {
    // An absence is not a deletion, and a report that counted it as one would overstate
    // what pruning reclaimed.
    const store = open();
    store.saveRun(run('RUN-00', startedAt(0)), [evidence('EV-0', '.qai/evidence/EV-0.json')]);
    store.saveRun(run('RUN-01', startedAt(1)), []);

    const report = store.pruneEvidence({ keepRuns: 2, keepEvidence: 1 });

    expect(report.bodiesMissing).toStrictEqual(['.qai/evidence/EV-0.json']);
    expect(report.bodiesDeleted).toStrictEqual([]);
  });

  it('handles evidence that references no body at all', () => {
    // A transport error is recorded as a log with no response, so there is no bodyRef to
    // resolve and nothing to unlink.
    const store = open();
    store.saveRun(run('RUN-00', startedAt(0)), [evidence('EV-0', undefined)]);
    store.saveRun(run('RUN-01', startedAt(1)), []);

    const report = store.pruneEvidence({ keepRuns: 2, keepEvidence: 1 });

    expect(report.evidenceRemoved).toStrictEqual([{ runId: 'RUN-00', evidenceId: 'EV-0' }]);
    expect(report.bodiesDeleted).toStrictEqual([]);
    expect(report.bodiesMissing).toStrictEqual([]);
  });
});

describe('pruning on write', () => {
  it('prunes as part of every save and reports what went', () => {
    // Both windows act on write, one behind the other. The evidence window closes on a
    // run first, and the run window closes on it later.
    const store = open({ retention: { keepRuns: 2, keepEvidence: 1 } });

    writeBody('.qai/evidence/EV-0.json');
    store.saveRun(run('RUN-00', startedAt(0)), [evidence('EV-0', '.qai/evidence/EV-0.json')]);

    writeBody('.qai/evidence/EV-1.json');
    const second = store.saveRun(run('RUN-01', startedAt(1)), [
      evidence('EV-1', '.qai/evidence/EV-1.json'),
    ]);

    expect(second.pruned.runsRemoved).toStrictEqual([]);
    expect(second.pruned.evidenceRemoved.map((one) => one.runId)).toStrictEqual(['RUN-00']);
    expect(second.pruned.bodiesDeleted).toStrictEqual(['.qai/evidence/EV-0.json']);

    writeBody('.qai/evidence/EV-2.json');
    const third = store.saveRun(run('RUN-02', startedAt(2)), [
      evidence('EV-2', '.qai/evidence/EV-2.json'),
    ]);

    expect(third.pruned.runsRemoved).toStrictEqual(['RUN-00']);
    expect(third.pruned.bodiesDeleted).toStrictEqual(['.qai/evidence/EV-1.json']);
    expect(store.listRuns({ limit: 100 }).map((one) => one.runId)).toStrictEqual([
      'RUN-02',
      'RUN-01',
    ]);
  });

  it('applies the default window when the caller configured none', () => {
    const store = open();
    fill(store, 21, false);

    expect(store.listRuns({ limit: 100 })).toHaveLength(DEFAULT_PRUNE_POLICY.keepRuns);
    expect(store.getRun('RUN-00')).toBeNull();
  });

  it('names a run it pruned immediately rather than letting it vanish', () => {
    // A run stamped older than everything already stored is outside the window the moment
    // it lands. That is retention being consistent, and the save report says so instead of
    // reporting a stored run that is not there.
    const store = open({ retention: { keepRuns: 1, keepEvidence: 1 } });
    store.saveRun(run('RUN-new', startedAt(9)), []);

    const report = store.saveRun(run('RUN-old', startedAt(1)), []);

    expect(report.pruned.runsRemoved).toStrictEqual(['RUN-old']);
    expect(store.getRun('RUN-old')).toBeNull();
  });
});

describe('the policy itself', () => {
  it('refuses a window that would keep no runs', () => {
    // Pruning happens on write, so keepRuns of zero deletes the run the caller just
    // handed over. A store that discards its input is worse than one that will not open.
    expect(() => open({ retention: { keepRuns: 0 } })).toThrow(/keepRuns/);
    expect(() => open({ retention: { keepRuns: 0 } })).toThrow(/just written/);
  });

  it('refuses a window that is not a whole number of runs', () => {
    expect(() => open({ retention: { keepRuns: 2.5 } })).toThrow(/whole number/);
    expect(() => open({ retention: { keepEvidence: -1 } })).toThrow(/keepEvidence/);
  });

  it('allows keeping no evidence, which is not the same as keeping no runs', () => {
    const store = open({ retention: { keepRuns: 2, keepEvidence: 0 } });
    fill(store, 2);

    expect(store.listRuns({ limit: 100 })).toHaveLength(2);
    expect(existsSync(join(dir, '.qai/evidence/EV-1.json'))).toBe(false);
  });

  it('reports the window it applied, so a summary states it rather than implies it', () => {
    expect(open().pruneEvidence({ keepRuns: 7, keepEvidence: 3 }).policy).toStrictEqual({
      keepRuns: 7,
      keepEvidence: 3,
    });
  });

  it('never keeps evidence for a run it did not keep', () => {
    // keepEvidence above keepRuns is a policy that contradicts itself. The run window
    // wins, since evidence for a run that is gone has nothing to belong to.
    const store = open();
    fill(store, 4);

    const report = store.pruneEvidence({ keepRuns: 2, keepEvidence: 5 });

    expect(report.runsRemoved).toStrictEqual(['RUN-01', 'RUN-00']);
    expect(report.evidenceRemoved.map((one) => one.runId)).toStrictEqual(['RUN-00', 'RUN-01']);
    expect(report.bodiesDeleted).toStrictEqual([
      '.qai/evidence/EV-0.json',
      '.qai/evidence/EV-1.json',
    ]);
  });
});
