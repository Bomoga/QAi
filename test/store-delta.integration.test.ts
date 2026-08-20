import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  RunResultSchema,
  diffRuns,
  openStore,
  type RunDelta,
  type RunResult,
} from '../packages/core/src/index.ts';

import {
  ALL_DEFECTS_OFF,
  ALL_DEFECTS_ON,
  FIXTURE_SPEC,
  runCli,
  startLedger,
  stopLedgers,
  workspace,
  writeConfig,
} from './support/ledger.ts';

/**
 * M6.8: the store and the delta against the real fixture, in both directions.
 *
 * Two runs of the same application, one with the defect switches on and one with them
 * off, saved through the store and compared through `diffRuns`. Defective to fixed has
 * to report fixes; fixed to defective has to report regressions over the same
 * requirements. Reporting a fix as a regression is the worst available way for a delta
 * to be wrong, so the reversal is asserted rather than assumed.
 *
 * The runs come out of `qai check` rather than being assembled here, because a delta
 * over hand-built RunResults would only prove `diffRuns` agrees with something this file
 * invented.
 */

const stores: { close(): void }[] = [];
const workspaces: string[] = [];

/** Distinct and ordered, since the store keys runs by id and a clock in a test is a race. */
const DEFECTIVE_RUN_ID = 'RUN-20260820-000001';
const FIXED_RUN_ID = 'RUN-20260820-000002';

/** D5, the endpoint nobody specified, as the probe names it. */
const DEBUG_ENDPOINT = 'GET /api/debug/state';

/** Runs `qai check` against a ledger in the given configuration and returns the result. */
async function checkAgainst(defects: Parameters<typeof startLedger>[0]): Promise<RunResult> {
  const dir = workspace();
  workspaces.push(dir);

  copyFileSync(FIXTURE_SPEC, join(dir, 'spec', 'ledger.spec.yaml'));
  writeConfig(dir, await startLedger(defects));

  const { out } = await runCli(dir, ['check', '--format', 'json']);

  // Parsed rather than cast. A document off a command's stdout is a boundary, rule R2,
  // and a delta computed from an unchecked shape would fail somewhere less obvious.
  return RunResultSchema.parse(JSON.parse(out));
}

/** Saves both runs and reads them back, so the delta is computed over what was stored. */
function roundTrip(older: RunResult, newer: RunResult): { older: RunResult; newer: RunResult } {
  const dir = mkdtempSync(join(tmpdir(), 'qai-delta-'));
  workspaces.push(dir);

  const store = openStore(dir);
  stores.push(store);

  store.saveRun(older, []);
  store.saveRun(newer, []);

  const first = store.getRun(older.runId);
  const second = store.getRun(newer.runId);
  if (first === null || second === null) throw new Error('the store did not return what it stored');

  return { older: first, newer: second };
}

function ids(entries: readonly { requirementId: string }[]): string[] {
  return entries.map((one) => one.requirementId).sort();
}

afterAll(async () => {
  for (const store of stores.splice(0)) store.close();
  await stopLedgers();
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the defective fixture and the fixed one, compared both ways', () => {
  let forward: RunDelta;
  let backward: RunDelta;
  let defective: RunResult;
  let fixed: RunResult;

  beforeAll(async () => {
    const defectiveRun = { ...(await checkAgainst(ALL_DEFECTS_ON)), runId: DEFECTIVE_RUN_ID };
    const fixedRun = { ...(await checkAgainst(ALL_DEFECTS_OFF)), runId: FIXED_RUN_ID };

    const stored = roundTrip(defectiveRun, fixedRun);
    defective = stored.older;
    fixed = stored.newer;

    forward = diffRuns(defective, fixed);
    backward = diffRuns(fixed, defective);
  }, 30_000);

  it('starts from the two runs the goldens describe', () => {
    // If these numbers are not what M7.7 captured then the delta below is about a
    // different application and every assertion after it is worthless.
    expect(defective.summary.requirements).toStrictEqual({
      total: 15,
      verified: 7,
      failed: 6,
      unverified: 2,
    });
    expect(fixed.summary.requirements).toStrictEqual({
      total: 15,
      verified: 13,
      failed: 0,
      unverified: 2,
    });
  });

  it('reports every repaired requirement as fixed and nothing as regressed', () => {
    expect(forward.comparable).toBe(true);
    expect(forward.specChanged).toBe(false);

    // Six failures in the defective run and none in the fixed one, over one spec.
    expect(forward.requirements.fixed).toHaveLength(6);
    expect(forward.requirements.regressed).toStrictEqual([]);
    expect(forward.requirements.stillFailing).toStrictEqual([]);
    expect(forward.requirements.newlyUnverified).toStrictEqual([]);
    expect(forward.requirements.added).toStrictEqual([]);
    expect(forward.requirements.removed).toStrictEqual([]);

    for (const entry of forward.requirements.fixed) {
      expect(entry.from).toBe('failed');
      expect(entry.to).toBe('verified');
      // A transition that named no check would leave the reader diffing two runs by hand.
      expect(entry.checkIds.length).toBeGreaterThan(0);
    }
  });

  it('reports the same requirements as regressed when the runs are the other way round', () => {
    // The one mistake a caller makes with a two argument diff. Reporting a fix as a
    // regression is worse than reporting nothing.
    expect(backward.requirements.regressed).toHaveLength(6);
    expect(backward.requirements.fixed).toStrictEqual([]);
    expect(ids(backward.requirements.regressed)).toStrictEqual(ids(forward.requirements.fixed));

    for (const entry of backward.requirements.regressed) {
      expect(entry.from).toBe('verified');
      expect(entry.to).toBe('failed');
    }
  });

  it('names the checks that actually moved, not every check on the requirement', () => {
    const moved = forward.requirements.fixed.flatMap((entry) => entry.checkIds);
    const byId = new Map(defective.checks.map((check) => [check.checkId, check] as const));
    const after = new Map(fixed.checks.map((check) => [check.checkId, check] as const));

    expect(moved.length).toBeGreaterThan(0);
    for (const checkId of moved) {
      // Either the verdict differs between the runs, or the check stopped running.
      expect(byId.get(checkId)?.verdict).not.toBe(after.get(checkId)?.verdict);
    }
  });

  it('sees the undeclared debug endpoint disappear, and appear again in reverse', () => {
    // D5 is the endpoint the application serves and no requirement mentions. Turning the
    // defects off removes it, which is a structural change rather than a verdict.
    expect(forward.structural.endpointsRemoved).toContain(DEBUG_ENDPOINT);
    expect(forward.structural.endpointsAdded).not.toContain(DEBUG_ENDPOINT);

    expect(backward.structural.endpointsAdded).toContain(DEBUG_ENDPOINT);
    expect(backward.structural.endpointsRemoved).not.toContain(DEBUG_ENDPOINT);
  });

  it('names exactly the deny rules that went from refused to reachable', () => {
    // The headline of the delta. Repairing the fixture cannot loosen anything, and
    // reintroducing the defects has to name which rules, not merely that some did.
    //
    // The three are the deny rules the defect switches break: AR-001-01 is outsider read
    // under D1, AR-002-01 is outsider list under D2, AR-003-01 is anonymous update under
    // D3. AR-003-02, anonymous delete, is refused in both runs and must not appear: a
    // rule that never loosened is exactly the noise that teaches a reader to stop reading.
    expect(forward.structural.accessLoosened).toStrictEqual([]);
    expect(backward.structural.accessLoosened.map((one) => one.ruleId).sort()).toStrictEqual([
      'AR-001-01',
      'AR-002-01',
      'AR-003-01',
    ]);

    // What this test cannot prove, stated rather than implied: no access check in this
    // fixture fails at any severity but high, so dropping the deny class filter changes
    // nothing here. The unit test at M6.5 is what pins that an allow rule failing is a
    // tightening rather than a loosening.
    for (const entry of backward.structural.accessLoosened) {
      // Every access rule in the fixture spec plans to exactly one check, so a rule id
      // identifies a check in these two runs.
      expect(defective.checks.find((one) => one.ruleId === entry.ruleId)?.verdict).toBe('fail');
      expect(fixed.checks.find((one) => one.ruleId === entry.ruleId)?.verdict).toBe('pass');
      // The module says this field holds the rule when nothing better exists, and a
      // CheckResultRecord carries no endpoint, so it holds the rule.
      expect(entry.endpoint).toBe(entry.ruleId);
      expect(entry.detail.length).toBeGreaterThan(0);
    }
  });

  it('leaves the entity nobody built out of the delta entirely', () => {
    // D6 is permanent: the spec declares AuditLog and the application never built it. It
    // belongs in the structural findings of every run and in the delta of none, because
    // nothing about it changed between these two runs.
    const mentioned = [
      ...forward.structural.endpointsAdded,
      ...forward.structural.endpointsRemoved,
      ...backward.structural.endpointsAdded,
      ...backward.structural.endpointsRemoved,
    ];

    expect(mentioned.some((id) => id.includes('AuditLog'))).toBe(false);
  });
});

describe('a regeneration that fixes one thing and breaks another', () => {
  // The shape the S7 exit criterion asks for, and the shape a real regeneration takes: a
  // build is not uniformly better or worse than the one before it. All three signals have
  // to land in one delta, or a reader gets a report that is true and useless.
  // D3 is left on in both runs on purpose. An access rule that was already broken has
  // not newly loosened, and without something failing on both sides of the delta that
  // rule has nothing to be wrong about.
  const BEFORE = {
    d1CrossOrgInvoiceRead: false,
    d2UnscopedInvoiceList: true,
    d3UnauthenticatedMutation: true,
    d4NotesInInvoiceList: true,
    d5UndeclaredDebugEndpoint: false,
  };

  const AFTER = {
    d1CrossOrgInvoiceRead: true,
    d2UnscopedInvoiceList: false,
    d3UnauthenticatedMutation: true,
    d4NotesInInvoiceList: false,
    d5UndeclaredDebugEndpoint: true,
  };

  let delta: RunDelta;

  beforeAll(async () => {
    const before = { ...(await checkAgainst(BEFORE)), runId: 'RUN-20260820-000003' };
    const after = { ...(await checkAgainst(AFTER)), runId: 'RUN-20260820-000004' };

    const stored = roundTrip(before, after);
    delta = diffRuns(stored.older, stored.newer);
  }, 30_000);

  it('reports the fix, the regression, and the failure nobody touched', () => {
    expect(ids(delta.requirements.fixed)).toContain('REQ-002');
    expect(ids(delta.requirements.regressed)).toContain('REQ-001');
    // D3 was on before and is on now, so REQ-003 is not news and is still the answer to
    // what is wrong with this application.
    expect(ids(delta.requirements.stillFailing)).toContain('REQ-003');

    // Disjoint by construction, and worth pinning: a requirement in both buckets would
    // mean the buckets are not what the module says they are.
    const fixedIds = new Set(ids(delta.requirements.fixed));
    for (const entry of [...delta.requirements.regressed, ...delta.requirements.stillFailing]) {
      expect(fixedIds.has(entry.requirementId)).toBe(false);
    }
  });

  it('reports the endpoint that appeared and the access rule that loosened', () => {
    expect(delta.structural.endpointsAdded).toContain(DEBUG_ENDPOINT);

    // D1 turned on is the only rule that went from refused to reachable. D2 went the
    // other way and belongs in the fixes; D3 was broken before and is broken now, so
    // AR-003-01 is failing here and has still not newly loosened. A list naming either
    // would report a repair as a break, or old news as new.
    expect(delta.structural.accessLoosened.map((one) => one.ruleId)).toStrictEqual(['AR-001-01']);
  });
});
