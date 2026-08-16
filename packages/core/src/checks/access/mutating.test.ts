import { describe, expect, it } from 'vitest';

import { SpecSchema, type Spec } from '../../contracts/index.ts';
import { rulesFor } from '../../evidence/redact.ts';
import type { ResolvedActor } from '../../target/credentials.ts';
import { fixedDeps } from '../../target/deps.ts';
import type { HttpClient, RequestOutcome } from '../../target/request.ts';
import { createActorSessions } from '../../target/session.ts';
import { planAccessChecks, type AccessCheckPlan, type PlanningContext } from './plan.ts';
import { runAccessCheck, runAccessChecks, type AccessRunContext } from './run.ts';

/**
 * Invariant I7 at the check level. A mutating check against a target nobody declared
 * disposable does not run, and the ordering guarantees hold whatever order the caller
 * hands the plans over in.
 */

const SPEC: Spec = SpecSchema.parse({
  specVersion: '0.1',
  name: 'Ledger',
  entities: [{ name: 'Invoice', fields: [{ name: 'org_id', type: 'string' }] }],
  requirements: [
    {
      id: 'REQ-003',
      statement: 'Modifying an invoice requires an authenticated caller',
      accessRules: [
        {
          id: 'AR-003-01',
          actor: 'outsider',
          action: 'update',
          resource: 'Invoice',
          condition: 'Invoice.org_id != actor.org_id',
          effect: 'deny',
        },
        {
          id: 'AR-003-02',
          actor: 'outsider',
          action: 'delete',
          resource: 'Invoice',
          condition: 'Invoice.org_id != actor.org_id',
          effect: 'deny',
        },
        {
          id: 'AR-003-03',
          actor: 'outsider',
          action: 'read',
          resource: 'Invoice',
          condition: 'Invoice.org_id != actor.org_id',
          effect: 'deny',
        },
      ],
    },
  ],
});

const CONTEXT: PlanningContext = {
  actorIds: new Set(['outsider']),
  resources: [
    {
      name: 'Invoice',
      routes: {
        read: '/api/invoices/{id}',
        update: '/api/invoices/{id}',
        delete: '/api/invoices/{id}',
      },
      instances: [{ id: 'INV-1001', attributes: { org_id: 'org-1' } }],
    },
  ],
};

const ACTORS: ResolvedActor[] = [
  { id: 'outsider', credential: { kind: 'bearer', token: 'x' }, attributes: { org_id: 'org-2' } },
];

function refused(): RequestOutcome {
  return {
    kind: 'response',
    response: { status: 403, headers: {}, body: '{}', truncated: false, durationMs: 1 },
  };
}

function recordingClient(): { client: HttpClient; sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    client: {
      send: (spec) => {
        sent.push(`${spec.method} ${spec.path}`);
        return Promise.resolve(refused());
      },
    },
  };
}

function plans(): AccessCheckPlan[] {
  return [...planAccessChecks(SPEC, new Map(), null, CONTEXT).plans];
}

function contextWith(
  client: HttpClient,
  mutation?: AccessRunContext['mutation'],
): AccessRunContext {
  return {
    sessions: createActorSessions(ACTORS, { client, rules: rulesFor(SPEC), deps: fixedDeps() }),
    ...(mutation === undefined ? {} : { mutation }),
  };
}

describe('the disposability gate at the check level', () => {
  it('marks update and delete as mutating and read as not', () => {
    const byRule = new Map(plans().map((plan) => [plan.ruleId, plan]));

    expect(byRule.get('AR-003-01')?.mutates).toBe(true);
    expect(byRule.get('AR-003-02')?.mutates).toBe(true);
    expect(byRule.get('AR-003-03')?.mutates).toBe(false);
  });

  it('sends nothing for a mutating check when no permission was given', async () => {
    const { client, sent } = recordingClient();
    const mutatingPlan = plans().find((plan) => plan.mutates) as AccessCheckPlan;

    const result = await runAccessCheck(mutatingPlan, contextWith(client));

    expect(result.verdict).toBe('inconclusive');
    expect(sent).toEqual([]);
  });

  it('sends nothing when permission is explicitly refused, and says why', async () => {
    const { client, sent } = recordingClient();
    const mutatingPlan = plans().find((plan) => plan.mutates) as AccessCheckPlan;

    const result = await runAccessCheck(
      mutatingPlan,
      contextWith(client, {
        allowed: false,
        refusal: 'target.disposable is not true, so fixtures and mutating checks will not run.',
      }),
    );

    expect(result.verdict).toBe('inconclusive');
    expect(result.detail).toContain('target.disposable');
    expect(sent).toEqual([]);
  });

  it('runs a mutating check once permission is given', async () => {
    const { client, sent } = recordingClient();
    const mutatingPlan = plans().find((plan) => plan.mutates) as AccessCheckPlan;

    const result = await runAccessCheck(mutatingPlan, contextWith(client, { allowed: true }));

    expect(result.verdict).toBe('pass');
    expect(sent).toEqual(['PATCH /api/invoices/INV-1001']);
  });

  it('never gates a non-mutating check on the interlock', async () => {
    const { client, sent } = recordingClient();
    const readPlan = plans().find((plan) => !plan.mutates) as AccessCheckPlan;

    const result = await runAccessCheck(readPlan, contextWith(client));

    expect(result.verdict).toBe('pass');
    expect(sent).toEqual(['GET /api/invoices/INV-1001']);
  });
});

describe('batch ordering', () => {
  it('runs every non-mutating check before any mutating one', async () => {
    const { client, sent } = recordingClient();
    // Handed over mutating first, to prove the order comes from the plans.
    const ordered = [...plans()].sort((a, b) => Number(b.mutates) - Number(a.mutates));

    await runAccessChecks(ordered, contextWith(client, { allowed: true }));

    expect(sent[0]).toBe('GET /api/invoices/INV-1001');
    expect(
      sent.slice(1).every((entry) => entry.startsWith('PATCH') || entry.startsWith('DELETE')),
    ).toBe(true);
  });

  it('resets between mutating checks, but not after the last one', async () => {
    const { client } = recordingClient();
    let resets = 0;

    await runAccessChecks(
      plans(),
      contextWith(client, {
        allowed: true,
        reset: () => {
          resets += 1;
          return Promise.resolve();
        },
      }),
    );

    // Two mutating checks means one reset between them.
    expect(resets).toBe(1);
  });

  it('runs mutating checks one at a time', async () => {
    const inFlight: number[] = [];
    let concurrent = 0;

    const client: HttpClient = {
      send: async () => {
        concurrent += 1;
        inFlight.push(concurrent);
        await Promise.resolve();
        concurrent -= 1;
        return refused();
      },
    };

    await runAccessChecks(plans(), contextWith(client, { allowed: true }));

    expect(Math.max(...inFlight)).toBe(1);
  });

  it('stops the remaining mutating checks when a reset fails', async () => {
    const { client, sent } = recordingClient();

    const results = await runAccessChecks(
      plans(),
      contextWith(client, {
        allowed: true,
        reset: () => Promise.reject(new Error('db:reset exited 1')),
      }),
    );

    // The read plus the first mutating check ran; the second did not.
    expect(sent).toHaveLength(2);

    const skipped = results.find((result) => result.detail?.includes('db:reset exited 1'));
    expect(skipped?.verdict).toBe('inconclusive');
  });

  it('returns a result for every plan even when some were not attempted', async () => {
    const { client } = recordingClient();

    const results = await runAccessChecks(
      plans(),
      contextWith(client, {
        allowed: true,
        reset: () => Promise.reject(new Error('boom')),
      }),
    );

    expect(results).toHaveLength(plans().length);
  });

  it('reports every mutating check as inconclusive when permission is refused', async () => {
    const { client, sent } = recordingClient();

    const results = await runAccessChecks(plans(), contextWith(client, { allowed: false }));
    const mutatingResults = results.filter((result) => result.title.includes('Mutating check'));

    expect(mutatingResults).toHaveLength(2);
    expect(mutatingResults.every((result) => result.verdict === 'inconclusive')).toBe(true);
    expect(sent).toEqual(['GET /api/invoices/INV-1001']);
  });
});
