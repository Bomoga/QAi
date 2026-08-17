import { describe, expect, it } from 'vitest';

import type { Observation, Spec } from '../../contracts/index.ts';
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
