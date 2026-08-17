import { describe, expect, it } from 'vitest';

import type { CapturedResponse, RequestSpec } from '../../target/request.ts';
import type { ActorSession } from '../../target/session.ts';
import { FORBIDDEN_FINDING_TERMS } from '../access/findings.ts';
import type { Assertion } from './assertions.ts';
import { evaluateAssertion, readPath, runDeterministicCheck } from './deterministic.ts';
import type { BehavioralContext, BehavioralPlan } from './types.ts';

/**
 * The runner against a fake session, so nothing here touches the network, per rule R9.
 * What is under test is the three-valued evaluation and the verdict it produces, not the
 * transport, which M2 already covers.
 */

function response(overrides: Partial<CapturedResponse> = {}): CapturedResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: '{}',
    truncated: false,
    durationMs: 5,
    ...overrides,
  };
}

function sessionReturning(
  captured: CapturedResponse,
  sent: RequestSpec[] = [],
): ReadonlyMap<string, ActorSession> {
  const session = {
    id: 'owner',
    attributes: {},
    request(spec: RequestSpec) {
      sent.push(spec);
      return Promise.resolve({
        outcome: { kind: 'response' as const, response: captured },
        evidenceId: 'EV-000001',
        evidence: {} as never,
      });
    },
  };

  return new Map([['owner', session]]);
}

function failingSession(message: string): ReadonlyMap<string, ActorSession> {
  const session = {
    id: 'owner',
    attributes: {},
    request() {
      return Promise.resolve({
        outcome: { kind: 'transport-error' as const, message, durationMs: 1 },
        evidenceId: 'EV-000002',
        evidence: {} as never,
      });
    },
  };

  return new Map([['owner', session]]);
}

function plan(overrides: Partial<BehavioralPlan> = {}): BehavioralPlan {
  return {
    identity: { type: 'behavioral', requirementId: 'REQ-012', ruleId: 'AC-012-01' },
    mutates: false,
    severityOnFail: 'medium',
    requirementId: 'REQ-012',
    criterionId: 'AC-012-01',
    actorId: 'owner',
    request: { method: 'GET', path: '/api/invoices/INV-9999' },
    assertions: [{ kind: 'status', codes: [404] }],
    mode: 'deterministic',
    given: 'a seeded invoice',
    when: 'actor owner reads Invoice INV-9999',
    then: 'the response status is 404',
    ...overrides,
  };
}

const context = (sessions: ReadonlyMap<string, ActorSession>): BehavioralContext => ({ sessions });

describe('reading a path out of a body', () => {
  it.each([
    ['id', { id: 'INV-1' }, 'INV-1'],
    ['invoice.id', { invoice: { id: 'INV-1' } }, 'INV-1'],
    ['items[0].id', { items: [{ id: 'INV-1' }] }, 'INV-1'],
  ])('reads %s', (path, body, expected) => {
    expect(readPath(body, path)).toEqual({ found: true, value: expected });
  });

  it('reports a missing path rather than undefined-as-a-value', () => {
    expect(readPath({ id: 'INV-1' }, 'missing')).toEqual({ found: false, value: undefined });
  });

  it('does not read an inherited property', () => {
    expect(readPath({ id: 'INV-1' }, 'constructor').found).toBe(false);
  });

  it('reports an index past the end of a list', () => {
    expect(readPath({ items: [] }, 'items[2]').found).toBe(false);
  });
});

describe('evaluating one assertion', () => {
  it.each([
    [{ kind: 'status', codes: [404] } as Assertion, response({ status: 404 }), 'satisfied'],
    [{ kind: 'status', codes: [404] } as Assertion, response({ status: 200 }), 'violated'],
    [{ kind: 'status', codes: [403, 404] } as Assertion, response({ status: 403 }), 'satisfied'],
  ])('reads a status assertion', (assertion, captured, state) => {
    expect(evaluateAssertion(assertion, captured).state).toBe(state);
  });

  it('finds a field at any depth, since a record may be enveloped', () => {
    const assertion: Assertion = { kind: 'field-present', entity: 'Invoice', field: 'org_id' };
    const captured = response({ body: '{"invoices":[{"org_id":"org-1"}]}' });

    expect(evaluateAssertion(assertion, captured).state).toBe('satisfied');
  });

  it('reports an absent field as satisfied when absence was asserted', () => {
    const assertion: Assertion = { kind: 'field-absent', entity: 'Invoice', field: 'notes' };
    const captured = response({ body: '{"id":"INV-1"}' });

    expect(evaluateAssertion(assertion, captured).state).toBe('satisfied');
  });

  it('reports a present field as violated when absence was asserted', () => {
    const assertion: Assertion = { kind: 'field-absent', entity: 'Invoice', field: 'notes' };
    const captured = response({ body: '{"notes":"private"}' });

    expect(evaluateAssertion(assertion, captured).state).toBe('violated');
  });

  it('cannot evaluate a field assertion against a body that is not JSON', () => {
    const assertion: Assertion = { kind: 'field-present', entity: 'Invoice', field: 'org_id' };
    const captured = response({ body: '<html>hello</html>' });

    expect(evaluateAssertion(assertion, captured).state).toBe('unevaluable');
  });

  it('compares a value by path', () => {
    const assertion: Assertion = { kind: 'body-equals', path: 'status', value: 'ok' };

    expect(evaluateAssertion(assertion, response({ body: '{"status":"ok"}' })).state).toBe(
      'satisfied',
    );
    expect(evaluateAssertion(assertion, response({ body: '{"status":"down"}' })).state).toBe(
      'violated',
    );
  });

  it('treats a missing path as violated rather than unevaluable, since the body was read', () => {
    const assertion: Assertion = { kind: 'body-equals', path: 'status', value: 'ok' };
    expect(evaluateAssertion(assertion, response({ body: '{}' })).state).toBe('violated');
  });

  it('sees nothing about persisted state in the response to the action', () => {
    const assertion: Assertion = { kind: 'record-count', entity: 'AuditLog', count: 1 };
    const outcome = evaluateAssertion(assertion, response());

    // The count is read by a second request, in the runner. This function is pure and
    // only ever sees the response to the action itself.
    expect(outcome.state).toBe('unevaluable');
    expect(outcome.observed).toContain('read separately');
  });

  it('reads response time against the measured duration', () => {
    const assertion: Assertion = { kind: 'response-time', maxMs: 100 };

    expect(evaluateAssertion(assertion, response({ durationMs: 40 })).state).toBe('satisfied');
    expect(evaluateAssertion(assertion, response({ durationMs: 400 })).state).toBe('violated');
  });
});

describe('running a check', () => {
  it('passes when every assertion holds, carrying the evidence', async () => {
    const result = await runDeterministicCheck(
      plan(),
      context(sessionReturning(response({ status: 404 }))),
    );

    expect(result.verdict).toBe('pass');
    expect(result.type).toBe('behavioral');
    expect(result.deterministic).toBe(true);
    expect(result.evidence).toEqual(['EV-000001']);
  });

  it('fails when an assertion is violated, naming actor, request, and response', async () => {
    const result = await runDeterministicCheck(
      plan(),
      context(sessionReturning(response({ status: 200 }))),
    );

    expect(result.verdict).toBe('fail');
    expect(result.severity).toBe('medium');
    expect(result.detail).toContain('GET /api/invoices/INV-9999');
    expect(result.detail).toContain('actor owner');
    expect(result.detail).toContain('status 200');
    expect(result.evidence).toEqual(['EV-000001']);
  });

  it('issues exactly the request the plan carries', async () => {
    const sent: RequestSpec[] = [];
    await runDeterministicCheck(plan(), context(sessionReturning(response(), sent)));

    expect(sent).toEqual([{ method: 'GET', path: '/api/invoices/INV-9999' }]);
  });

  it('is inconclusive when the target could not be reached', async () => {
    const result = await runDeterministicCheck(
      plan(),
      context(failingSession('connect ECONNREFUSED')),
    );

    expect(result.verdict).toBe('inconclusive');
    expect(result.detail).toContain('connect ECONNREFUSED');
    expect(result.evidence).toEqual(['EV-000002']);
  });

  it('is inconclusive when nothing could be evaluated', async () => {
    const result = await runDeterministicCheck(
      plan({
        assertions: [{ kind: 'field-present', entity: 'Invoice', field: 'id' }],
        then: 'body contains field Invoice.id',
      }),
      context(sessionReturning(response({ body: 'not json' }))),
    );

    expect(result.verdict).toBe('inconclusive');
  });

  it('fails rather than hedging when one assertion is proven false and another cannot be read', async () => {
    const result = await runDeterministicCheck(
      plan({
        assertions: [
          { kind: 'status', codes: [404] },
          { kind: 'record-count', entity: 'AuditLog', count: 1 },
        ],
      }),
      context(sessionReturning(response({ status: 200 }))),
    );

    expect(result.verdict).toBe('fail');
    expect(result.detail).toContain('further assertion');
  });

  it('reports a slow response at info severity, since latency is not a wrong answer', async () => {
    const result = await runDeterministicCheck(
      plan({
        assertions: [{ kind: 'response-time', maxMs: 10 }],
        then: 'response time under 10ms',
      }),
      context(sessionReturning(response({ durationMs: 900 }))),
    );

    expect(result.verdict).toBe('fail');
    expect(result.severity).toBe('info');
  });

  it('keeps the criterion severity when latency is only one of the failures', async () => {
    const result = await runDeterministicCheck(
      plan({
        assertions: [
          { kind: 'response-time', maxMs: 10 },
          { kind: 'status', codes: [404] },
        ],
      }),
      context(sessionReturning(response({ status: 500, durationMs: 900 }))),
    );

    expect(result.severity).toBe('medium');
  });

  it('refuses a mutating criterion when nothing granted permission', async () => {
    const sent: RequestSpec[] = [];
    const result = await runDeterministicCheck(
      plan({ mutates: true, request: { method: 'PATCH', path: '/api/invoices/INV-1001' } }),
      context(sessionReturning(response(), sent)),
    );

    expect(result.verdict).toBe('inconclusive');
    expect(sent).toEqual([]);
  });

  it('runs a mutating criterion once the gate permits it', async () => {
    const sent: RequestSpec[] = [];
    const sessions = sessionReturning(response({ status: 404 }), sent);
    const result = await runDeterministicCheck(plan({ mutates: true }), {
      sessions,
      mutation: { allowed: true },
    });

    expect(result.verdict).toBe('pass');
    expect(sent).toHaveLength(1);
  });

  it('is inconclusive when the actor is not configured, and sends nothing', async () => {
    const sent: RequestSpec[] = [];
    const result = await runDeterministicCheck(
      plan({ actorId: 'nobody' }),
      context(sessionReturning(response(), sent)),
    );

    expect(result.verdict).toBe('inconclusive');
    expect(result.detail).toContain('nobody');
    expect(sent).toEqual([]);
  });

  it('is inconclusive when the criterion asserts nothing, and sends nothing', async () => {
    const sent: RequestSpec[] = [];
    const result = await runDeterministicCheck(
      plan({ assertions: [] }),
      context(sessionReturning(response(), sent)),
    );

    expect(result.verdict).toBe('inconclusive');
    expect(sent).toEqual([]);
  });

  it('gives the same check id for the same criterion and actor', async () => {
    const first = await runDeterministicCheck(plan(), context(sessionReturning(response())));
    const second = await runDeterministicCheck(plan(), context(sessionReturning(response())));

    expect(first.checkId).toBe(second.checkId);
    expect(first.checkId).toMatch(/^CHK-[0-9a-f]{12}$/u);
  });

  it('gives different check ids to two actors against one criterion', async () => {
    const owner = await runDeterministicCheck(plan(), context(sessionReturning(response())));

    const sessions = new Map(sessionReturning(response()));
    const outsiderSessions = new Map([['outsider', sessions.get('owner') as never]]);
    const outsider = await runDeterministicCheck(
      plan({ actorId: 'outsider' }),
      context(outsiderSessions),
    );

    expect(owner.checkId).not.toBe(outsider.checkId);
  });

  it('names no vulnerability class in any finding it produces', async () => {
    const result = await runDeterministicCheck(
      plan(),
      context(sessionReturning(response({ status: 200 }))),
    );

    const text = `${result.title} ${result.detail ?? ''}`.toLowerCase();
    for (const term of FORBIDDEN_FINDING_TERMS) {
      expect(text).not.toContain(term);
    }
  });
});

describe('counting persisted records', () => {
  /** A session whose answers depend on the path, so the action and the state read differ. */
  function sessionsByPath(
    answers: Readonly<Record<string, CapturedResponse>>,
    sent: RequestSpec[] = [],
  ): ReadonlyMap<string, ActorSession> {
    let counter = 0;
    const make = (id: string): ActorSession => ({
      id,
      attributes: {},
      request(spec: RequestSpec) {
        sent.push(spec);
        counter += 1;
        return Promise.resolve({
          outcome: {
            kind: 'response' as const,
            response: answers[spec.path] ?? response({ status: 404, body: '{}' }),
          },
          evidenceId: `EV-${counter}`,
          evidence: {} as never,
        });
      },
    });

    return new Map([
      ['owner', make('owner')],
      ['auditor', make('auditor')],
    ]);
  }

  const counting = (count: number): BehavioralPlan =>
    plan({
      assertions: [{ kind: 'record-count', entity: 'AuditLog', count }],
      then: `record count of AuditLog is ${count}`,
      stateReads: [{ entity: 'AuditLog', path: '/api/audit-logs' }],
    });

  it('reads the records back after the action and passes on the expected count', async () => {
    const sent: RequestSpec[] = [];
    const sessions = sessionsByPath(
      {
        '/api/invoices/INV-9999': response({ status: 404 }),
        '/api/audit-logs': response({ body: '{"logs":[{"id":"AL-1"}]}' }),
      },
      sent,
    );

    const result = await runDeterministicCheck(counting(1), { sessions, stateActorId: 'auditor' });

    expect(result.verdict).toBe('pass');
    expect(sent.map((entry) => entry.path)).toEqual(['/api/invoices/INV-9999', '/api/audit-logs']);
  });

  it('fails when the count is not what the criterion states', async () => {
    const sessions = sessionsByPath({ '/api/audit-logs': response({ body: '[]' }) });
    const result = await runDeterministicCheck(counting(1), { sessions, stateActorId: 'auditor' });

    expect(result.verdict).toBe('fail');
    expect(result.detail).toContain('0 AuditLog record(s)');
  });

  it('carries the evidence of both requests', async () => {
    const sessions = sessionsByPath({ '/api/audit-logs': response({ body: '[]' }) });
    const result = await runDeterministicCheck(counting(1), { sessions, stateActorId: 'auditor' });

    expect(result.evidence).toHaveLength(2);
  });

  it('reads state as the configured actor, not as the acting one', async () => {
    const sent: RequestSpec[] = [];
    const sessions = sessionsByPath({ '/api/audit-logs': response({ body: '[]' }) }, sent);

    const acting: string[] = [];
    const watched = new Map(
      [...sessions].map(([id, session]) => [
        id,
        {
          ...session,
          request(spec: RequestSpec) {
            acting.push(id);
            return session.request(spec);
          },
        } as ActorSession,
      ]),
    );

    await runDeterministicCheck(counting(0), { sessions: watched, stateActorId: 'auditor' });

    expect(acting).toEqual(['owner', 'auditor']);
  });

  it('cannot count when no state actor is configured, and says so', async () => {
    const sessions = sessionsByPath({ '/api/audit-logs': response({ body: '[]' }) });
    const result = await runDeterministicCheck(counting(1), { sessions });

    expect(result.verdict).toBe('inconclusive');
    expect(result.detail).toContain('no actor is configured for reading persisted state');
  });

  it('cannot count when nothing knows where to look', async () => {
    const sessions = sessionsByPath({});
    const result = await runDeterministicCheck(
      plan({
        assertions: [{ kind: 'record-count', entity: 'AuditLog', count: 1 }],
        then: 'record count of AuditLog is 1',
      }),
      { sessions, stateActorId: 'auditor' },
    );

    expect(result.verdict).toBe('inconclusive');
    expect(result.detail).toContain('no route for listing AuditLog');
  });

  it('cannot count a body whose rows it could not find, rather than counting zero', async () => {
    const sessions = sessionsByPath({
      '/api/audit-logs': response({ body: '{"total": 7}' }),
    });

    const result = await runDeterministicCheck(counting(0), { sessions, stateActorId: 'auditor' });

    expect(result.verdict).toBe('inconclusive');
    expect(result.detail).toContain('rows could not be read');
  });

  it('cannot count when the state read was refused', async () => {
    const sessions = sessionsByPath({
      '/api/audit-logs': response({ status: 403, body: '{}' }),
    });

    const result = await runDeterministicCheck(counting(0), { sessions, stateActorId: 'auditor' });

    expect(result.verdict).toBe('inconclusive');
    expect(result.detail).toContain('status 403');
  });

  it('reads the records once when two clauses count the same entity', async () => {
    const sent: RequestSpec[] = [];
    const sessions = sessionsByPath(
      { '/api/audit-logs': response({ body: '[{"id":"AL-1"}]' }) },
      sent,
    );

    await runDeterministicCheck(
      plan({
        assertions: [
          { kind: 'status', codes: [404] },
          { kind: 'record-count', entity: 'AuditLog', count: 1 },
        ],
        stateReads: [{ entity: 'AuditLog', path: '/api/audit-logs' }],
      }),
      { sessions, stateActorId: 'auditor' },
    );

    expect(sent.filter((entry) => entry.path === '/api/audit-logs')).toHaveLength(1);
  });
});
