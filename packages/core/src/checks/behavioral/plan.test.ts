import { describe, expect, it } from 'vitest';

import { ObservationSchema, type Observation, type Spec } from '../../contracts/index.ts';
import type { PlanningContext } from '../access/plan.ts';
import { planBehavioralChecks } from './plan.ts';
import { isRequest, parseWhen } from './when.ts';

describe('the when vocabulary', () => {
  it.each([
    ['actor owner reads Invoice', 'owner', 'read', 'Invoice', undefined],
    ['actor owner reads Invoice INV-9999', 'owner', 'read', 'Invoice', 'INV-9999'],
    ['actor outsider lists Invoice', 'outsider', 'list', 'Invoice', undefined],
    ['actor owner creates Invoice', 'owner', 'create', 'Invoice', undefined],
    ['actor outsider updates Invoice INV-1001', 'outsider', 'update', 'Invoice', 'INV-1001'],
    ['actor admin deletes Invoice INV-1001', 'admin', 'delete', 'Invoice', 'INV-1001'],
  ])('reads %s', (text, actorId, action, entity, instanceId) => {
    const parsed = parseWhen(text);

    expect(parsed).toMatchObject({
      kind: 'request',
      actorId,
      action,
      entity,
      ...(instanceId === undefined ? {} : { instanceId }),
    });
  });

  it('reads a literal path, for a route belonging to no entity', () => {
    expect(parseWhen('actor anonymous requests /health')).toMatchObject({
      kind: 'request',
      actorId: 'anonymous',
      action: 'path',
      path: '/health',
      mutates: false,
    });
  });

  it.each([
    ['actor owner creates Invoice', true],
    ['actor owner updates Invoice INV-1', true],
    ['actor owner deletes Invoice INV-1', true],
    ['actor owner reads Invoice', false],
    ['actor owner lists Invoice', false],
  ])('knows whether %s changes state', (text, mutates) => {
    const parsed = parseWhen(text);
    if (!isRequest(parsed)) throw new Error('expected a request');
    expect(parsed.mutates).toBe(mutates);
  });

  it('refuses an update with no record to act on, rather than picking one', () => {
    const parsed = parseWhen('actor owner updates Invoice');

    expect(parsed.kind).toBe('unsupported');
    if (parsed.kind !== 'unsupported') throw new Error('unreachable');
    expect(parsed.reason).toContain('no instance id');
  });

  it.each([
    'the owner updates the invoice',
    'a caller with no credentials attempts to update it',
    'actor outsider requests that invoice by id',
    'any endpoint is called by any actor',
    'a caller requests a path under /api/debug',
  ])('refuses to guess at %s', (text) => {
    expect(parseWhen(text).kind).toBe('unsupported');
  });

  it('tolerates a trailing period and repeated spaces, and nothing else', () => {
    expect(parseWhen('actor  owner   lists Invoice.')).toMatchObject({ action: 'list' });
  });
});

const CONTEXT: PlanningContext = {
  actorIds: new Set(['owner', 'outsider', 'anonymous']),
  resources: [
    {
      name: 'Invoice',
      routes: {
        read: '/api/invoices/{id}',
        list: '/api/invoices',
        update: '/api/invoices/{id}',
      },
      instances: [
        { id: 'INV-1001', attributes: { org_id: 'org-1' } },
        { id: 'INV-2001', attributes: { org_id: 'org-2' } },
      ],
    },
  ],
};

function specWith(
  criteria: { when: string; then: string; mode?: 'deterministic' | 'fuzzy' }[],
): Spec {
  return {
    specVersion: '0.1',
    name: 'Ledger',
    actors: [],
    entities: [],
    requirements: [
      {
        id: 'REQ-012',
        statement: 'A requirement',
        entities: [],
        fields: [],
        tags: [],
        accessRules: [],
        acceptanceCriteria: criteria.map((criterion, index) => ({
          id: `AC-012-0${index + 1}`,
          mode: criterion.mode ?? 'deterministic',
          given: 'a seeded invoice',
          when: criterion.when,
          then: criterion.then,
        })),
      },
    ],
  };
}

describe('planning criteria', () => {
  it('resolves a read against the first configured instance', () => {
    const spec = specWith([{ when: 'actor owner reads Invoice', then: 'status is 200' }]);
    const { plans } = planBehavioralChecks(spec, null, CONTEXT);

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      actorId: 'owner',
      request: { method: 'GET', path: '/api/invoices/INV-1001' },
      mutates: false,
      severityOnFail: 'medium',
      criterionId: 'AC-012-01',
      requirementId: 'REQ-012',
    });
  });

  it('uses a named instance when the criterion gives one', () => {
    const spec = specWith([{ when: 'actor owner reads Invoice INV-9999', then: 'status is 404' }]);
    const { plans } = planBehavioralChecks(spec, null, CONTEXT);

    expect(plans[0]?.request.path).toBe('/api/invoices/INV-9999');
  });

  it('resolves a list against the collection route', () => {
    const spec = specWith([{ when: 'actor owner lists Invoice', then: 'status is 200' }]);
    const { plans } = planBehavioralChecks(spec, null, CONTEXT);

    expect(plans[0]?.request).toEqual({ method: 'GET', path: '/api/invoices' });
  });

  it('marks an update as mutating and uses PATCH', () => {
    const spec = specWith([
      { when: 'actor outsider updates Invoice INV-1001', then: 'status is 404' },
    ]);
    const { plans } = planBehavioralChecks(spec, null, CONTEXT);

    expect(plans[0]).toMatchObject({
      mutates: true,
      request: { method: 'PATCH', path: '/api/invoices/INV-1001' },
    });
  });

  it('takes a literal path as written', () => {
    const spec = specWith([{ when: 'actor anonymous requests /health', then: 'status is 200' }]);
    const { plans } = planBehavioralChecks(spec, null, CONTEXT);

    expect(plans[0]?.request).toEqual({ method: 'GET', path: '/health' });
  });

  it('carries the parsed assertions onto the plan', () => {
    const spec = specWith([
      {
        when: 'actor owner lists Invoice',
        then: 'status is 200 and body omits field Invoice.notes',
      },
    ]);
    const { plans } = planBehavioralChecks(spec, null, CONTEXT);

    expect(plans[0]?.assertions).toEqual([
      { kind: 'status', codes: [200] },
      { kind: 'field-absent', entity: 'Invoice', field: 'notes' },
    ]);
  });

  it('prefers an observed endpoint over a configured route, and cites its handler', () => {
    const observation: Observation = {
      observationVersion: '0.1',
      observedAt: '2026-01-01T00:00:00.000Z',
      mode: 'source',
      target: {},
      entities: [],
      endpoints: [
        {
          id: 'GET /invoices/:id',
          method: 'GET',
          path: '/invoices/:id',
          origin: 'source',
          confidence: 'high',
          handlerRef: 'src/routes/invoices.ts:12',
          authRequired: 'unknown',
          responseShape: { entity: 'Invoice', fields: [] },
          actorVisibility: {},
          evidence: [],
        },
      ],
      notes: [],
    };

    const spec = specWith([{ when: 'actor owner reads Invoice', then: 'status is 200' }]);
    const { plans } = planBehavioralChecks(spec, observation, CONTEXT);

    expect(plans[0]?.request.path).toBe('/invoices/INV-1001');
    expect(plans[0]?.locationRef).toBe('src/routes/invoices.ts:12');
  });
});

/**
 * Where a behavioral finding's file reference comes from.
 *
 * The observation above carries `responseShape.entity`, which is what makes the observed
 * path win over the configured one. **Nothing in the probe writes that field**, so none of
 * the observations below has one: an observation with an entity on it would exercise a
 * branch a real run never reaches, and these tests would say nothing about one.
 *
 * What remains is the join the access planner makes. The configured route says where the
 * resource lives, the Observation says which file serves that URL, and both sides go
 * through the same parameter erasure, so `/api/invoices/{id}` and `/api/invoices/:id` are
 * one route.
 */
describe('a criterion carries the handler reference for the route it will request', () => {
  function observationOf(endpoints: readonly Record<string, unknown>[]): Observation {
    return ObservationSchema.parse({
      observationVersion: '0.1',
      observedAt: '2026-01-01T00:00:00.000Z',
      mode: 'hybrid',
      target: {},
      endpoints,
    });
  }

  const READ_ROUTE = {
    id: 'GET /api/invoices/:id',
    method: 'GET',
    path: '/api/invoices/:id',
    origin: 'source',
    confidence: 'high',
    handlerRef: 'src/routes.ts:89',
    authRequired: 'unknown',
  };

  const UPDATE_ROUTE = {
    id: 'PATCH /api/invoices/:id',
    method: 'PATCH',
    path: '/api/invoices/:id',
    origin: 'source',
    confidence: 'high',
    handlerRef: 'src/routes.ts:99',
    authRequired: 'unknown',
  };

  it('takes it from the endpoint serving the configured route', () => {
    const spec = specWith([{ when: 'actor owner reads Invoice', then: 'status is 200' }]);
    const { plans } = planBehavioralChecks(spec, observationOf([READ_ROUTE]), CONTEXT);

    expect(plans[0]?.request.path).toBe('/api/invoices/INV-1001');
    expect(plans[0]?.locationRef).toBe('src/routes.ts:89');
  });

  it('takes the one matching the method, not the first for the path', () => {
    // A read and an update share a path and are two handlers. Citing whichever came first
    // would point a reader at the wrong one half the time.
    const spec = specWith([
      { when: 'actor owner updates Invoice INV-1001', then: 'status is 200' },
    ]);
    const { plans } = planBehavioralChecks(
      spec,
      observationOf([READ_ROUTE, UPDATE_ROUTE]),
      CONTEXT,
    );

    expect(plans[0]?.request.method).toBe('PATCH');
    expect(plans[0]?.locationRef).toBe('src/routes.ts:99');
  });

  it('takes it for a literal path, which belongs to no entity', () => {
    // `actor anonymous requests /health` resolves no resource, so the route is the path
    // itself and the join still has something to match on.
    const spec = specWith([{ when: 'actor anonymous requests /health', then: 'status is 200' }]);
    const { plans } = planBehavioralChecks(
      spec,
      observationOf([
        {
          id: 'GET /health',
          method: 'GET',
          path: '/health',
          origin: 'source',
          confidence: 'high',
          handlerRef: 'src/routes.ts:80',
          authRequired: 'unknown',
        },
      ]),
      CONTEXT,
    );

    expect(plans[0]?.locationRef).toBe('src/routes.ts:80');
  });

  it('leaves it absent when the observed endpoint is a different route', () => {
    const spec = specWith([{ when: 'actor owner reads Invoice', then: 'status is 200' }]);
    const { plans } = planBehavioralChecks(
      spec,
      observationOf([{ ...READ_ROUTE, id: 'GET /api/users/:id', path: '/api/users/:id' }]),
      CONTEXT,
    );

    expect(plans[0]?.locationRef).toBeUndefined();
  });

  it('leaves it absent for a black box observation of the same route', () => {
    // A crawl reaches the route and cannot say which file serves it, so the finding keeps
    // its request reference. That is what 04-CONVENTIONS.md asks for.
    const spec = specWith([{ when: 'actor owner reads Invoice', then: 'status is 200' }]);
    const { plans } = planBehavioralChecks(
      spec,
      observationOf([
        { ...READ_ROUTE, origin: 'blackbox', confidence: 'low', handlerRef: undefined },
      ]),
      CONTEXT,
    );

    expect(plans[0]?.locationRef).toBeUndefined();
  });
});

describe('what cannot be planned comes back with a reason', () => {
  it('reports an unreadable when clause', () => {
    const spec = specWith([{ when: 'the owner updates the invoice', then: 'status is 200' }]);
    const { plans, unplannable } = planBehavioralChecks(spec, null, CONTEXT);

    expect(plans).toEqual([]);
    expect(unplannable[0]).toMatchObject({
      criterionId: 'AC-012-01',
      reason: 'unsupported-condition',
    });
    expect(unplannable[0]?.detail).toContain('when clause');
  });

  it('reports an unreadable then clause', () => {
    const spec = specWith([
      { when: 'actor owner reads Invoice', then: 'the invoice is unchanged' },
    ]);
    const { unplannable } = planBehavioralChecks(spec, null, CONTEXT);

    expect(unplannable[0]?.reason).toBe('unsupported-condition');
    expect(unplannable[0]?.detail).toContain('the invoice is unchanged');
  });

  it('reports an actor nobody configured', () => {
    const spec = specWith([{ when: 'actor ghost reads Invoice', then: 'status is 200' }]);
    const { unplannable } = planBehavioralChecks(spec, null, CONTEXT);

    expect(unplannable[0]?.reason).toBe('actor-unavailable');
  });

  it('reports an entity with no known route rather than guessing a URL', () => {
    const spec = specWith([{ when: 'actor owner reads AuditLog', then: 'status is 200' }]);
    const { unplannable } = planBehavioralChecks(spec, null, CONTEXT);

    expect(unplannable[0]?.reason).toBe('probe-incomplete');
    expect(unplannable[0]?.detail).toContain('AuditLog');
  });

  it('refuses a fuzzy criterion whose when clause names no page to open', () => {
    const spec = specWith([
      { when: 'the page shows the invoice', then: 'it looks right', mode: 'fuzzy' },
    ]);
    const { plans, unplannable } = planBehavioralChecks(spec, null, CONTEXT);

    expect(plans).toEqual([]);
    expect(unplannable[0]?.reason).toBe('unsupported-condition');
    expect(unplannable[0]?.detail).toContain('when clause');
  });

  it('plans a fuzzy criterion with no assertions, since its then is not the table', () => {
    const spec = specWith([
      {
        when: 'actor owner requests /invoices',
        then: 'the page shows nothing that looks administrative',
        mode: 'fuzzy',
      },
    ]);
    const { plans, unplannable } = planBehavioralChecks(spec, null, CONTEXT);

    expect(unplannable).toEqual([]);
    expect(plans[0]).toMatchObject({ mode: 'fuzzy', assertions: [] });
    expect(plans[0]?.request).toEqual({ method: 'GET', path: '/invoices' });
  });

  it('resolves where to read a record an unchanged assertion names', () => {
    const spec = specWith([
      {
        when: 'actor owner updates Invoice INV-1001',
        then: 'record Invoice INV-1001 is unchanged',
      },
    ]);
    const { plans } = planBehavioralChecks(spec, null, CONTEXT);

    expect(plans[0]?.recordReads).toEqual([
      { entity: 'Invoice', instanceId: 'INV-1001', path: '/api/invoices/INV-1001' },
    ]);
  });

  it('takes the instance from the when clause when the assertion names none', () => {
    const spec = specWith([
      { when: 'actor owner updates Invoice INV-2001', then: 'record Invoice is unchanged' },
    ]);
    const { plans } = planBehavioralChecks(spec, null, CONTEXT);

    // "the invoice is unchanged" in a criterion about updating one invoice means that
    // invoice, which is what an author means every time.
    expect(plans[0]?.recordReads?.[0]?.instanceId).toBe('INV-2001');
  });

  it('plans the criterion anyway when no record read can be resolved', () => {
    const spec = specWith([
      { when: 'actor owner updates Invoice INV-1001', then: 'record AuditLog is unchanged' },
    ]);
    const { plans, unplannable } = planBehavioralChecks(spec, null, CONTEXT);

    // The clause is expressible and it is the target that offers nowhere to look, so the
    // runner reports the assertion unevaluable rather than the criterion vanishing.
    expect(unplannable).toEqual([]);
    expect(plans[0]?.recordReads).toBeUndefined();
  });

  it('resolves a status matches reference through the same route table', () => {
    const spec = specWith([
      {
        when: 'actor outsider reads Invoice INV-1001',
        then: 'status matches actor outsider reads Invoice INV-9999',
      },
    ]);
    const { plans } = planBehavioralChecks(spec, null, CONTEXT);

    expect(plans[0]?.referenceRequests).toEqual([
      {
        phrase: 'actor outsider reads Invoice INV-9999',
        actorId: 'outsider',
        request: { method: 'GET', path: '/api/invoices/INV-9999' },
      },
    ]);
  });

  it('plans the criterion anyway when the reference resolves to no route', () => {
    const spec = specWith([
      {
        when: 'actor owner reads Invoice INV-1001',
        then: 'status matches actor owner reads AuditLog AUD-1',
      },
    ]);
    const { plans, unplannable } = planBehavioralChecks(spec, null, CONTEXT);

    expect(unplannable).toEqual([]);
    expect(plans[0]?.referenceRequests).toBeUndefined();
  });

  it('keeps planning after one criterion it could not read', () => {
    const spec = specWith([
      { when: 'the owner updates the invoice', then: 'status is 200' },
      { when: 'actor owner lists Invoice', then: 'status is 200' },
    ]);

    const { plans, unplannable } = planBehavioralChecks(spec, null, CONTEXT);

    expect(plans).toHaveLength(1);
    expect(unplannable).toHaveLength(1);
  });
});

describe('planning a persisted state read', () => {
  const withAuditRoutes: PlanningContext = {
    ...CONTEXT,
    resources: [
      ...CONTEXT.resources,
      { name: 'AuditLog', routes: { list: '/api/audit-logs' }, instances: [] },
    ],
  };

  it('resolves where the counted entity can be read back', () => {
    const spec = specWith([
      { when: 'actor owner lists Invoice', then: 'record count of AuditLog is 1' },
    ]);
    const { plans } = planBehavioralChecks(spec, null, withAuditRoutes);

    expect(plans[0]?.stateReads).toEqual([{ entity: 'AuditLog', path: '/api/audit-logs' }]);
  });

  it('plans the criterion anyway when the entity has no list route', () => {
    const spec = specWith([
      { when: 'actor owner lists Invoice', then: 'record count of AuditLog is 1' },
    ]);
    const { plans, unplannable } = planBehavioralChecks(spec, null, CONTEXT);

    // The clause is expressible; the target offers nowhere to look. That is a capability
    // gap the runner reports as inconclusive, not an authoring mistake.
    expect(plans).toHaveLength(1);
    expect(plans[0]?.stateReads).toBeUndefined();
    expect(unplannable).toEqual([]);
  });

  it('carries no state read for a criterion that counts nothing', () => {
    const spec = specWith([{ when: 'actor owner lists Invoice', then: 'status is 200' }]);
    const { plans } = planBehavioralChecks(spec, null, withAuditRoutes);

    expect(plans[0]?.stateReads).toBeUndefined();
  });
});
