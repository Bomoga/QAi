import { describe, expect, it } from 'vitest';

import { RunResultSchema, type CheckResultRecord, type Spec } from '../contracts/index.ts';
import { assembleRun, rollUpRequirement } from './assemble.ts';

/**
 * The rollup is tested over the whole combination table, because it is the one rule the
 * module says will be reimplemented subtly differently somewhere else. Everything after
 * it is arithmetic on top.
 */

function check(overrides: Partial<CheckResultRecord> = {}): CheckResultRecord {
  return {
    checkId: 'CHK-000000000001',
    type: 'access',
    requirementId: 'REQ-001',
    verdict: 'pass',
    deterministic: true,
    severity: 'info',
    title: 'A check',
    evidence: [],
    ...overrides,
  };
}

function specWith(ids: string[]): Spec {
  return {
    specVersion: '0.1',
    name: 'Ledger',
    actors: [],
    entities: [],
    requirements: ids.map((id) => ({
      id,
      statement: `Requirement ${id}`,
      entities: [],
      fields: [],
      tags: [],
      accessRules: [],
      acceptanceCriteria: [],
    })),
  } as unknown as Spec;
}

function assemble(checks: CheckResultRecord[], ids = ['REQ-001'], gaps = undefined) {
  return assembleRun({
    runId: 'RUN-20260818-0001',
    toolVersion: '0.1.0',
    startedAt: '2026-08-18T00:00:00Z',
    finishedAt: '2026-08-18T00:00:10Z',
    spec: specWith(ids),
    specHash: 'sha256:abc',
    specFiles: ['spec/ledger.spec.yaml'],
    target: { baseUrl: 'http://127.0.0.1:3000' },
    checks,
    ...(gaps === undefined ? {} : { gaps }),
  });
}

describe('the verdict rollup', () => {
  it.each([
    ['no checks at all', [], 'unverified'],
    ['one pass', [check()], 'verified'],
    ['every check passing', [check(), check({ checkId: 'CHK-000000000002' })], 'verified'],
    ['one fail', [check({ verdict: 'fail' })], 'failed'],
    ['a fail among passes', [check(), check({ checkId: 'CHK-2', verdict: 'fail' })], 'failed'],
    ['every check inconclusive', [check({ verdict: 'inconclusive' })], 'unverified'],
    [
      'a pass and an inconclusive',
      [check(), check({ checkId: 'CHK-2', verdict: 'inconclusive' })],
      'verified',
    ],
    [
      'a fail and an inconclusive, where the failure decides',
      [check({ verdict: 'fail' }), check({ checkId: 'CHK-2', verdict: 'inconclusive' })],
      'failed',
    ],
  ])('is %s', (_name, checks, expected) => {
    expect(rollUpRequirement(checks as CheckResultRecord[]).verdict).toBe(expected);
  });

  it('never reports a requirement nobody could check as verified', () => {
    // Invariant I4, and the clause an optimizer would break first.
    const { verdict, reason } = rollUpRequirement([check({ verdict: 'inconclusive' })]);

    expect(verdict).toBe('unverified');
    expect(reason).toContain('none reached a verdict');
  });

  it('says how many checks failed, since a reader wants the shape of the damage', () => {
    const { reason } = rollUpRequirement([check(), check({ checkId: 'CHK-2', verdict: 'fail' })]);

    expect(reason).toBe('1 of 2 check(s) failed');
  });
});

describe('assembling a run', () => {
  it('produces an object the contract schema accepts', () => {
    expect(RunResultSchema.safeParse(assemble([check()])).success).toBe(true);
  });

  it('lists requirements in spec order, not in the order checks finished', () => {
    const run = assemble(
      [check({ requirementId: 'REQ-003', checkId: 'CHK-3' }), check({ requirementId: 'REQ-001' })],
      ['REQ-001', 'REQ-002', 'REQ-003'],
    );

    expect(run.requirements.map((entry) => entry.requirementId)).toEqual([
      'REQ-001',
      'REQ-002',
      'REQ-003',
    ]);
  });

  it('gives a requirement with no checks an unverified verdict and a reason', () => {
    const run = assemble([], ['REQ-001']);

    expect(run.requirements[0]?.verdict).toBe('unverified');
    expect(run.unverifiedReasons).toEqual([
      {
        requirementId: 'REQ-001',
        reason: 'no-checks-defined',
        detail: 'no checks were defined for this requirement',
      },
    ]);
  });

  it('says no verdict was reached when checks ran and none did, rather than check-error', () => {
    // Q7, decided 2026-08-22. Every check being inconclusive is the tool declining to
    // guess, which invariant I2 asks for, and `check-error` reads to a user as though
    // something threw. Five sightings before the set gained a member for it.
    const run = assemble(
      [check({ requirementId: 'REQ-001', verdict: 'inconclusive' })],
      ['REQ-001'],
    );

    expect(run.requirements[0]?.verdict).toBe('unverified');
    expect(run.unverifiedReasons[0]?.reason).toBe('no-verdict-reached');
  });

  it('keeps check-error for a check that actually threw', () => {
    // The negative half. `check-error` has to keep meaning what it was named for, or the
    // new member has simply renamed the old confusion.
    const run = assemble(
      [check({ requirementId: 'REQ-001', verdict: 'inconclusive' })],
      ['REQ-001'],
      [
        {
          requirementId: 'REQ-001',
          id: 'AR-001-01',
          kind: 'access' as const,
          reason: 'check-error' as const,
          detail: 'the runner threw',
        },
      ] as never,
    );

    expect(run.unverifiedReasons[0]?.reason).toBe('check-error');
  });

  it('prefers a recorded gap reason over the generic one, since it names a fix', () => {
    const run = assemble([], ['REQ-011'], [
      {
        requirementId: 'REQ-011',
        id: 'AR-011-01',
        kind: 'access' as const,
        reason: 'unsupported-condition' as const,
        detail: 'No route is known for read on "User".',
      },
    ] as never);

    expect(run.unverifiedReasons[0]?.reason).toBe('unsupported-condition');
    expect(run.unverifiedReasons[0]?.detail).toContain('No route is known');
  });

  it('counts coverage as requirements with a non-inconclusive check, not as a pass rate', () => {
    const run = assemble(
      [
        check({ requirementId: 'REQ-001', verdict: 'fail' }),
        check({ requirementId: 'REQ-002', checkId: 'CHK-2', verdict: 'inconclusive' }),
      ],
      ['REQ-001', 'REQ-002', 'REQ-003'],
    );

    // REQ-001 was established, even though it failed. REQ-002 was not. REQ-003 had
    // nothing. One of three, and a failing check still counts as coverage.
    expect(run.summary.coverage).toBeCloseTo(1 / 3);
  });

  it('reports zero coverage rather than dividing by nothing', () => {
    expect(assemble([], []).summary.coverage).toBe(0);
  });

  it('counts findings by severity over failures only', () => {
    const run = assemble([
      check({ verdict: 'fail', severity: 'high' }),
      check({ checkId: 'CHK-2', verdict: 'pass', severity: 'info' }),
    ]);

    // A passing check carries `info`, and counting it would report a clean run as
    // having findings.
    expect(run.summary.findingsBySeverity).toEqual({ high: 1, medium: 0, low: 0, info: 0 });
  });

  it('counts model assisted checks, and shows zero when none ran', () => {
    expect(assemble([check()]).summary.modelAssistedCheckCount).toBe(0);
    expect(assemble([check({ deterministic: false })]).summary.modelAssistedCheckCount).toBe(1);
  });

  it('sorts checks and check ids so two runs produce identical bytes', () => {
    const forward = assemble([
      check({ checkId: 'CHK-000000000002' }),
      check({ checkId: 'CHK-000000000001' }),
    ]);
    const reversed = assemble([
      check({ checkId: 'CHK-000000000001' }),
      check({ checkId: 'CHK-000000000002' }),
    ]);

    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
    expect(forward.requirements[0]?.checkIds).toEqual(['CHK-000000000001', 'CHK-000000000002']);
  });

  it('carries structural findings through untouched, and defaults them to empty', () => {
    expect(assemble([check()]).structural).toEqual({
      specifiedNotObserved: [],
      observedNotSpecified: [],
      fieldMismatches: [],
    });
  });

  it('omits the observation reference when no probe ran', () => {
    expect(assemble([check()]).observation).toBeUndefined();
  });
});
