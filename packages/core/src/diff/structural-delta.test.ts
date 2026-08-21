import { describe, expect, it } from 'vitest';

import type { RunResult } from '../contracts/index.ts';
import { diffRuns } from './run-run.ts';

/**
 * The structural half of the delta, and the access loosening path the module calls its
 * headline.
 *
 * A RunResult carries no endpoint list, only `observation.ref`, so the two structural
 * lists are the whole of what one run says about which routes exist. An endpoint the
 * spec declares and the probe did not see is known absent; one the probe saw and no
 * requirement mentions is known present. Reading only one of those lists would miss half
 * the endpoints, which is why both tests below exist.
 */
function baseRun(runId: string): RunResult {
  return {
    resultVersion: '0.1',
    runId,
    toolVersion: '0.1.0',
    startedAt: '2026-08-18T00:00:00Z',
    finishedAt: '2026-08-18T00:00:10Z',
    spec: { hash: 'sha256:same', specVersion: '0.1', files: ['spec/app.spec.yaml'] },
    target: { baseUrl: 'http://127.0.0.1:3000' },
    requirements: [],
    checks: [],
    structural: { specifiedNotObserved: [], observedNotSpecified: [], fieldMismatches: [] },
    summary: {
      requirements: { total: 0, verified: 0, failed: 0, unverified: 0 },
      checks: { total: 0, pass: 0, fail: 0, inconclusive: 0 },
      coverage: 0,
      findingsBySeverity: { high: 0, medium: 0, low: 0, info: 0 },
      modelAssistedCheckCount: 0,
    },
    unverifiedReasons: [],
  } as RunResult;
}

function structuralRun(
  runId: string,
  structural: Partial<RunResult['structural']>,
  checks: readonly RunResult['checks'][number][] = [],
): RunResult {
  return {
    ...baseRun(runId),
    checks: [...checks],
    structural: {
      specifiedNotObserved: [],
      observedNotSpecified: [],
      fieldMismatches: [],
      ...structural,
    },
  } as RunResult;
}

function accessCheck(
  checkId: string,
  verdict: 'pass' | 'fail',
  severity: 'high' | 'medium' = 'high',
): RunResult['checks'][number] {
  return {
    checkId,
    type: 'access',
    requirementId: 'REQ-001',
    ruleId: 'AR-001-01',
    verdict,
    deterministic: true,
    severity: verdict === 'pass' ? 'info' : severity,
    title: 'Invoice readable by actor outsider, which the spec denies',
    detail: 'GET /api/invoices/INV-1001 as actor outsider returned 200',
    evidence: [],
  } as RunResult['checks'][number];
}

describe('endpoints appearing and disappearing', () => {
  it('reports an unspecified endpoint that has turned up', () => {
    // The fixture case. D5 serves /api/debug/state, which no requirement mentions, so it
    // lands in observedNotSpecified the moment it exists.
    const delta = diffRuns(
      structuralRun('RUN-a', {}),
      structuralRun('RUN-b', {
        observedNotSpecified: [
          { kind: 'endpoint', id: 'GET /api/debug/state', severity: 'medium' },
        ],
      }),
    );

    expect(delta.structural.endpointsAdded).toStrictEqual(['GET /api/debug/state']);
    expect(delta.structural.endpointsRemoved).toStrictEqual([]);
  });

  it('reports a specified endpoint that has stopped being missing', () => {
    // The other way an endpoint appears: the spec asked for it, it was absent, and now it
    // is not. Reading only observedNotSpecified would miss every specified endpoint.
    const delta = diffRuns(
      structuralRun('RUN-a', {
        specifiedNotObserved: [{ kind: 'endpoint', name: 'POST /api/export', requirementIds: [] }],
      }),
      structuralRun('RUN-b', {}),
    );

    expect(delta.structural.endpointsAdded).toStrictEqual(['POST /api/export']);
  });

  it('reports an endpoint that has gone away, both ways it can go', () => {
    const vanished = diffRuns(
      structuralRun('RUN-a', {
        observedNotSpecified: [
          { kind: 'endpoint', id: 'GET /api/debug/state', severity: 'medium' },
        ],
      }),
      structuralRun('RUN-b', {}),
    );
    const nowMissing = diffRuns(
      structuralRun('RUN-a', {}),
      structuralRun('RUN-b', {
        specifiedNotObserved: [{ kind: 'endpoint', name: 'POST /api/export', requirementIds: [] }],
      }),
    );

    expect(vanished.structural.endpointsRemoved).toStrictEqual(['GET /api/debug/state']);
    expect(nowMissing.structural.endpointsRemoved).toStrictEqual(['POST /api/export']);
  });

  it('says nothing about an endpoint that was there both times', () => {
    const same = {
      observedNotSpecified: [
        { kind: 'endpoint' as const, id: 'GET /health', severity: 'info' as const },
      ],
    };
    const delta = diffRuns(structuralRun('RUN-a', same), structuralRun('RUN-b', same));

    expect(delta.structural.endpointsAdded).toStrictEqual([]);
    expect(delta.structural.endpointsRemoved).toStrictEqual([]);
  });

  it('ignores entities, which are not endpoints', () => {
    // D6 is an entity the spec declares and the application never built. It belongs in
    // the structural findings of every run, and in the delta of none.
    const entity = {
      specifiedNotObserved: [
        { kind: 'entity' as const, name: 'AuditLog', requirementIds: ['REQ-006'] },
      ],
    };
    const delta = diffRuns(structuralRun('RUN-a', entity), structuralRun('RUN-b', {}));

    expect(delta.structural.endpointsAdded).toStrictEqual([]);
  });
});

describe('fields appearing', () => {
  it('reports a field the application grew that the spec never declared', () => {
    const delta = diffRuns(
      structuralRun('RUN-a', {
        fieldMismatches: [
          { entity: 'Invoice', specifiedNotObserved: [], observedNotSpecified: [] },
        ],
      }),
      structuralRun('RUN-b', {
        fieldMismatches: [
          {
            entity: 'Invoice',
            specifiedNotObserved: [],
            observedNotSpecified: ['internal_notes'],
          },
        ],
      }),
    );

    expect(delta.structural.fieldsAdded).toStrictEqual([
      { entity: 'Invoice', field: 'internal_notes' },
    ]);
  });

  it('says nothing about a field that was undeclared in both runs', () => {
    const same = {
      fieldMismatches: [
        { entity: 'Invoice', specifiedNotObserved: [], observedNotSpecified: ['internal_notes'] },
      ],
    };
    const delta = diffRuns(structuralRun('RUN-a', same), structuralRun('RUN-b', same));

    expect(delta.structural.fieldsAdded).toStrictEqual([]);
  });
});

describe('access loosening, the headline of the delta', () => {
  it('fires when a deny rule check moves from pass to fail', () => {
    // The exact silent divergence the product exists to catch: something refused last
    // week is reachable today.
    const delta = diffRuns(
      structuralRun('RUN-a', {}, [accessCheck('CHK-a', 'pass')]),
      structuralRun('RUN-b', {}, [accessCheck('CHK-a', 'fail')]),
    );

    expect(delta.structural.accessLoosened).toHaveLength(1);
    expect(delta.structural.accessLoosened[0]?.ruleId).toBe('AR-001-01');
    expect(delta.structural.accessLoosened[0]?.detail).toContain('as actor outsider returned 200');
  });

  it('does not fire for a check that was already failing', () => {
    // Already loose is not newly loosened, and reporting it as such would bury the one
    // that actually moved.
    const delta = diffRuns(
      structuralRun('RUN-a', {}, [accessCheck('CHK-a', 'fail')]),
      structuralRun('RUN-b', {}, [accessCheck('CHK-a', 'fail')]),
    );

    expect(delta.structural.accessLoosened).toStrictEqual([]);
  });

  it('does not fire for an allow rule breaking, which is a tightening', () => {
    // An allow that fails means a legitimate user is being refused. That is a bug worth
    // reporting and it is the opposite of a loosening. M3.2 fixes deny at high severity
    // and allow at medium, which is the only signal a check carries.
    const delta = diffRuns(
      structuralRun('RUN-a', {}, [accessCheck('CHK-a', 'pass')]),
      structuralRun('RUN-b', {}, [accessCheck('CHK-a', 'fail', 'medium')]),
    );

    expect(delta.structural.accessLoosened).toStrictEqual([]);
  });

  it('does not fire for a behavioral check, however it moved', () => {
    const behavioral = (verdict: 'pass' | 'fail'): RunResult['checks'][number] =>
      ({ ...accessCheck('CHK-b', verdict), type: 'behavioral' }) as RunResult['checks'][number];

    const delta = diffRuns(
      structuralRun('RUN-a', {}, [behavioral('pass')]),
      structuralRun('RUN-b', {}, [behavioral('fail')]),
    );

    expect(delta.structural.accessLoosened).toStrictEqual([]);
  });

  it('does not fire for a check that is new rather than changed', () => {
    // Nothing loosened: there was no earlier verdict to loosen from.
    const delta = diffRuns(
      structuralRun('RUN-a', {}, []),
      structuralRun('RUN-b', {}, [accessCheck('CHK-a', 'fail')]),
    );

    expect(delta.structural.accessLoosened).toStrictEqual([]);
  });

  it('reverses with the arguments, so a tightening is not read as a loosening', () => {
    const tight = structuralRun('RUN-a', {}, [accessCheck('CHK-a', 'pass')]);
    const loose = structuralRun('RUN-b', {}, [accessCheck('CHK-a', 'fail')]);

    expect(diffRuns(tight, loose).structural.accessLoosened).toHaveLength(1);
    expect(diffRuns(loose, tight).structural.accessLoosened).toStrictEqual([]);
  });
});
