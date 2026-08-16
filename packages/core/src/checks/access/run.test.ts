import { describe, expect, it } from 'vitest';

import { CheckResultSchema, SpecSchema, type Spec } from '../../contracts/index.ts';
import { rulesFor } from '../../evidence/redact.ts';
import { parseCondition, type ConditionAst } from '../../spec/condition.ts';
import { fixedDeps } from '../../target/deps.ts';
import type { HttpClient, RequestOutcome } from '../../target/request.ts';
import { createActorSessions } from '../../target/session.ts';
import type { ResolvedActor } from '../../target/credentials.ts';
import { planAccessChecks, type AccessCheckPlan, type PlanningContext } from './plan.ts';
import { runAccessCheck } from './run.ts';
import { assessAllowOutcome } from './verdict.ts';

const SPEC: Spec = SpecSchema.parse({
  specVersion: '0.1',
  name: 'Ledger',
  entities: [
    {
      name: 'Invoice',
      fields: [
        { name: 'id', type: 'string' },
        { name: 'org_id', type: 'string' },
        { name: 'total_cents', type: 'number' },
      ],
    },
  ],
  requirements: [
    {
      id: 'REQ-001',
      statement: 'A user can only read invoices belonging to their own organization',
      accessRules: [
        {
          id: 'AR-001-01',
          actor: 'outsider',
          action: 'read',
          resource: 'Invoice',
          condition: 'Invoice.org_id != actor.org_id',
          effect: 'deny',
        },
        {
          id: 'AR-001-02',
          actor: 'owner',
          action: 'read',
          resource: 'Invoice',
          condition: 'Invoice.org_id == actor.org_id',
          effect: 'allow',
        },
      ],
    },
  ],
});

const CONTEXT: PlanningContext = {
  actorIds: new Set(['owner', 'outsider']),
  resources: [
    {
      name: 'Invoice',
      routes: { read: '/api/invoices/{id}' },
      instances: [
        { id: 'INV-1001', attributes: { org_id: 'org-1' } },
        { id: 'INV-2001', attributes: { org_id: 'org-2' } },
      ],
    },
  ],
};

function conditions(): Map<string, ConditionAst> {
  const map = new Map<string, ConditionAst>();
  for (const [id, source] of [
    ['AR-001-01', 'Invoice.org_id != actor.org_id'],
    ['AR-001-02', 'Invoice.org_id == actor.org_id'],
  ] as const) {
    const parsed = parseCondition(source);
    if (parsed.kind !== 'error') map.set(id, parsed);
  }
  return map;
}

const ACTORS: ResolvedActor[] = [
  { id: 'owner', credential: { kind: 'bearer', token: 'o' }, attributes: { org_id: 'org-1' } },
  { id: 'outsider', credential: { kind: 'bearer', token: 'x' }, attributes: { org_id: 'org-2' } },
];

/** Answers whatever the test tells it to, and records the paths it was asked for. */
function clientAnswering(answer: (path: string) => RequestOutcome): {
  client: HttpClient;
  paths: string[];
} {
  const paths: string[] = [];
  return {
    paths,
    client: {
      send: (spec) => {
        paths.push(spec.path);
        return Promise.resolve(answer(spec.path));
      },
    },
  };
}

function ok(body: string, status = 200): RequestOutcome {
  return {
    kind: 'response',
    response: { status, headers: {}, body, truncated: false, durationMs: 1 },
  };
}

function refused(status: number): RequestOutcome {
  return {
    kind: 'response',
    response: {
      status,
      headers: {},
      body: '{"error":"not_found"}',
      truncated: false,
      durationMs: 1,
    },
  };
}

const INVOICE_1001 = JSON.stringify({ id: 'INV-1001', org_id: 'org-1', total_cents: 125000 });

function plansFor(): AccessCheckPlan[] {
  return [...planAccessChecks(SPEC, conditions(), null, CONTEXT).plans];
}

function contextWith(client: HttpClient) {
  return {
    sessions: createActorSessions(ACTORS, {
      client,
      rules: rulesFor(SPEC),
      deps: fixedDeps(),
    }),
  };
}

describe('a deny rule', () => {
  const denyPlan = () => plansFor()[0] as AccessCheckPlan;

  it('acts on a record belonging to someone else', async () => {
    const { client, paths } = clientAnswering(() => refused(404));
    await runAccessCheck(denyPlan(), contextWith(client));

    // The outsider is org-2, so the foreign invoice is the org-1 one.
    expect(paths).toEqual(['/api/invoices/INV-1001']);
  });

  it('fails when the record comes back, naming actor, request, status, and fields', async () => {
    const { client } = clientAnswering(() => ok(INVOICE_1001));
    const result = await runAccessCheck(denyPlan(), contextWith(client));

    expect(result.verdict).toBe('fail');
    expect(result.severity).toBe('high');
    expect(result.detail).toContain('GET /api/invoices/INV-1001');
    expect(result.detail).toContain('actor outsider');
    expect(result.detail).toContain('200');
    expect(result.detail).toContain('org_id');
  });

  it('passes when the record is refused', async () => {
    const { client } = clientAnswering(() => refused(404));
    const result = await runAccessCheck(denyPlan(), contextWith(client));

    expect(result.verdict).toBe('pass');
    expect(result.detail).toContain('no Invoice fields');
  });

  it('is inconclusive on an empty 200 rather than passing', async () => {
    const { client } = clientAnswering(() => ok(''));
    const result = await runAccessCheck(denyPlan(), contextWith(client));

    expect(result.verdict).toBe('inconclusive');
    expect(result.detail).toContain('may be a refusal');
  });

  it('is inconclusive when the target could not be reached', async () => {
    const client: HttpClient = {
      send: () =>
        Promise.resolve({ kind: 'transport-error', message: 'ECONNREFUSED', durationMs: 1 }),
    };
    const result = await runAccessCheck(denyPlan(), contextWith(client));

    expect(result.verdict).toBe('inconclusive');
    expect(result.detail).toContain('did not complete');
  });

  it('carries evidence whatever the verdict', async () => {
    for (const answer of [() => ok(INVOICE_1001), () => refused(403), () => ok('')]) {
      const { client } = clientAnswering(answer);
      const result = await runAccessCheck(denyPlan(), contextWith(client));
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0]).toMatch(/^EV-/u);
    }
  });

  it('never names a vulnerability class', async () => {
    const { client } = clientAnswering(() => ok(INVOICE_1001));
    const result = await runAccessCheck(denyPlan(), contextWith(client));
    const text = `${result.title} ${result.detail ?? ''}`.toLowerCase();

    for (const banned of ['idor', 'vulnerab', 'exploit', 'injection', 'cve', 'owasp']) {
      expect(text).not.toContain(banned);
    }
  });
});

describe('an allow rule', () => {
  const allowPlan = () => plansFor()[1] as AccessCheckPlan;

  it('acts on a record the actor owns', async () => {
    const { client, paths } = clientAnswering(() => ok(INVOICE_1001));
    await runAccessCheck(allowPlan(), contextWith(client));

    // The owner is org-1, so their own invoice is the org-1 one.
    expect(paths).toEqual(['/api/invoices/INV-1001']);
  });

  it('passes on a 2xx', async () => {
    const { client } = clientAnswering(() => ok(INVOICE_1001));
    const result = await runAccessCheck(allowPlan(), contextWith(client));

    expect(result.verdict).toBe('pass');
  });

  it('passes on a 204, since success is the whole assertion', async () => {
    const { client } = clientAnswering(() => ok('', 204));
    const result = await runAccessCheck(allowPlan(), contextWith(client));

    expect(result.verdict).toBe('pass');
  });

  it('fails when a permitted actor is refused', async () => {
    const { client } = clientAnswering(() => refused(403));
    const result = await runAccessCheck(allowPlan(), contextWith(client));

    expect(result.verdict).toBe('fail');
    expect(result.severity).toBe('medium');
    expect(result.detail).toContain('403');
  });

  it.each([500, 400, 429])(
    'is inconclusive on %d rather than reporting a refusal',
    async (status) => {
      const { client } = clientAnswering(() => refused(status));
      const result = await runAccessCheck(allowPlan(), contextWith(client));

      expect(result.verdict).toBe('inconclusive');
    },
  );
});

describe('when no suitable record exists', () => {
  it('is inconclusive rather than requesting an id that was never seeded', async () => {
    const empty: PlanningContext = {
      ...CONTEXT,
      resources: [{ name: 'Invoice', routes: { read: '/api/invoices/{id}' }, instances: [] }],
    };
    const plan = planAccessChecks(SPEC, conditions(), null, empty).plans[0] as AccessCheckPlan;

    const { client, paths } = clientAnswering(() => refused(404));
    const result = await runAccessCheck(plan, contextWith(client));

    expect(result.verdict).toBe('inconclusive');
    expect(paths).toEqual([]);
    expect(result.detail).toContain('proves nothing');
  });

  it('is inconclusive when ownership cannot be established', async () => {
    const undecidable = new Map<string, ConditionAst>();
    const parsed = parseCondition('Invoice.org_id != actor.team_id');
    if (parsed.kind !== 'error') undecidable.set('AR-001-01', parsed);

    const plan = planAccessChecks(SPEC, undecidable, null, CONTEXT).plans[0] as AccessCheckPlan;
    const { client, paths } = clientAnswering(() => refused(404));
    const result = await runAccessCheck(plan, contextWith(client));

    expect(result.verdict).toBe('inconclusive');
    expect(paths).toEqual([]);
    expect(result.detail).toContain('could not be established');
  });

  it('is inconclusive when the actor has no session', async () => {
    const plan = plansFor()[0] as AccessCheckPlan;
    const result = await runAccessCheck(plan, { sessions: new Map() });

    expect(result.verdict).toBe('inconclusive');
    expect(result.title).toContain('outsider');
  });
});

describe('every result', () => {
  it('matches the CheckResult contract', async () => {
    const { client } = clientAnswering(() => ok(INVOICE_1001));

    for (const plan of plansFor()) {
      const result = await runAccessCheck(plan, contextWith(client));
      expect(CheckResultSchema.safeParse(result).success).toBe(true);
      expect(result.deterministic).toBe(true);
      expect(result.type).toBe('access');
    }
  });
});

describe('the allow assessment', () => {
  it.each([
    [200, 'pass'],
    [201, 'pass'],
    [204, 'pass'],
    [401, 'fail'],
    [403, 'fail'],
    [404, 'fail'],
    [500, 'inconclusive'],
    [400, 'inconclusive'],
  ])('maps %d to %s', (status, expected) => {
    expect(assessAllowOutcome(refused(status), ['id']).verdict).toBe(expected);
  });

  it('is inconclusive on a transport error', () => {
    const outcome: RequestOutcome = { kind: 'transport-error', message: 'x', durationMs: 1 };
    expect(assessAllowOutcome(outcome, ['id']).verdict).toBe('inconclusive');
  });
});
