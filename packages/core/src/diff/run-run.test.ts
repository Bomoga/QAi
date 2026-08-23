import { describe, expect, it } from 'vitest';

import type { RequirementVerdict, RunResult } from '../contracts/index.ts';
import { diffRuns } from './run-run.ts';

/**
 * Requirement transitions, built from hand-written runs rather than from the fixture.
 *
 * The fixture gives two configurations and therefore one direction of change. What has to
 * be pinned here is the whole transition table, including the combinations the ledger
 * cannot produce, and a table is easier to read than nine bespoke runs. The real
 * application arrives at M6.8 and is the check on whether this agrees with reality.
 */
const VERDICTS: readonly RequirementVerdict[] = ['verified', 'failed', 'unverified'];

function run(
  runId: string,
  requirements: readonly (readonly [string, RequirementVerdict])[],
  checks: readonly (readonly [string, string, 'pass' | 'fail' | 'inconclusive'])[] = [],
): RunResult {
  return {
    resultVersion: '0.1',
    runId,
    toolVersion: '0.1.0',
    startedAt: '2026-08-18T00:00:00Z',
    finishedAt: '2026-08-18T00:00:10Z',
    spec: { hash: 'sha256:same', specVersion: '0.1', files: ['spec/app.spec.yaml'] },
    target: { baseUrl: 'http://127.0.0.1:3000' },
    requirements: requirements.map(([requirementId, verdict]) => ({
      requirementId,
      verdict,
      checkIds: [],
    })),
    checks: checks.map(([checkId, requirementId, verdict]) => ({
      checkId,
      type: 'access',
      requirementId,
      verdict,
      deterministic: true,
      severity: verdict === 'fail' ? 'high' : 'info',
      title: `check ${checkId}`,
      evidence: [],
    })),
    structural: { specifiedNotObserved: [], observedNotSpecified: [], fieldMismatches: [] },
    summary: {
      requirements: { total: requirements.length, verified: 0, failed: 0, unverified: 0 },
      checks: { total: checks.length, pass: 0, fail: 0, inconclusive: 0 },
      coverage: 0,
      findingsBySeverity: { high: 0, medium: 0, low: 0, info: 0 },
      modelAssistedCheckCount: 0,
    },
    unverifiedReasons: [],
  } as RunResult;
}

/** The bucket a single requirement lands in when it moves from one verdict to another. */
function bucketFor(from: RequirementVerdict, to: RequirementVerdict): string {
  const delta = diffRuns(run('RUN-a', [['REQ-001', from]]), run('RUN-b', [['REQ-001', to]]));
  const entries = Object.entries(delta.requirements).filter(([, list]) => list.length > 0);

  if (entries.length === 0) return 'none';
  expect(entries).toHaveLength(1);
  return entries[0]?.[0] ?? 'none';
}

describe('the transition table', () => {
  it('puts every pair in exactly one bucket, or in none', () => {
    // Read as a grid rather than nine separate assertions, so a rule wired to the wrong
    // bucket cannot hide behind the cases nobody wrote down.
    const grid = VERDICTS.map((from) => VERDICTS.map((to) => bucketFor(from, to)));

    expect(grid).toStrictEqual([
      // from verified
      ['none', 'regressed', 'newlyUnverified'],
      // from failed
      ['fixed', 'stillFailing', 'newlyUnverified'],
      // from unverified
      ['fixed', 'regressed', 'none'],
    ]);
  });

  it('says which kind of improvement a fix was, rather than needing a fifth bucket', () => {
    // A coverage gap closing and a failure being repaired are both improvements and both
    // land in `fixed`. The entry carries `from`, so they stay distinguishable.
    const repaired = diffRuns(
      run('RUN-a', [['REQ-001', 'failed']]),
      run('RUN-b', [['REQ-001', 'verified']]),
    );
    const covered = diffRuns(
      run('RUN-a', [['REQ-001', 'unverified']]),
      run('RUN-b', [['REQ-001', 'verified']]),
    );

    expect(repaired.requirements.fixed[0]?.from).toBe('failed');
    expect(covered.requirements.fixed[0]?.from).toBe('unverified');
  });

  it('reports nothing for a requirement that did not move', () => {
    // A delta that listed everything would be a report. The point is what changed.
    const delta = diffRuns(
      run('RUN-a', [
        ['REQ-001', 'verified'],
        ['REQ-002', 'failed'],
        ['REQ-003', 'unverified'],
      ]),
      run('RUN-b', [
        ['REQ-001', 'verified'],
        ['REQ-002', 'failed'],
        ['REQ-003', 'unverified'],
      ]),
    );

    expect(delta.requirements.regressed).toStrictEqual([]);
    expect(delta.requirements.fixed).toStrictEqual([]);
    expect(delta.requirements.newlyUnverified).toStrictEqual([]);
    // Still failing is the one thing that is reported without having moved, because a
    // failure nobody fixed is still the answer to "what is wrong with this".
    expect(delta.requirements.stillFailing.map((one) => one.requirementId)).toStrictEqual([
      'REQ-002',
    ]);
  });
});

describe('which checks a transition names', () => {
  it('names the check whose verdict moved, not every check on the requirement', () => {
    // A requirement with three checks where one broke should point at the one, or the
    // reader has to diff the runs by hand to find it.
    const delta = diffRuns(
      run(
        'RUN-a',
        [['REQ-001', 'verified']],
        [
          ['CHK-a', 'REQ-001', 'pass'],
          ['CHK-b', 'REQ-001', 'pass'],
          ['CHK-c', 'REQ-001', 'pass'],
        ],
      ),
      run(
        'RUN-b',
        [['REQ-001', 'failed']],
        [
          ['CHK-a', 'REQ-001', 'pass'],
          ['CHK-b', 'REQ-001', 'fail'],
          ['CHK-c', 'REQ-001', 'pass'],
        ],
      ),
    );

    expect(delta.requirements.regressed[0]?.checkIds).toStrictEqual(['CHK-b']);
  });

  it('names a check that stopped running at all', () => {
    // Something no longer being checked is the change a reader is most likely hunting
    // for, and it leaves no failing check behind to point at.
    const delta = diffRuns(
      run(
        'RUN-a',
        [['REQ-001', 'verified']],
        [
          ['CHK-a', 'REQ-001', 'pass'],
          ['CHK-b', 'REQ-001', 'pass'],
        ],
      ),
      run('RUN-b', [['REQ-001', 'unverified']], [['CHK-a', 'REQ-001', 'inconclusive']]),
    );

    expect(delta.requirements.newlyUnverified[0]?.checkIds).toStrictEqual(['CHK-a', 'CHK-b']);
  });

  it('names the checks still failing on a requirement that failed twice', () => {
    const delta = diffRuns(
      run(
        'RUN-a',
        [['REQ-001', 'failed']],
        [
          ['CHK-a', 'REQ-001', 'fail'],
          ['CHK-b', 'REQ-001', 'pass'],
        ],
      ),
      run(
        'RUN-b',
        [['REQ-001', 'failed']],
        [
          ['CHK-a', 'REQ-001', 'fail'],
          ['CHK-b', 'REQ-001', 'pass'],
        ],
      ),
    );

    expect(delta.requirements.stillFailing[0]?.checkIds).toStrictEqual(['CHK-a']);
  });

  it('ignores checks belonging to another requirement', () => {
    const delta = diffRuns(
      run(
        'RUN-a',
        [['REQ-001', 'verified']],
        [
          ['CHK-a', 'REQ-001', 'pass'],
          ['CHK-x', 'REQ-999', 'pass'],
        ],
      ),
      run(
        'RUN-b',
        [['REQ-001', 'failed']],
        [
          ['CHK-a', 'REQ-001', 'fail'],
          ['CHK-x', 'REQ-999', 'fail'],
        ],
      ),
    );

    expect(delta.requirements.regressed[0]?.checkIds).toStrictEqual(['CHK-a']);
  });
});

describe('the delta as a whole', () => {
  it('names both runs and the direction it compared them in', () => {
    const delta = diffRuns(run('RUN-older', []), run('RUN-newer', []));

    expect(delta.from).toBe('RUN-older');
    expect(delta.to).toBe('RUN-newer');
  });

  it('reverses its answer when the arguments are reversed', () => {
    // The one mistake a caller makes with a two argument diff. A fix read as a regression
    // would be the worst possible way to be wrong.
    const older = run('RUN-a', [['REQ-001', 'failed']]);
    const newer = run('RUN-b', [['REQ-001', 'verified']]);

    expect(diffRuns(older, newer).requirements.fixed).toHaveLength(1);
    expect(diffRuns(newer, older).requirements.regressed).toHaveLength(1);
  });

  it('notices the spec changed between the runs', () => {
    const older = run('RUN-a', [['REQ-001', 'verified']]);
    const newer = {
      ...run('RUN-b', [['REQ-001', 'verified']]),
      spec: { hash: 'sha256:different', specVersion: '0.1', files: ['spec/app.spec.yaml'] },
    } as RunResult;

    expect(diffRuns(older, older).specChanged).toBe(false);
    expect(diffRuns(older, newer).specChanged).toBe(true);
  });

  it('skips a requirement that exists in only one of the runs', () => {
    // It appeared or vanished because the spec changed, not because the application did.
    // Saying otherwise is the thing M6.6 exists to prevent, and it must not leak in here.
    const delta = diffRuns(
      run('RUN-a', [['REQ-001', 'failed']]),
      run('RUN-b', [
        ['REQ-001', 'failed'],
        ['REQ-002', 'failed'],
      ]),
    );

    expect(delta.requirements.stillFailing.map((one) => one.requirementId)).toStrictEqual([
      'REQ-001',
    ]);
  });

  it('lists requirements in the order the newer run holds them, which is spec order', () => {
    const delta = diffRuns(
      run('RUN-a', [
        ['REQ-003', 'verified'],
        ['REQ-001', 'verified'],
        ['REQ-002', 'verified'],
      ]),
      run('RUN-b', [
        ['REQ-003', 'failed'],
        ['REQ-001', 'failed'],
        ['REQ-002', 'failed'],
      ]),
    );

    expect(delta.requirements.regressed.map((one) => one.requirementId)).toStrictEqual([
      'REQ-003',
      'REQ-001',
      'REQ-002',
    ]);
  });
});

/**
 * The half of the access loosening rule that needs the Observation.
 *
 * M6.5 could only build the deny rule half, because a RunResult carried a reference to
 * its Observation and nothing else. Q6 put a summary on the result, including
 * `authRequired` on every endpoint, which is the one field this rule turns on.
 */
function runWithEndpoints(
  runId: string,
  endpoints: readonly (readonly [string, boolean | 'unknown'])[],
): RunResult {
  return {
    ...run(runId, []),
    observation: {
      ref: `OBS-${runId}`,
      endpoints: endpoints.map(([id, authRequired]) => {
        const [method = 'GET', path = '/'] = id.split(' ');
        return { id, method, path, authRequired };
      }),
    },
  } as RunResult;
}

describe('an endpoint that stopped requiring credentials', () => {
  it('is reported as access loosening', () => {
    const delta = diffRuns(
      runWithEndpoints('RUN-a', [['GET /api/invoices', true]]),
      runWithEndpoints('RUN-b', [['GET /api/invoices', false]]),
    );

    expect(delta.structural.accessLoosened).toHaveLength(1);
    expect(delta.structural.accessLoosened[0]?.endpoint).toBe('GET /api/invoices');
    expect(delta.structural.accessLoosened[0]?.detail).toContain('no longer');
  });

  it('is not reported when credentials started being required', () => {
    // The opposite direction is a tightening. Reporting it as a loosening would teach a
    // reader to distrust every real one.
    const delta = diffRuns(
      runWithEndpoints('RUN-a', [['GET /api/invoices', false]]),
      runWithEndpoints('RUN-b', [['GET /api/invoices', true]]),
    );

    expect(delta.structural.accessLoosened).toHaveLength(0);
  });

  it('is not reported when the newer run simply does not know', () => {
    // `authRequired` is `unknown` until a refusal without credentials is observed, so
    // true to unknown is the probe losing sight of the fact, not the application
    // changing. Reporting it would fire on every run that stopped checking.
    const delta = diffRuns(
      runWithEndpoints('RUN-a', [['GET /api/invoices', true]]),
      runWithEndpoints('RUN-b', [['GET /api/invoices', 'unknown']]),
    );

    expect(delta.structural.accessLoosened).toHaveLength(0);
  });

  it('is not reported for an endpoint only one run saw', () => {
    // An endpoint that appeared is `endpointsAdded`, and it has no earlier state to
    // have loosened from.
    const delta = diffRuns(
      runWithEndpoints('RUN-a', []),
      runWithEndpoints('RUN-b', [['GET /api/invoices', false]]),
    );

    expect(delta.structural.accessLoosened).toHaveLength(0);
  });

  it('says nothing when neither run carries an endpoint summary', () => {
    // Every run before Q6 is in this state, and a delta over two of them has to keep
    // reporting the deny rule half rather than failing to read a field that is absent.
    const delta = diffRuns(run('RUN-a', []), run('RUN-b', []));

    expect(delta.structural.accessLoosened).toHaveLength(0);
  });
});
