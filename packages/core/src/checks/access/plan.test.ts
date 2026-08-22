import { describe, expect, it } from 'vitest';

import {
  ObservationSchema,
  SpecSchema,
  type Observation,
  type Spec,
} from '../../contracts/index.ts';
import { parseCondition, type ConditionAst } from '../../spec/condition.ts';
import { checkIdFor } from '../result.ts';
import { planAccessChecks, resolvePath, type PlanningContext } from './plan.ts';

function specWith(rules: unknown[]): Spec {
  return SpecSchema.parse({
    specVersion: '0.1',
    name: 'Ledger',
    entities: [{ name: 'Invoice', fields: [{ name: 'org_id', type: 'string' }] }],
    requirements: [{ id: 'REQ-001', statement: 'a statement', accessRules: rules }],
  });
}

const DENY_READ = {
  id: 'AR-001-01',
  actor: 'outsider',
  action: 'read',
  resource: 'Invoice',
  condition: 'Invoice.org_id != actor.org_id',
  effect: 'deny',
};

const CONTEXT: PlanningContext = {
  actorIds: new Set(['owner', 'outsider']),
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

function conditionsFor(rule: { id: string; condition?: string }): Map<string, ConditionAst> {
  const map = new Map<string, ConditionAst>();
  if (rule.condition !== undefined) {
    const parsed = parseCondition(rule.condition);
    if (parsed.kind !== 'error') map.set(rule.id, parsed);
  }
  return map;
}

describe('planning a rule into a request', () => {
  it('resolves the actor, route, and method', () => {
    const { plans } = planAccessChecks(
      specWith([DENY_READ]),
      conditionsFor(DENY_READ),
      null,
      CONTEXT,
    );

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      actorId: 'outsider',
      resource: 'Invoice',
      action: 'read',
      method: 'GET',
      pathTemplate: '/api/invoices/{id}',
      requirementId: 'REQ-001',
      ruleId: 'AR-001-01',
    });
  });

  it('carries the parsed condition through', () => {
    const { plans } = planAccessChecks(
      specWith([DENY_READ]),
      conditionsFor(DENY_READ),
      null,
      CONTEXT,
    );
    expect(plans[0]?.condition?.comparisons[0]?.operator).toBe('!=');
  });

  it('carries the seeded instances a deny check will need', () => {
    const { plans } = planAccessChecks(
      specWith([DENY_READ]),
      conditionsFor(DENY_READ),
      null,
      CONTEXT,
    );
    expect(plans[0]?.candidates.map((instance) => instance.id)).toEqual(['INV-1001', 'INV-2001']);
  });

  it.each([
    ['read', 'GET', false],
    ['list', 'GET', false],
    ['create', 'POST', true],
    ['update', 'PATCH', true],
    ['delete', 'DELETE', true],
  ])('maps %s to %s and marks mutation correctly', (action, method, mutates) => {
    const context: PlanningContext = {
      ...CONTEXT,
      resources: [
        {
          name: 'Invoice',
          routes: { read: '/r', list: '/l', create: '/c', update: '/u', delete: '/d' },
          instances: [],
        },
      ],
    };
    const rule = { ...DENY_READ, action };
    const { plans } = planAccessChecks(specWith([rule]), new Map(), null, context);

    expect(plans[0]?.method).toBe(method);
    expect(plans[0]?.mutates).toBe(mutates);
  });

  it('gives a deny rule higher severity than an allow rule', () => {
    const allow = { ...DENY_READ, id: 'AR-001-02', actor: 'owner', effect: 'allow' };
    const { plans } = planAccessChecks(specWith([DENY_READ, allow]), new Map(), null, CONTEXT);

    expect(plans[0]?.severityOnFail).toBe('high');
    expect(plans[1]?.severityOnFail).toBe('medium');
  });

  it('gives each rule a distinct check id', () => {
    const second = { ...DENY_READ, id: 'AR-001-02', action: 'list' };
    const { plans } = planAccessChecks(specWith([DENY_READ, second]), new Map(), null, CONTEXT);

    const ids = plans.map((plan) => checkIdFor(plan.identity));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('gives the same rule the same check id on a second planning pass', () => {
    const first = planAccessChecks(specWith([DENY_READ]), new Map(), null, CONTEXT);
    const second = planAccessChecks(specWith([DENY_READ]), new Map(), null, CONTEXT);

    expect(checkIdFor(first.plans[0]?.identity ?? { type: 'access' })).toBe(
      checkIdFor(second.plans[0]?.identity ?? { type: 'access' }),
    );
  });
});

describe('a rule that cannot be planned is reported, not dropped', () => {
  it('names an actor that did not resolve', () => {
    const rule = { ...DENY_READ, actor: 'admin' };
    const { plans, unplannable } = planAccessChecks(specWith([rule]), new Map(), null, CONTEXT);

    expect(plans).toHaveLength(0);
    expect(unplannable[0]?.reason).toBe('actor-unavailable');
    expect(unplannable[0]?.detail).toContain('admin');
  });

  it('refuses to guess a URL when no route is known', () => {
    const rule = { ...DENY_READ, resource: 'Organization' };
    const { plans, unplannable } = planAccessChecks(specWith([rule]), new Map(), null, CONTEXT);

    expect(plans).toHaveLength(0);
    expect(unplannable[0]?.reason).toBe('unsupported-condition');
    expect(unplannable[0]?.detail).toContain('never guessed');
  });

  it('reports a missing route for one action while planning the others', () => {
    const withoutDelete = { ...DENY_READ, id: 'AR-001-02', action: 'delete' };
    const { plans, unplannable } = planAccessChecks(
      specWith([DENY_READ, withoutDelete]),
      new Map(),
      null,
      CONTEXT,
    );

    expect(plans).toHaveLength(1);
    expect(unplannable).toHaveLength(1);
    expect(unplannable[0]?.ruleId).toBe('AR-001-02');
  });

  it('carries a reason from the closed set in the contract', () => {
    const rule = { ...DENY_READ, actor: 'nobody' };
    const { unplannable } = planAccessChecks(specWith([rule]), new Map(), null, CONTEXT);

    expect(['actor-unavailable', 'unsupported-condition', 'probe-incomplete']).toContain(
      unplannable[0]?.reason,
    );
  });
});

describe('resolution prefers an observation over configuration', () => {
  const observation: Observation = ObservationSchema.parse({
    observationVersion: '0.1',
    observedAt: '2026-08-16T09:00:00Z',
    mode: 'source',
    target: { baseUrl: 'http://localhost:3000' },
    endpoints: [
      {
        id: 'GET /invoices/:id',
        method: 'GET',
        path: '/invoices/:id',
        origin: 'source',
        confidence: 'high',
        authRequired: true,
        responseShape: { entity: 'Invoice', fields: ['id'] },
      },
    ],
  });

  it('uses the observed path when one matches the resource', () => {
    const { plans } = planAccessChecks(specWith([DENY_READ]), new Map(), observation, CONTEXT);
    expect(plans[0]?.pathTemplate).toBe('/invoices/:id');
  });

  it('falls back to configuration for an action the observation does not cover', () => {
    const listRule = { ...DENY_READ, id: 'AR-001-02', action: 'list' };
    const { plans } = planAccessChecks(specWith([listRule]), new Map(), observation, CONTEXT);
    expect(plans[0]?.pathTemplate).toBe('/api/invoices');
  });

  it('does not use an instance endpoint for a list action', () => {
    const listRule = { ...DENY_READ, id: 'AR-001-02', action: 'list' };
    const context: PlanningContext = {
      ...CONTEXT,
      resources: [{ name: 'Invoice', routes: {}, instances: [] }],
    };
    const { plans, unplannable } = planAccessChecks(
      specWith([listRule]),
      new Map(),
      observation,
      context,
    );

    expect(plans).toHaveLength(0);
    expect(unplannable[0]?.reason).toBe('unsupported-condition');
  });
});

/**
 * Where a finding's file reference comes from.
 *
 * A source adapter records `handlerRef` on the endpoint it read, and the configured route
 * is the authoritative mapping from a resource and an action to a URL. Joining those two
 * is what lets a finding cite a file, and it does not require the probe to know anything
 * about the spec, which M4 forbids.
 *
 * None of the observations below carries `responseShape.entity`, because nothing in the
 * probe writes it. That is deliberate: an observation that had one would exercise the
 * branch above instead, and these tests would say nothing about a real run.
 */
describe('a plan carries the handler reference for the route it will request', () => {
  function observationOf(endpoint: Record<string, unknown>): Observation {
    return ObservationSchema.parse({
      observationVersion: '0.1',
      observedAt: '2026-08-16T09:00:00Z',
      mode: 'hybrid',
      target: { baseUrl: 'http://localhost:3000' },
      endpoints: [endpoint],
    });
  }

  const SERVED = {
    id: 'GET /api/invoices/:id',
    method: 'GET',
    path: '/api/invoices/:id',
    origin: 'source',
    confidence: 'high',
    handlerRef: 'src/routes/invoices.ts:12',
    authRequired: 'unknown',
  };

  it('takes it from the endpoint serving the configured route', () => {
    // `/api/invoices/{id}` configured against `/api/invoices/:id` observed. Parameter
    // names are erased on both sides by the same rule the merge and the diff use.
    const { plans } = planAccessChecks(
      specWith([DENY_READ]),
      new Map(),
      observationOf(SERVED),
      CONTEXT,
    );

    expect(plans[0]?.pathTemplate).toBe('/api/invoices/{id}');
    expect(plans[0]?.locationRef).toBe('src/routes/invoices.ts:12');
  });

  it('leaves it absent when the observed endpoint is a different route', () => {
    // Otherwise a finding about the invoice route would point a reader at the file that
    // serves something else, which is worse than pointing at nothing.
    const { plans } = planAccessChecks(
      specWith([DENY_READ]),
      new Map(),
      observationOf({ ...SERVED, id: 'GET /api/users/:id', path: '/api/users/:id' }),
      CONTEXT,
    );

    expect(plans[0]?.pathTemplate).toBe('/api/invoices/{id}');
    expect(plans[0]?.locationRef).toBeUndefined();
  });

  it('leaves it absent when the method differs', () => {
    const { plans } = planAccessChecks(
      specWith([DENY_READ]),
      new Map(),
      observationOf({ ...SERVED, id: 'DELETE /api/invoices/:id', method: 'DELETE' }),
      CONTEXT,
    );

    expect(plans[0]?.locationRef).toBeUndefined();
  });

  it('leaves it absent for a black box observation of the same route', () => {
    // A crawl reaches the route and cannot say which file serves it. This is the state
    // every run of this tool has been in, and the honest report of it is a request
    // reference rather than a file one.
    const { plans } = planAccessChecks(
      specWith([DENY_READ]),
      new Map(),
      observationOf({ ...SERVED, origin: 'blackbox', confidence: 'low', handlerRef: undefined }),
      CONTEXT,
    );

    expect(plans[0]?.locationRef).toBeUndefined();
  });
});

describe('path templates', () => {
  it.each([
    ['/api/invoices/{id}', '/api/invoices/INV-1001'],
    ['/api/invoices/:id', '/api/invoices/INV-1001'],
    ['/api/invoices', '/api/invoices'],
  ])('resolves %s', (template, expected) => {
    expect(resolvePath(template, 'INV-1001')).toBe(expected);
  });
});
