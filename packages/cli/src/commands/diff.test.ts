import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openStore, type RequirementVerdict, type RunDelta, type RunResult } from '@qai/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Stream } from '../reporter.ts';
import { BUILT_IN_DEFAULTS, type Settings } from '../settings.ts';
import { runDiff } from './diff.ts';

/**
 * `qai diff` over a real store file.
 *
 * The assertions that matter are about order and about refusal. `diffRuns(a, b)` reads
 * from `a` to `b`, so a command that picked them the other way round would report every
 * fix as a regression, and a command that guessed when it had too little to work with
 * would report a delta nobody could trust.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qai-diff-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function capture(): { stream: Stream; text: () => string } {
  const chunks: string[] = [];
  return {
    stream: { write: (chunk: string) => void chunks.push(chunk) },
    text: () => chunks.join(''),
  };
}

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    format: { value: BUILT_IN_DEFAULTS.format, source: 'default' },
    out: { value: undefined, source: 'default' },
    failOn: { value: BUILT_IN_DEFAULTS.failOn, source: 'default' },
    failOnUnverified: { value: BUILT_IN_DEFAULTS.failOnUnverified, source: 'default' },
    concurrency: { value: BUILT_IN_DEFAULTS.concurrency, source: 'default' },
    ...overrides,
  };
}

/** One requirement, one check, and a verdict that can move between two runs. */
function run(runId: string, startedAt: string, verdict: RequirementVerdict): RunResult {
  const checkVerdict = verdict === 'failed' ? 'fail' : 'pass';
  return {
    resultVersion: '0.1',
    runId,
    toolVersion: '0.1.0',
    startedAt,
    finishedAt: startedAt,
    spec: { hash: 'sha256:abc', specVersion: '0.1', files: ['spec/app.spec.yaml'] },
    target: { baseUrl: 'http://127.0.0.1:3000' },
    requirements: [{ requirementId: 'REQ-001', verdict, reason: 'a reason', checkIds: ['CHK-a'] }],
    checks: [
      {
        checkId: 'CHK-a',
        type: 'access',
        requirementId: 'REQ-001',
        ruleId: 'AR-001-01',
        verdict: checkVerdict,
        deterministic: true,
        severity: checkVerdict === 'fail' ? 'high' : 'info',
        title: 'A deny rule',
        detail: 'GET /api/invoices/42 as actor outsider returned 200',
        evidence: [],
      },
    ],
    structural: { specifiedNotObserved: [], observedNotSpecified: [], fieldMismatches: [] },
    summary: {
      requirements: {
        total: 1,
        verified: verdict === 'verified' ? 1 : 0,
        failed: verdict === 'failed' ? 1 : 0,
        unverified: verdict === 'unverified' ? 1 : 0,
      },
      checks: {
        total: 1,
        pass: checkVerdict === 'pass' ? 1 : 0,
        fail: checkVerdict === 'fail' ? 1 : 0,
        inconclusive: 0,
      },
      coverage: 1,
      findingsBySeverity: { high: checkVerdict === 'fail' ? 1 : 0, medium: 0, low: 0, info: 0 },
      modelAssistedCheckCount: 0,
    },
    unverifiedReasons: [],
  } as RunResult;
}

function store(...results: RunResult[]): void {
  const opened = openStore(dir);
  try {
    for (const result of results) opened.saveRun(result, []);
  } finally {
    opened.close();
  }
}

/** The defective run, then the repaired one, an hour apart. */
function twoRuns(): void {
  store(
    run('RUN-old', '2026-08-20T01:00:00Z', 'failed'),
    run('RUN-new', '2026-08-20T02:00:00Z', 'verified'),
  );
}

function diff(
  runs: readonly string[] = [],
  extra: { last?: number; settings?: Partial<Settings> } = {},
) {
  const stdout = capture();
  const stderr = capture();
  const code = runDiff({
    cwd: dir,
    runs,
    ...(extra.last === undefined ? {} : { last: extra.last }),
    settings: settings(extra.settings),
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  return { code, out: stdout.text(), err: stderr.text() };
}

function parsed(document: string): RunDelta {
  return JSON.parse(document) as RunDelta;
}

const AS_JSON = { settings: { format: { value: 'json', source: 'flag' } as Settings['format'] } };

describe('choosing which two runs to compare', () => {
  it('compares the last two, oldest first, when no run is named', () => {
    // The order is the whole point. Reversed, this reports the fix as a regression.
    twoRuns();

    const { code, out } = diff([], AS_JSON);
    const delta = parsed(out);

    expect(code).toBe(0);
    expect(delta.from).toBe('RUN-old');
    expect(delta.to).toBe('RUN-new');
    expect(delta.requirements.fixed.map((one) => one.requirementId)).toStrictEqual(['REQ-001']);
    expect(delta.requirements.regressed).toStrictEqual([]);
  });

  it('takes the order the caller gave when both runs are named', () => {
    // Naming them the other way round is a different question, and answering the one the
    // caller asked is what lets somebody ask "what did we break" as well as "what did we
    // fix".
    twoRuns();

    const forward = parsed(diff(['RUN-old', 'RUN-new'], AS_JSON).out);
    const backward = parsed(diff(['RUN-new', 'RUN-old'], AS_JSON).out);

    expect(forward.requirements.fixed).toHaveLength(1);
    expect(forward.requirements.regressed).toHaveLength(0);
    expect(backward.requirements.regressed).toHaveLength(1);
    expect(backward.requirements.fixed).toHaveLength(0);
  });

  it('reaches further back when --last says so', () => {
    store(
      run('RUN-1', '2026-08-20T01:00:00Z', 'failed'),
      run('RUN-2', '2026-08-20T02:00:00Z', 'unverified'),
      run('RUN-3', '2026-08-20T03:00:00Z', 'verified'),
    );

    expect(parsed(diff([], { last: 2, ...AS_JSON }).out).from).toBe('RUN-2');
    expect(parsed(diff([], { last: 3, ...AS_JSON }).out).from).toBe('RUN-1');
    // The newer end is the newest run either way. Only how far back moves.
    expect(parsed(diff([], { last: 3, ...AS_JSON }).out).to).toBe('RUN-3');
  });

  it('says --last was ignored rather than quietly preferring one input', () => {
    twoRuns();

    const { err } = diff(['RUN-old', 'RUN-new'], { last: 5, ...AS_JSON });

    expect(err).toContain('--last is ignored when both runs are named');
  });
});

describe('refusing, and how', () => {
  it('exits 2 when only one run is named', () => {
    twoRuns();

    const { code, err } = diff(['RUN-old']);

    expect(code).toBe(2);
    expect(err).toContain('a delta compares two runs');
    expect(err).toContain('RUN-old');
  });

  it('exits 2 when --last cannot name two runs', () => {
    twoRuns();

    const { code, err } = diff([], { last: 1 });

    expect(code).toBe(2);
    expect(err).toContain('does not name two runs');
  });

  it('exits 2 when the store holds too few runs, and says how many', () => {
    // Better than an empty delta, which reads as an application that did not change.
    store(run('RUN-only', '2026-08-20T01:00:00Z', 'failed'));

    const { code, err } = diff();

    expect(code).toBe(2);
    expect(err).toContain('1 are stored');
    expect(err).toContain('RUN-only');
  });

  it('exits 2 and names what is stored when a run id is unknown', () => {
    twoRuns();

    const { code, err } = diff(['RUN-old', 'RUN-nope']);

    expect(code).toBe(2);
    expect(err).toContain('RUN-nope');
    expect(err).toContain('the store holds');
  });

  it('exits 2 when the store cannot be opened at all', () => {
    mkdirSync(join(dir, '.qai'), { recursive: true });
    writeFileSync(join(dir, '.qai', 'runs.db'), 'this is not a database', 'utf8');

    const { code, err } = diff();

    expect(code).toBe(2);
    expect(err).toContain('could not open the run store');
  });

  it('never exits 1, whatever the delta reports', () => {
    // A delta describes change. Whether change is bad is a judgment this command does not
    // make, and 1 would tell CI an application has findings from a command that found
    // none.
    store(
      run('RUN-old', '2026-08-20T01:00:00Z', 'verified'),
      run('RUN-new', '2026-08-20T02:00:00Z', 'failed'),
    );

    const { code, out } = diff([], AS_JSON);

    expect(parsed(out).requirements.regressed).toHaveLength(1);
    expect(code).toBe(0);
  });
});

describe('what it writes', () => {
  it('renders text by default and JSON when asked', () => {
    twoRuns();

    expect(diff().out).toContain('Delta RUN-old to RUN-new');
    expect(parsed(diff([], AS_JSON).out).from).toBe('RUN-old');
  });

  it('says a findings format does not describe a delta, and writes JSON instead', () => {
    // The same answer `probe` gives. An empty findings document would report a clean
    // application where the truth is a document about something else entirely.
    twoRuns();

    const { code, out, err } = diff([], {
      settings: { format: { value: 'sarif', source: 'flag' } },
    });

    expect(code).toBe(0);
    expect(err).toContain('a delta describes change');
    expect(parsed(out).from).toBe('RUN-old');
  });

  it('writes to a file when --out says so', () => {
    twoRuns();

    const { code, out, err } = diff([], {
      settings: {
        format: { value: 'json', source: 'flag' },
        out: { value: 'delta.json', source: 'flag' },
      },
    });

    expect(code).toBe(0);
    expect(out).toBe('');
    expect(err).toContain('delta.json');
    expect(parsed(readFileSync(join(dir, 'delta.json'), 'utf8')).to).toBe('RUN-new');
  });

  it('says a threshold flag does not apply, rather than ignoring it', () => {
    twoRuns();

    expect(diff([], { settings: { failOn: { value: 'low', source: 'flag' } } }).err).toContain(
      '--fail-on',
    );
    expect(diff().err).not.toContain('--fail-on');
  });
});
