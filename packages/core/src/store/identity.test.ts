import { describe, expect, it } from 'vitest';

import { planAccessChecks } from '../checks/access/plan.ts';
import { checkIdFor } from '../checks/result.ts';
import { SpecSchema } from '../contracts/index.ts';
import type { CheckIdentity } from '../checks/types.ts';

/**
 * Check identity, tested on its own because the module calls it the load-bearing
 * requirement of the whole store.
 *
 * The delta says a requirement moved from failed to verified. It can only say that if the
 * check that failed and the check that passed are recognisably the same check. Every id
 * that churns turns one transition into two events, one check disappearing and another
 * appearing, and enough of those and the delta is noise nobody reads.
 *
 * So this file is in two halves. What must never change the id, and what must always
 * change it. A hash that ignored everything would pass the first half; one that hashed
 * the whole world would pass the second.
 */
const BASE: CheckIdentity = {
  type: 'access',
  requirementId: 'REQ-014',
  ruleId: 'AR-014-01',
  actorId: 'outsider',
  resource: 'Invoice',
  action: 'read',
};

describe('what must never change a check id', () => {
  it('running the same check again', () => {
    // The simplest case and the one everything else rests on.
    expect(checkIdFor(BASE)).toBe(checkIdFor(BASE));
  });

  it('a different object with the same values', () => {
    expect(checkIdFor({ ...BASE })).toBe(checkIdFor(BASE));
  });

  it('the order the fields were written in', () => {
    const reordered: CheckIdentity = {
      action: 'read',
      resource: 'Invoice',
      actorId: 'outsider',
      ruleId: 'AR-014-01',
      requirementId: 'REQ-014',
      type: 'access',
    };

    expect(checkIdFor(reordered)).toBe(checkIdFor(BASE));
  });

  it('the route the action resolves to', () => {
    // The reason `action` is `read` rather than `GET /api/invoices/{id}`. A regeneration
    // that moves an endpoint to /v2 has not changed which rule is being checked, and an
    // id that churned there would report every check on that resource as gone and
    // replaced. This is the case the delta exists for, so it must survive it.
    expect(checkIdFor(BASE)).toBe(checkIdFor({ ...BASE, action: 'read' }));
  });

  it('anything about the response, because none of it is an input', () => {
    // `CheckIdentity` has no field for a status, a body, or a duration. This states that
    // as a property rather than trusting the reader to notice.
    const inputs = Object.keys(BASE);

    for (const volatile of ['status', 'body', 'durationMs', 'capturedAt', 'runId', 'ordinal']) {
      expect(inputs).not.toContain(volatile);
    }
  });

  it('an extra property nobody declared', () => {
    // A caller passing something the hash does not read must not move the id, or the id
    // depends on whatever a call site happened to spread in.
    const noisy = { ...BASE, status: 500, evidence: ['EV-9'], runId: 'RUN-x' } as CheckIdentity;

    expect(checkIdFor(noisy)).toBe(checkIdFor(BASE));
  });
});

describe('what must always change a check id', () => {
  const cases: readonly [string, CheckIdentity][] = [
    ['the check type', { ...BASE, type: 'behavioral' }],
    ['the requirement', { ...BASE, requirementId: 'REQ-015' }],
    ['the rule', { ...BASE, ruleId: 'AR-014-02' }],
    ['the actor', { ...BASE, actorId: 'owner' }],
    ['the resource', { ...BASE, resource: 'Document' }],
    ['the action', { ...BASE, action: 'list' }],
  ];

  it.each(cases)('%s', (_name, identity) => {
    expect(checkIdFor(identity)).not.toBe(checkIdFor(BASE));
  });

  it('two actors against one rule, which are two checks', () => {
    // M3.1 states this outright, and it is what makes an access rule checkable at all:
    // one identity being let through says nothing about another being refused.
    expect(checkIdFor({ ...BASE, actorId: 'owner' })).not.toBe(
      checkIdFor({ ...BASE, actorId: 'outsider' }),
    );
  });

  it('a boundary moving between two adjacent fields', () => {
    // The separator earns its place here. Fields are joined in the order requirementId
    // then ruleId, so without one between them `a` + `bc` and `ab` + `c` are the same
    // string and two different checks collide. The first version of this test used
    // actorId and ruleId, which are not adjacent, so it passed with no separator at all.
    const ids = new Set([
      checkIdFor({ type: 'access', requirementId: 'a', ruleId: 'bc' }),
      checkIdFor({ type: 'access', requirementId: 'ab', ruleId: 'c' }),
    ]);

    expect(ids.size).toBe(2);
  });
});

describe('the shape of a check id', () => {
  it('matches what the contract requires', () => {
    expect(checkIdFor(BASE)).toMatch(/^CHK-[A-Za-z0-9]+$/);
  });

  it('is short enough to read and long enough not to collide across a run', () => {
    expect(checkIdFor(BASE)).toHaveLength('CHK-'.length + 12);
  });

  it('is the same string on every machine, since nothing in it is environmental', () => {
    // A literal, not a recomputation. Recomputing the expected value inside the test
    // would pass against any implementation at all, which is the vacuous shape this
    // repository has now caught three times.
    expect(checkIdFor(BASE)).toBe('CHK-7a29b8228f07');
  });
});

describe('what the planners put into an identity', () => {
  it('the access planner names the resource and the spec action, not a route', () => {
    // Asserted at the planner because the hash alone cannot say what it is given. The
    // first break test here removed `resource: rule.resource` from the planner and no
    // access test noticed, since a rule id already disambiguates within one spec. It
    // stops being redundant the moment a rule is repointed at a different resource,
    // which M5.14 did to AR-011-01.
    const spec = SpecSchema.parse({
      specVersion: '0.1',
      name: 'identity',
      actors: [{ id: 'outsider', description: 'other org' }],
      entities: [{ name: 'Invoice', fields: [{ name: 'id', type: 'string' }] }],
      requirements: [
        {
          id: 'REQ-001',
          statement: 'scoped',
          accessRules: [
            {
              id: 'AR-001-01',
              actor: 'outsider',
              action: 'read',
              resource: 'Invoice',
              effect: 'deny',
            },
          ],
        },
      ],
    });

    const { plans } = planAccessChecks(spec, new Map(), null, {
      actorIds: new Set(['outsider']),
      resources: [
        {
          name: 'Invoice',
          routes: { read: '/api/invoices/{id}' },
          instances: [{ id: 'INV-1', attributes: {} }],
        },
      ],
    });

    const identity = plans[0]?.identity;
    expect(identity?.resource).toBe('Invoice');
    expect(identity?.action).toBe('read');
    // The route is deliberately absent, which is the whole point.
    expect(identity?.action).not.toContain('/');
  });

  it('gives the same id whichever route the resource is served at today', () => {
    // The regeneration case. Same rule, same actor, same resource, moved endpoint.
    const spec = SpecSchema.parse({
      specVersion: '0.1',
      name: 'identity',
      actors: [{ id: 'outsider', description: 'other org' }],
      entities: [{ name: 'Invoice', fields: [{ name: 'id', type: 'string' }] }],
      requirements: [
        {
          id: 'REQ-001',
          statement: 'scoped',
          accessRules: [
            {
              id: 'AR-001-01',
              actor: 'outsider',
              action: 'read',
              resource: 'Invoice',
              effect: 'deny',
            },
          ],
        },
      ],
    });

    const idAt = (route: string): string | undefined => {
      const { plans } = planAccessChecks(spec, new Map(), null, {
        actorIds: new Set(['outsider']),
        resources: [
          {
            name: 'Invoice',
            routes: { read: route },
            instances: [{ id: 'INV-1', attributes: {} }],
          },
        ],
      });
      return plans[0] === undefined ? undefined : checkIdFor(plans[0].identity);
    };

    expect(idAt('/api/invoices/{id}')).toBe(idAt('/v2/invoices/{id}'));
    expect(idAt('/api/invoices/{id}')).toBeDefined();
  });
});
