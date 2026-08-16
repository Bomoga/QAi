import { describe, expect, it } from 'vitest';

import { CheckResultSchema } from '../contracts/index.ts';
import { createCheckRegistry } from './registry.ts';
import { checkIdFor, fail, inconclusive, pass } from './result.ts';
import type { CheckPlan, CheckResult } from './types.ts';

function planFor(overrides: Partial<CheckPlan> = {}): CheckPlan {
  return {
    identity: {
      type: 'access',
      requirementId: 'REQ-001',
      ruleId: 'AR-001-01',
      actorId: 'outsider',
      action: 'GET /api/invoices/:id',
    },
    mutates: false,
    severityOnFail: 'high',
    ...overrides,
  };
}

describe('check identity', () => {
  it('is stable for the same check across runs', () => {
    expect(checkIdFor(planFor().identity)).toBe(checkIdFor(planFor().identity));
  });

  it('matches the contract identifier shape', () => {
    expect(checkIdFor(planFor().identity)).toMatch(/^CHK-[0-9a-f]{12}$/u);
  });

  it.each([
    ['requirement', { requirementId: 'REQ-002' }],
    ['rule', { ruleId: 'AR-001-02' }],
    ['actor', { actorId: 'owner' }],
    ['action', { action: 'GET /api/invoices' }],
  ])('changes when the %s changes, since that is a different check', (_label, change) => {
    const original = checkIdFor(planFor().identity);
    const changed = checkIdFor({ ...planFor().identity, ...change });
    expect(changed).not.toBe(original);
  });

  it('separates two actors against one rule into two checks', () => {
    const owner = checkIdFor({ ...planFor().identity, actorId: 'owner' });
    const outsider = checkIdFor({ ...planFor().identity, actorId: 'outsider' });
    expect(owner).not.toBe(outsider);
  });
});

describe('result construction', () => {
  const input = { identity: planFor().identity, title: 'A title', evidence: ['EV-000001'] };

  it('produces a result matching the contract', () => {
    expect(CheckResultSchema.safeParse(pass(input)).success).toBe(true);
    expect(CheckResultSchema.safeParse(fail(input, 'high')).success).toBe(true);
    expect(CheckResultSchema.safeParse(inconclusive(input)).success).toBe(true);
  });

  it('marks access checks deterministic by default', () => {
    expect(pass(input).deterministic).toBe(true);
  });

  it('carries evidence ids through', () => {
    expect(fail(input, 'high').evidence).toEqual(['EV-000001']);
  });

  it('gives a passing check info severity, since nothing is wrong', () => {
    expect(pass(input).severity).toBe('info');
  });

  it('takes severity from the caller on a failure', () => {
    expect(fail(input, 'medium').severity).toBe('medium');
  });

  it('gives every verdict for one identity the same check id', () => {
    expect(pass(input).checkId).toBe(fail(input, 'high').checkId);
    expect(pass(input).checkId).toBe(inconclusive(input).checkId);
  });
});

describe('the registry', () => {
  it('dispatches to the runner registered for a type', async () => {
    const registry = createCheckRegistry<null>();
    registry.register('access', (plan) =>
      Promise.resolve(pass({ identity: plan.identity, title: 'ran' })),
    );

    const result = await registry.run(planFor(), null);
    expect(result.title).toBe('ran');
  });

  it('reports an unregistered type as inconclusive rather than throwing', async () => {
    const registry = createCheckRegistry<null>();
    const result = await registry.run(planFor(), null);

    expect(result.verdict).toBe('inconclusive');
    expect(result.title).toContain('No runner registered');
  });

  it('turns a thrown error into inconclusive, so the run continues', async () => {
    const registry = createCheckRegistry<null>();
    registry.register('access', () => {
      throw new Error('the target went away');
    });

    const result = await registry.run(planFor(), null);

    expect(result.verdict).toBe('inconclusive');
    expect(result.detail).toContain('the target went away');
  });

  it('turns a rejected promise into inconclusive too', async () => {
    const registry = createCheckRegistry<null>();
    registry.register('access', () => Promise.reject(new Error('connection reset')));

    const result = await registry.run(planFor(), null);

    expect(result.verdict).toBe('inconclusive');
    expect(result.detail).toContain('connection reset');
  });

  it('never lets one failing check remove the checks after it', async () => {
    const registry = createCheckRegistry<null>();
    let ran = 0;
    registry.register('access', (plan) => {
      ran += 1;
      if (plan.identity.actorId === 'boom') throw new Error('boom');
      return Promise.resolve(pass({ identity: plan.identity, title: 'ok' }));
    });

    const results = await registry.runAll(
      [
        planFor({ identity: { ...planFor().identity, actorId: 'a' } }),
        planFor({ identity: { ...planFor().identity, actorId: 'boom' } }),
        planFor({ identity: { ...planFor().identity, actorId: 'c' } }),
      ],
      null,
    );

    expect(ran).toBe(3);
    expect(results).toHaveLength(3);
    expect(results.map((result) => result.verdict)).toEqual(['pass', 'inconclusive', 'pass']);
  });

  it('runs mutating checks after every non-mutating one', async () => {
    const registry = createCheckRegistry<null>();
    const order: string[] = [];
    registry.register('access', (plan) => {
      order.push(plan.identity.actorId ?? '');
      return Promise.resolve(pass({ identity: plan.identity, title: 'ok' }));
    });

    await registry.runAll(
      [
        planFor({ mutates: true, identity: { ...planFor().identity, actorId: 'writer' } }),
        planFor({ mutates: false, identity: { ...planFor().identity, actorId: 'reader' } }),
      ],
      null,
    );

    expect(order).toEqual(['reader', 'writer']);
  });

  it('reports which types have a runner', () => {
    const registry = createCheckRegistry<null>();
    expect(registry.has('access')).toBe(false);

    registry.register('access', (plan) =>
      Promise.resolve(pass({ identity: plan.identity, title: 'ok' })),
    );
    expect(registry.has('access')).toBe(true);
    expect(registry.has('behavioral')).toBe(false);
  });

  it('keeps the check id of a plan whose runner threw, so a run can still compare it', async () => {
    const registry = createCheckRegistry<null>();
    registry.register('access', () => {
      throw new Error('boom');
    });

    const result: CheckResult = await registry.run(planFor(), null);
    expect(result.checkId).toBe(checkIdFor(planFor().identity));
  });
});
