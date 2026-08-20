import { describe, expect, it } from 'vitest';

import type { RequirementVerdict, RunResult } from '../contracts/index.ts';
import { diffRuns } from './run-run.ts';

/**
 * What happens when the spec moved between two runs.
 *
 * The rule the module gives is one sentence with three clauses: set `specChanged`,
 * restrict the comparison to requirements present in both, and list what was added or
 * removed separately. The last clause is the one that matters, and the reason is in the
 * sentence after it: never present a delta across differing specs as though the
 * application changed. A requirement that vanished because somebody deleted it from the
 * spec is not a regression, and reporting it as one would train a reader to distrust
 * every regression the tool ever reports.
 */
function run(
  runId: string,
  specHash: string,
  requirements: readonly (readonly [string, RequirementVerdict])[],
): RunResult {
  return {
    resultVersion: '0.1',
    runId,
    toolVersion: '0.1.0',
    startedAt: '2026-08-18T00:00:00Z',
    finishedAt: '2026-08-18T00:00:10Z',
    spec: { hash: specHash, specVersion: '0.1', files: ['spec/app.spec.yaml'] },
    target: { baseUrl: 'http://127.0.0.1:3000' },
    requirements: requirements.map(([requirementId, verdict]) => ({
      requirementId,
      verdict,
      checkIds: [],
    })),
    checks: [],
    structural: { specifiedNotObserved: [], observedNotSpecified: [], fieldMismatches: [] },
    summary: {
      requirements: { total: requirements.length, verified: 0, failed: 0, unverified: 0 },
      checks: { total: 0, pass: 0, fail: 0, inconclusive: 0 },
      coverage: 0,
      findingsBySeverity: { high: 0, medium: 0, low: 0, info: 0 },
      modelAssistedCheckCount: 0,
    },
    unverifiedReasons: [],
  } as RunResult;
}

/** Every requirement id that landed in any transition bucket, in one list. */
function transitions(delta: ReturnType<typeof diffRuns>): string[] {
  const { regressed, fixed, stillFailing, newlyUnverified } = delta.requirements;
  return [...regressed, ...fixed, ...stillFailing, ...newlyUnverified]
    .map((one) => one.requirementId)
    .sort((left, right) => left.localeCompare(right));
}

describe('when the spec changed between two runs', () => {
  it('says so', () => {
    const delta = diffRuns(
      run('RUN-a', 'sha256:one', [['REQ-001', 'verified']]),
      run('RUN-b', 'sha256:two', [['REQ-001', 'verified']]),
    );

    expect(delta.specChanged).toBe(true);
  });

  it('names a requirement the spec gained rather than calling it a fix', () => {
    const delta = diffRuns(
      run('RUN-a', 'sha256:one', [['REQ-001', 'verified']]),
      run('RUN-b', 'sha256:two', [
        ['REQ-001', 'verified'],
        ['REQ-002', 'verified'],
      ]),
    );

    // Every bucket, not just the plausible one. Asserting only `fixed` let a break that
    // filed the addition under `newlyUnverified` pass all ten tests.
    expect(delta.requirements.added).toStrictEqual(['REQ-002']);
    expect(transitions(delta)).toStrictEqual([]);
  });

  it('names a requirement the spec lost rather than calling it a regression', () => {
    // The dangerous direction. Somebody deleting a requirement is not the application
    // breaking, and reporting it as a regression teaches a reader to distrust the real
    // ones.
    const delta = diffRuns(
      run('RUN-a', 'sha256:one', [
        ['REQ-001', 'verified'],
        ['REQ-002', 'verified'],
      ]),
      run('RUN-b', 'sha256:two', [['REQ-001', 'verified']]),
    );

    expect(delta.requirements.removed).toStrictEqual(['REQ-002']);
    expect(transitions(delta)).toStrictEqual([]);
  });

  it('still compares the requirements the two specs share', () => {
    // Restricted, not abandoned. The overlap is exactly where a real change shows up.
    const delta = diffRuns(
      run('RUN-a', 'sha256:one', [
        ['REQ-001', 'verified'],
        ['REQ-002', 'verified'],
      ]),
      run('RUN-b', 'sha256:two', [
        ['REQ-001', 'failed'],
        ['REQ-003', 'verified'],
      ]),
    );

    expect(delta.requirements.regressed.map((one) => one.requirementId)).toStrictEqual(['REQ-001']);
    expect(delta.requirements.added).toStrictEqual(['REQ-003']);
    expect(delta.requirements.removed).toStrictEqual(['REQ-002']);
  });

  it('reports nothing added or removed when the spec did not move', () => {
    const delta = diffRuns(
      run('RUN-a', 'sha256:same', [['REQ-001', 'verified']]),
      run('RUN-b', 'sha256:same', [['REQ-001', 'failed']]),
    );

    expect(delta.specChanged).toBe(false);
    expect(delta.requirements.added).toStrictEqual([]);
    expect(delta.requirements.removed).toStrictEqual([]);
  });
});

describe('when two runs cannot be compared at all', () => {
  it('says so, with a reason, when they share no requirement', () => {
    // An empty delta with no explanation is indistinguishable from nothing having
    // changed, which is the most misleading thing this could report.
    const delta = diffRuns(
      run('RUN-a', 'sha256:one', [['REQ-001', 'verified']]),
      run('RUN-b', 'sha256:two', [['REQ-999', 'verified']]),
    );

    expect(delta.comparable).toBe(false);
    expect(delta.incomparableReason).toContain('share no requirement');
  });

  it('says so when neither run checked anything', () => {
    const delta = diffRuns(run('RUN-a', 'sha256:one', []), run('RUN-b', 'sha256:one', []));

    expect(delta.comparable).toBe(false);
    expect(delta.incomparableReason).toContain('nothing to compare');
  });

  it('still names what was added and removed, since that is the whole answer', () => {
    const delta = diffRuns(
      run('RUN-a', 'sha256:one', [['REQ-001', 'verified']]),
      run('RUN-b', 'sha256:two', [['REQ-999', 'verified']]),
    );

    expect(delta.requirements.added).toStrictEqual(['REQ-999']);
    expect(delta.requirements.removed).toStrictEqual(['REQ-001']);
  });

  it('is comparable on a single shared requirement, however much else differs', () => {
    const delta = diffRuns(
      run('RUN-a', 'sha256:one', [
        ['REQ-001', 'verified'],
        ['REQ-002', 'verified'],
      ]),
      run('RUN-b', 'sha256:two', [
        ['REQ-001', 'failed'],
        ['REQ-777', 'verified'],
      ]),
    );

    expect(delta.comparable).toBe(true);
    expect(delta.incomparableReason).toBeUndefined();
  });

  it('is comparable when the target answered at a different address', () => {
    // Deliberately not a reason to refuse. An ephemeral port and a staging host are both
    // legitimate ways for one application to answer at two addresses, and refusing there
    // would break the delta exactly where it is most wanted. Every integration test in
    // this repository starts its fixture on a fresh port.
    const older = run('RUN-a', 'sha256:same', [['REQ-001', 'verified']]);
    const newer = {
      ...run('RUN-b', 'sha256:same', [['REQ-001', 'failed']]),
      target: { baseUrl: 'http://127.0.0.1:54321' },
    } as RunResult;

    expect(diffRuns(older, newer).comparable).toBe(true);
    expect(diffRuns(older, newer).requirements.regressed).toHaveLength(1);
  });
});
