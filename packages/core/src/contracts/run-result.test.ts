import { describe, expect, it } from 'vitest';

import { EvidenceSchema } from './evidence.ts';
import { ObservationSchema } from './observation.ts';
import { CheckResultSchema, RunResultSchema, SummarySchema } from './run-result.ts';

/**
 * The examples in 03-CONTRACTS.md, verbatim. They are the contract's own illustration
 * of each shape, so a schema that cannot parse them has drifted from the document.
 */

const CONTRACT_OBSERVATION = {
  observationVersion: '0.1',
  observedAt: '2026-08-14T09:31:02Z',
  mode: 'hybrid',
  target: { baseUrl: 'http://localhost:3000', sourceRoot: './' },
  entities: [
    {
      name: 'Invoice',
      origin: 'schema',
      confidence: 'high',
      fields: [{ name: 'org_id', type: 'string', origin: 'schema' }],
      evidence: ['EV-7d10b3'],
    },
  ],
  endpoints: [
    {
      id: 'GET /api/invoices/:id',
      method: 'GET',
      path: '/api/invoices/:id',
      origin: 'source',
      confidence: 'high',
      handlerRef: 'app/api/invoices/[id]/route.ts:12',
      authRequired: 'unknown',
      responseShape: { entity: 'Invoice', fields: ['id', 'org_id', 'total_cents'] },
      actorVisibility: { owner: 'untested', outsider: 'untested' },
      evidence: ['EV-91aa04'],
    },
  ],
  notes: [{ level: 'warn', message: '2 route files could not be parsed', refs: ['EV-33cc12'] }],
};

const CONTRACT_EVIDENCE = {
  id: 'EV-7d10b3',
  kind: 'http',
  capturedAt: '2026-08-14T09:32:10Z',
  actorId: 'outsider',
  request: {
    method: 'GET',
    url: '/api/invoices/42',
    headers: { authorization: '[redacted]' },
  },
  response: {
    status: 200,
    headers: {},
    bodyRef: '.qai/evidence/EV-7d10b3.json',
    truncated: false,
  },
  redactions: ['request.headers.authorization', 'response.body.notes'],
};

const CONTRACT_RUN_RESULT = {
  resultVersion: '0.1',
  runId: 'RUN-20260814-0931',
  toolVersion: '0.1.0',
  startedAt: '2026-08-14T09:31:00Z',
  finishedAt: '2026-08-14T09:33:41Z',
  spec: { hash: 'sha256:abc', specVersion: '0.1', files: ['spec/invoicing.spec.yaml'] },
  target: { baseUrl: 'http://localhost:3000', sourceRoot: './', commit: 'a1b2c3d' },
  observation: { ref: 'OBS-20260814-0931' },
  requirements: [
    {
      requirementId: 'REQ-014',
      verdict: 'failed',
      reason: '1 of 2 checks failed',
      checkIds: ['CHK-a91f2c', 'CHK-b02d55'],
    },
  ],
  checks: [
    {
      checkId: 'CHK-a91f2c',
      type: 'access',
      requirementId: 'REQ-014',
      ruleId: 'AR-014-01',
      verdict: 'fail',
      deterministic: true,
      severity: 'high',
      title: 'Invoice readable by user outside owning organization',
      detail:
        'GET /api/invoices/42 as actor outsider returned 200 with fields id, org_id, total_cents',
      locationRef: 'app/api/invoices/[id]/route.ts:12',
      evidence: ['EV-7d10b3', 'EV-7d10b4'],
    },
  ],
  structural: {
    specifiedNotObserved: [{ kind: 'entity', name: 'AuditLog', requirementIds: ['REQ-021'] }],
    observedNotSpecified: [{ kind: 'endpoint', id: 'POST /api/debug/reset', severity: 'medium' }],
    fieldMismatches: [
      { entity: 'Invoice', specifiedNotObserved: [], observedNotSpecified: ['internal_notes'] },
    ],
  },
  summary: {
    requirements: { total: 15, verified: 9, failed: 3, unverified: 3 },
    checks: { total: 41, pass: 33, fail: 4, inconclusive: 4 },
    coverage: 0.8,
    findingsBySeverity: { high: 1, medium: 3, low: 0, info: 2 },
    modelAssistedCheckCount: 2,
  },
  unverifiedReasons: [
    { requirementId: 'REQ-021', reason: 'no-checks-defined' },
    { requirementId: 'REQ-030', reason: 'actor-unavailable', detail: 'actor admin not configured' },
  ],
};

describe('ObservationSchema', () => {
  it('accepts the example in 03-CONTRACTS.md unchanged', () => {
    expect(ObservationSchema.safeParse(CONTRACT_OBSERVATION).success).toBe(true);
  });

  it('accepts authRequired as true, false, or the string unknown', () => {
    for (const authRequired of [true, false, 'unknown']) {
      const endpoint = { ...CONTRACT_OBSERVATION.endpoints[0], authRequired };
      const observation = { ...CONTRACT_OBSERVATION, endpoints: [endpoint] };
      expect(ObservationSchema.safeParse(observation).success).toBe(true);
    }
  });

  it('rejects an omitted authRequired rather than assuming the endpoint is protected', () => {
    const endpoint = { ...CONTRACT_OBSERVATION.endpoints[0] };
    delete (endpoint as { authRequired?: unknown }).authRequired;
    const observation = { ...CONTRACT_OBSERVATION, endpoints: [endpoint] };
    expect(ObservationSchema.safeParse(observation).success).toBe(false);
  });

  it('requires origin and confidence on every entity and endpoint', () => {
    const entity = { ...CONTRACT_OBSERVATION.entities[0] };
    delete (entity as { confidence?: unknown }).confidence;
    const observation = { ...CONTRACT_OBSERVATION, entities: [entity] };
    expect(ObservationSchema.safeParse(observation).success).toBe(false);
  });

  it('defaults actorVisibility to empty, since checks fill it and a probe does not', () => {
    const endpoint = { ...CONTRACT_OBSERVATION.endpoints[0] };
    delete (endpoint as { actorVisibility?: unknown }).actorVisibility;
    const parsed = ObservationSchema.parse({ ...CONTRACT_OBSERVATION, endpoints: [endpoint] });
    expect(parsed.endpoints[0]?.actorVisibility).toEqual({});
  });

  it.each(['source', 'blackbox', 'hybrid'])('accepts probe mode %s', (mode) => {
    expect(ObservationSchema.safeParse({ ...CONTRACT_OBSERVATION, mode }).success).toBe(true);
  });

  it('rejects a probe mode outside the closed set', () => {
    expect(ObservationSchema.safeParse({ ...CONTRACT_OBSERVATION, mode: 'guess' }).success).toBe(
      false,
    );
  });
});

describe('EvidenceSchema', () => {
  it('accepts the example in 03-CONTRACTS.md unchanged', () => {
    expect(EvidenceSchema.safeParse(CONTRACT_EVIDENCE).success).toBe(true);
  });

  it('keeps the redactions list, so an absence is never mistaken for a fact', () => {
    const evidence = EvidenceSchema.parse(CONTRACT_EVIDENCE);
    expect(evidence.redactions).toContain('request.headers.authorization');
    expect(evidence.redactions).toContain('response.body.notes');
  });

  it.each(['http', 'screenshot', 'file', 'log'])('accepts kind %s', (kind) => {
    expect(EvidenceSchema.safeParse({ ...CONTRACT_EVIDENCE, kind }).success).toBe(true);
  });

  it('rejects a malformed evidence id', () => {
    expect(EvidenceSchema.safeParse({ ...CONTRACT_EVIDENCE, id: '7d10b3' }).success).toBe(false);
  });

  it('rejects a capturedAt that is not an instant', () => {
    const bad = { ...CONTRACT_EVIDENCE, capturedAt: '2026-08-14' };
    expect(EvidenceSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a response status outside the HTTP range', () => {
    const bad = {
      ...CONTRACT_EVIDENCE,
      response: { ...CONTRACT_EVIDENCE.response, status: 42 },
    };
    expect(EvidenceSchema.safeParse(bad).success).toBe(false);
  });
});

describe('RunResultSchema', () => {
  it('accepts the example in 03-CONTRACTS.md unchanged', () => {
    const result = RunResultSchema.safeParse(CONTRACT_RUN_RESULT);
    expect(result.success).toBe(true);
  });

  it.each(['verified', 'failed', 'unverified'])('accepts requirement verdict %s', (verdict) => {
    const requirement = { ...CONTRACT_RUN_RESULT.requirements[0], verdict };
    const run = { ...CONTRACT_RUN_RESULT, requirements: [requirement] };
    expect(RunResultSchema.safeParse(run).success).toBe(true);
  });

  it.each(['pass', 'fail', 'inconclusive'])('accepts check verdict %s', (verdict) => {
    expect(CheckResultSchema.safeParse({ ...CONTRACT_RUN_RESULT.checks[0], verdict }).success).toBe(
      true,
    );
  });

  it.each(['passed', 'ok', 'error', 'unverified'])('rejects check verdict %s', (verdict) => {
    expect(CheckResultSchema.safeParse({ ...CONTRACT_RUN_RESULT.checks[0], verdict }).success).toBe(
      false,
    );
  });

  it('requires deterministic on every check, since it drives the model assisted count', () => {
    const check = { ...CONTRACT_RUN_RESULT.checks[0] };
    delete (check as { deterministic?: unknown }).deterministic;
    expect(CheckResultSchema.safeParse(check).success).toBe(false);
  });

  it.each([
    'no-checks-defined',
    'actor-unavailable',
    'target-unreachable',
    'probe-incomplete',
    'check-error',
    'no-verdict-reached',
    'unsupported-condition',
    'model-inconclusive',
    'capability-unavailable',
  ])('accepts unverified reason %s', (reason) => {
    const run = {
      ...CONTRACT_RUN_RESULT,
      unverifiedReasons: [{ requirementId: 'REQ-021', reason }],
    };
    expect(RunResultSchema.safeParse(run).success).toBe(true);
  });

  it('rejects an unverified reason outside the closed set', () => {
    const run = {
      ...CONTRACT_RUN_RESULT,
      unverifiedReasons: [{ requirementId: 'REQ-021', reason: 'dunno' }],
    };
    expect(RunResultSchema.safeParse(run).success).toBe(false);
  });

  it('rejects coverage outside zero to one', () => {
    const summary = { ...CONTRACT_RUN_RESULT.summary, coverage: 1.5 };
    expect(SummarySchema.safeParse(summary).success).toBe(false);
  });

  it('requires modelAssistedCheckCount even when it is zero', () => {
    const summary = { ...CONTRACT_RUN_RESULT.summary };
    delete (summary as { modelAssistedCheckCount?: unknown }).modelAssistedCheckCount;
    expect(SummarySchema.safeParse(summary).success).toBe(false);

    expect(SummarySchema.safeParse({ ...summary, modelAssistedCheckCount: 0 }).success).toBe(true);
  });

  it('defaults structural findings so an emitter never has to guard for absence', () => {
    const run = { ...CONTRACT_RUN_RESULT };
    delete (run as { structural?: unknown }).structural;
    const parsed = RunResultSchema.parse(run);
    expect(parsed.structural.specifiedNotObserved).toEqual([]);
    expect(parsed.structural.observedNotSpecified).toEqual([]);
    expect(parsed.structural.fieldMismatches).toEqual([]);
  });

  it('rejects a key it does not know', () => {
    expect(RunResultSchema.safeParse({ ...CONTRACT_RUN_RESULT, passRate: 0.8 }).success).toBe(
      false,
    );
  });

  it('accepts an access rule id or an acceptance criterion id as the check ruleId', () => {
    for (const ruleId of ['AR-014-01', 'AC-014-01']) {
      expect(
        CheckResultSchema.safeParse({ ...CONTRACT_RUN_RESULT.checks[0], ruleId }).success,
      ).toBe(true);
    }
  });
});
