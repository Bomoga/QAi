import { describe, expect, it } from 'vitest';

import { SpecSchema, type Spec } from '../../contracts/index.ts';
import { rulesFor } from '../../evidence/redact.ts';
import type { ResolvedActor } from '../../target/credentials.ts';
import { fixedDeps } from '../../target/deps.ts';
import type { HttpClient, RequestOutcome } from '../../target/request.ts';
import { createActorSessions } from '../../target/session.ts';
import { parseCondition, type ConditionAst } from '../../spec/condition.ts';
import {
  denyFailureDetail,
  FORBIDDEN_FINDING_TERMS,
  referenceLine,
  severityForAccessFailure,
  suggestionFor,
} from './findings.ts';
import { planAccessChecks, type AccessCheckPlan, type PlanningContext } from './plan.ts';
import { runAccessCheck } from './run.ts';

const SPEC: Spec = SpecSchema.parse({
  specVersion: '0.1',
  name: 'Ledger',
  entities: [
    {
      name: 'Invoice',
      fields: [
        { name: 'id', type: 'string' },
        { name: 'org_id', type: 'string' },
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
        {
          id: 'AR-001-03',
          actor: 'outsider',
          action: 'list',
          resource: 'Invoice',
          condition: 'Invoice.org_id != actor.org_id',
          effect: 'deny',
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
      routes: { read: '/api/invoices/{id}', list: '/api/invoices' },
      instances: [
        { id: 'INV-1001', attributes: { org_id: 'org-1' } },
        { id: 'INV-2001', attributes: { org_id: 'org-2' } },
      ],
    },
  ],
};

const ACTORS: ResolvedActor[] = [
  { id: 'owner', credential: { kind: 'bearer', token: 'o' }, attributes: { org_id: 'org-1' } },
  { id: 'outsider', credential: { kind: 'bearer', token: 'x' }, attributes: { org_id: 'org-2' } },
];

/** Conditions are parsed for real, so a list plan can actually judge row ownership. */
function conditions(): Map<string, ConditionAst> {
  const map = new Map<string, ConditionAst>();
  for (const [id, source] of [
    ['AR-001-01', 'Invoice.org_id != actor.org_id'],
    ['AR-001-02', 'Invoice.org_id == actor.org_id'],
    ['AR-001-03', 'Invoice.org_id != actor.org_id'],
  ] as const) {
    const parsed = parseCondition(source);
    if (parsed.kind !== 'error') map.set(id, parsed);
  }
  return map;
}

function plans(): AccessCheckPlan[] {
  return [...planAccessChecks(SPEC, conditions(), null, CONTEXT).plans];
}

function answering(outcome: RequestOutcome): HttpClient {
  return { send: () => Promise.resolve(outcome) };
}

function ok(body: string, status = 200): RequestOutcome {
  return {
    kind: 'response',
    response: { status, headers: {}, body, truncated: false, durationMs: 1 },
  };
}

function contextWith(client: HttpClient) {
  return {
    sessions: createActorSessions(ACTORS, { client, rules: rulesFor(SPEC), deps: fixedDeps() }),
  };
}

const LEAKED = JSON.stringify({ id: 'INV-1001', org_id: 'org-1' });

describe('severity', () => {
  it('gives a deny failure high, since something forbidden is reachable', () => {
    const deny = plans()[0] as AccessCheckPlan;
    expect(severityForAccessFailure(deny)).toBe('high');
  });

  it('gives an allow failure medium, since a broken feature is not an exposure', () => {
    const allow = plans()[1] as AccessCheckPlan;
    expect(severityForAccessFailure(allow)).toBe('medium');
  });

  it('does not scale severity by which fields came back', () => {
    const deny = plans()[0] as AccessCheckPlan;
    const withoutFields = { ...deny, resourceFields: [] };
    expect(severityForAccessFailure(withoutFields)).toBe(severityForAccessFailure(deny));
  });
});

describe('a finding states the observation', () => {
  it('names the actor, the request, the status, and the fields', async () => {
    const result = await runAccessCheck(
      plans()[0] as AccessCheckPlan,
      contextWith(answering(ok(LEAKED))),
    );

    expect(result.detail).toContain('GET /api/invoices/INV-1001');
    expect(result.detail).toContain('actor outsider');
    expect(result.detail).toContain('returned 200');
    expect(result.detail).toContain('org_id');
  });

  it('never claims intent', async () => {
    const result = await runAccessCheck(
      plans()[0] as AccessCheckPlan,
      contextWith(answering(ok(LEAKED))),
    );
    const text = `${result.title} ${result.detail ?? ''}`.toLowerCase();

    for (const phrase of ['meant to', 'intended', 'forgot', 'should have', 'developer']) {
      expect(text).not.toContain(phrase);
    }
  });

  it.each(FORBIDDEN_FINDING_TERMS)('never uses the classifying term %s', async (term) => {
    const result = await runAccessCheck(
      plans()[0] as AccessCheckPlan,
      contextWith(answering(ok(LEAKED))),
    );
    const text = `${result.title} ${result.detail ?? ''}`.toLowerCase();
    expect(text).not.toContain(term);
  });
});

describe('a finding ends with a reference', () => {
  it('cites the request when no source is available', async () => {
    const result = await runAccessCheck(
      plans()[0] as AccessCheckPlan,
      contextWith(answering(ok(LEAKED))),
    );

    expect(result.detail).toContain('Request: GET /api/invoices/INV-1001');
    expect(result.detail).toContain('Evidence: EV-000001');
  });

  it('cites the source when a probe supplied a handler', () => {
    const plan = {
      ...(plans()[0] as AccessCheckPlan),
      locationRef: 'app/api/invoices/[id]/route.ts:12',
    };
    const line = referenceLine(plan, 'GET /api/invoices/INV-1001', 'EV-000001');

    expect(line).toContain('Source: app/api/invoices/[id]/route.ts:12');
    expect(line).not.toContain('Request:');
  });

  it('carries the source into locationRef on the result', async () => {
    const plan = { ...(plans()[0] as AccessCheckPlan), locationRef: 'app/route.ts:12' };
    const result = await runAccessCheck(plan, contextWith(answering(ok(LEAKED))));

    expect(result.locationRef).toBe('app/route.ts:12');
  });
});

describe('a suggested fix', () => {
  it('is labeled as a suggestion', async () => {
    const result = await runAccessCheck(
      plans()[0] as AccessCheckPlan,
      contextWith(answering(ok(LEAKED))),
    );
    expect(result.detail).toContain('Suggestion:');
  });

  it('names the handler and the condition, so it can be pasted into a coding agent', () => {
    const suggestion = suggestionFor(plans()[0] as AccessCheckPlan);

    expect(suggestion).toContain('GET /api/invoices/{id}');
    expect(suggestion).toContain('Invoice.org_id != actor.org_id');
  });

  it('tells a list rule to filter in the query rather than after fetching', () => {
    const listPlan = plans().find((plan) => plan.action === 'list') as AccessCheckPlan;
    expect(suggestionFor(listPlan)).toContain('filtering in the query');
  });

  it('reads differently for an allow rule, which is about permitting rather than refusing', () => {
    const allow = plans()[1] as AccessCheckPlan;
    expect(suggestionFor(allow)).toContain('allow');
    expect(suggestionFor(allow)).not.toContain('respond 404');
  });

  it('is absent from a passing check, which has nothing to fix', async () => {
    const result = await runAccessCheck(
      plans()[0] as AccessCheckPlan,
      contextWith(answering(ok('{"error":"not_found"}', 404))),
    );

    expect(result.verdict).toBe('pass');
    expect(result.detail).not.toContain('Suggestion:');
  });
});

describe('a list finding', () => {
  it('names the rows the rule denies', async () => {
    const body = JSON.stringify([
      { id: 'INV-1001', org_id: 'org-1' },
      { id: 'INV-2001', org_id: 'org-2' },
    ]);
    const listPlan = plans().find((plan) => plan.action === 'list') as AccessCheckPlan;
    const result = await runAccessCheck(listPlan, contextWith(answering(ok(body))));

    expect(result.verdict).toBe('fail');
    expect(result.detail).toContain('2 row(s)');
    expect(result.detail).toContain('INV-1001');
    expect(result.detail).toContain('Suggestion:');
  });
});

describe('a finding reads as sentences', () => {
  it('closes the observation before the reference begins', () => {
    // It used to read "... with Invoice fields id, notes Request: GET /api/invoices/1",
    // two statements run together, on every access finding the corpus recorded.
    const plan = plans()[0] as AccessCheckPlan;
    const detail = denyFailureDetail({
      plan,
      request: 'GET /api/invoices/INV-1001',
      status: 200,
      evidenceId: 'EV-000001',
      observedFields: ['id', 'notes'],
    });

    expect(detail).toContain('notes. Request:');
    expect(detail).not.toContain('notes Request:');
  });

  it('does the same when the reference is a file', () => {
    const plan = { ...(plans()[0] as AccessCheckPlan), locationRef: 'src/routes.ts:12' };
    const detail = denyFailureDetail({
      plan,
      request: 'GET /api/invoices/INV-1001',
      status: 200,
      evidenceId: 'EV-000001',
      observedFields: ['id'],
    });

    expect(detail).toContain('id. Source: src/routes.ts:12.');
  });
});
