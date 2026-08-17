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
    const assertion: Assertion = {
      kind: 'body-equals',
      path: 'status',
      expected: { kind: 'literal', value: 'ok' },
    };

    expect(evaluateAssertion(assertion, response({ body: '{"status":"ok"}' })).state).toBe(
      'satisfied',
    );
    expect(evaluateAssertion(assertion, response({ body: '{"status":"down"}' })).state).toBe(
      'violated',
    );
  });

  it('treats a missing path as violated rather than unevaluable, since the body was read', () => {
    const assertion: Assertion = {
      kind: 'body-equals',
      path: 'status',
      expected: { kind: 'literal', value: 'ok' },
    };
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

/**
 * The two forms added on 2026-08-17, with the edges that decide whether they can be
 * trusted. Every way of not knowing is unevaluable, and only a row that was read and
 * found wanting is a violation.
 */
describe('comparing against the acting actor', () => {
  const assertion: Assertion = {
    kind: 'body-equals',
    path: 'org_id',
    expected: { kind: 'actor', attribute: 'org_id' },
  };

  const scope = { actorAttributes: { org_id: 'org-1' } };

  it('is satisfied when the field carries the actor attribute', () => {
    const outcome = evaluateAssertion(assertion, response({ body: '{"org_id":"org-1"}' }), scope);

    expect(outcome.state).toBe('satisfied');
  });

  it('is violated when it carries someone else', () => {
    expect(
      evaluateAssertion(assertion, response({ body: '{"org_id":"org-2"}' }), scope).state,
    ).toBe('violated');
  });

  it('compares loosely across string and number, since config can only hold strings', () => {
    const numeric: Assertion = {
      kind: 'body-equals',
      path: 'org_id',
      expected: { kind: 'actor', attribute: 'org_id' },
    };

    const outcome = evaluateAssertion(numeric, response({ body: '{"org_id":1}' }), {
      actorAttributes: { org_id: '1' },
    });

    expect(outcome.state).toBe('satisfied');
  });

  it('is unevaluable when the actor carries no such attribute, never violated', () => {
    const outcome = evaluateAssertion(assertion, response({ body: '{"org_id":"org-1"}' }), {
      actorAttributes: {},
    });

    // A finding here would be about the configuration, dressed as a finding about the
    // application. Invariant I2.
    expect(outcome.state).toBe('unevaluable');
    expect(outcome.observed).toContain('actor.org_id');
  });

  it('is unevaluable when no actor scope was supplied at all', () => {
    expect(evaluateAssertion(assertion, response({ body: '{"org_id":"org-1"}' })).state).toBe(
      'unevaluable',
    );
  });

  it('keeps the literal comparison strict, which is what the author wrote down', () => {
    const literal: Assertion = {
      kind: 'body-equals',
      path: 'total_cents',
      expected: { kind: 'literal', value: 1000 },
    };

    expect(evaluateAssertion(literal, response({ body: '{"total_cents":"1000"}' })).state).toBe(
      'violated',
    );
  });
});

describe('asserting over every row of a list', () => {
  const assertion: Assertion = {
    kind: 'every-row',
    entity: 'Invoice',
    field: 'org_id',
    expected: { kind: 'actor', attribute: 'org_id' },
  };

  const scope = { actorAttributes: { org_id: 'org-1' } };

  function list(rows: unknown[]): string {
    return JSON.stringify({ invoices: rows });
  }

  it('is satisfied when every row belongs to the caller', () => {
    const body = list([
      { id: 'INV-1', org_id: 'org-1' },
      { id: 'INV-2', org_id: 'org-1' },
    ]);

    const outcome = evaluateAssertion(assertion, response({ body }), scope);

    expect(outcome.state).toBe('satisfied');
    expect(outcome.observed).toContain('2 Invoice row(s)');
  });

  it('is violated by one foreign row among many, and names it', () => {
    const body = list([
      { id: 'INV-1', org_id: 'org-1' },
      { id: 'INV-2', org_id: 'org-2' },
    ]);

    const outcome = evaluateAssertion(assertion, response({ body }), scope);

    expect(outcome.state).toBe('violated');
    expect(outcome.observed).toContain('INV-2');
    expect(outcome.observed).not.toContain('INV-1,');
  });

  it('reads a bare array as the rows, the same as an enveloped one', () => {
    const body = JSON.stringify([{ id: 'INV-2', org_id: 'org-2' }]);

    expect(evaluateAssertion(assertion, response({ body }), scope).state).toBe('violated');
  });

  it('treats a row missing the field as violated, since the row was read', () => {
    const outcome = evaluateAssertion(
      assertion,
      response({ body: list([{ id: 'INV-1' }]) }),
      scope,
    );

    expect(outcome.state).toBe('violated');
    expect(outcome.observed).toContain('INV-1');
  });

  it('falls back to a row position when a row carries no id', () => {
    const outcome = evaluateAssertion(
      assertion,
      response({ body: list([{ org_id: 'org-2' }]) }),
      scope,
    );

    expect(outcome.observed).toContain('row 0');
  });

  it('is unevaluable on an empty list, which shows nothing either way', () => {
    const outcome = evaluateAssertion(assertion, response({ body: list([]) }), scope);

    // Q5's answer, held to here as well: an endpoint scoping correctly and a dataset
    // that happens to be empty are indistinguishable from outside.
    expect(outcome.state).toBe('unevaluable');
    expect(outcome.observed).toContain('empty list');
  });

  it('is unevaluable when no list can be recognized in the body', () => {
    const outcome = evaluateAssertion(assertion, response({ body: '{"invoice":{}}' }), scope);

    expect(outcome.state).toBe('unevaluable');
  });

  it('is unevaluable on a body that is not JSON', () => {
    expect(evaluateAssertion(assertion, response({ body: 'not json' }), scope).state).toBe(
      'unevaluable',
    );
  });

  it('is unevaluable when the actor carries no such attribute', () => {
    const body = list([{ id: 'INV-1', org_id: 'org-1' }]);

    expect(evaluateAssertion(assertion, response({ body }), { actorAttributes: {} }).state).toBe(
      'unevaluable',
    );
  });

  it('compares against a literal without needing an actor at all', () => {
    const literal: Assertion = {
      kind: 'every-row',
      entity: 'Invoice',
      field: 'status',
      expected: { kind: 'literal', value: 'open' },
    };

    const body = list([{ id: 'INV-1', status: 'open' }]);
    expect(evaluateAssertion(literal, response({ body })).state).toBe('satisfied');
  });
});

/**
 * The before and after form, which is the only assertion that needs the runner to hold
 * state across requests. The sessions here answer differently on each call so a change
 * can be staged, which a single canned response cannot do.
 */
describe('comparing a record before and after the action', () => {
  function stagedSessions(
    bodies: string[],
    statuses: number[] = [],
  ): ReadonlyMap<string, ActorSession> {
    let call = -1;
    const session = {
      id: 'owner',
      attributes: { org_id: 'org-1' },
      request() {
        call += 1;
        return Promise.resolve({
          outcome: {
            kind: 'response' as const,
            response: response({
              body: bodies[call] ?? bodies[bodies.length - 1] ?? '{}',
              status: statuses[call] ?? 200,
            }),
          },
          evidenceId: `EV-00000${call + 1}`,
          evidence: {} as never,
        });
      },
    };

    return new Map([['owner', session]]);
  }

  function unchangedPlan(): BehavioralPlan {
    return plan({
      request: { method: 'PATCH', path: '/api/invoices/INV-1001' },
      mutates: true,
      assertions: [{ kind: 'record-unchanged', entity: 'Invoice', instanceId: 'INV-1001' }],
      recordReads: [{ entity: 'Invoice', instanceId: 'INV-1001', path: '/api/invoices/INV-1001' }],
      then: 'record Invoice INV-1001 is unchanged',
    });
  }

  const withStateActor = (sessions: ReadonlyMap<string, ActorSession>): BehavioralContext => ({
    sessions,
    stateActorId: 'owner',
    mutation: { allowed: true },
  });

  it('passes when the record reads the same before and after', async () => {
    const sessions = stagedSessions(['{"id":"INV-1001","total_cents":100}']);

    const result = await runDeterministicCheck(unchangedPlan(), withStateActor(sessions));

    expect(result.verdict).toBe('pass');
  });

  it('fails when a field moved, and names the field rather than only the record', async () => {
    // Read before, the action itself, then read after.
    const sessions = stagedSessions([
      '{"id":"INV-1001","total_cents":100}',
      '{"id":"INV-1001","total_cents":101}',
      '{"id":"INV-1001","total_cents":101}',
    ]);

    const result = await runDeterministicCheck(unchangedPlan(), withStateActor(sessions));

    expect(result.verdict).toBe('fail');
    expect(result.detail).toContain('total_cents');
  });

  it('reads the record before issuing the action, which is the whole point', async () => {
    const sent: RequestSpec[] = [];
    let call = -1;
    const session = {
      id: 'owner',
      attributes: {},
      request(spec: RequestSpec) {
        call += 1;
        sent.push(spec);
        return Promise.resolve({
          outcome: { kind: 'response' as const, response: response({ body: '{"id":"INV-1001"}' }) },
          evidenceId: `EV-00000${call + 1}`,
          evidence: {} as never,
        });
      },
    };

    await runDeterministicCheck(unchangedPlan(), withStateActor(new Map([['owner', session]])));

    expect(sent.map((request) => request.method)).toEqual(['GET', 'PATCH', 'GET']);
  });

  it('carries both reads as evidence alongside the action', async () => {
    const sessions = stagedSessions(['{"id":"INV-1001"}']);

    const result = await runDeterministicCheck(unchangedPlan(), withStateActor(sessions));

    expect(result.evidence).toHaveLength(3);
  });

  it('treats a record that no longer exists as changed, which is the delete case', async () => {
    const sessions = stagedSessions(
      ['{"id":"INV-1001"}', '{}', '{"error":"not_found"}'],
      [200, 200, 404],
    );

    const result = await runDeterministicCheck(unchangedPlan(), withStateActor(sessions));

    expect(result.verdict).toBe('fail');
    expect(result.detail).toContain('no longer exists');
  });

  it('is unevaluable when no state actor is configured, never a failure', async () => {
    const sessions = stagedSessions(['{"id":"INV-1001"}']);

    const result = await runDeterministicCheck(unchangedPlan(), {
      sessions,
      mutation: { allowed: true },
    });

    expect(result.verdict).toBe('inconclusive');
    expect(result.detail).toContain('no actor is configured for reading persisted state');
  });

  it('is unevaluable when the record could not be read before the action', async () => {
    const sessions = stagedSessions(
      ['{"error":"nope"}', '{}', '{"id":"INV-1001"}'],
      [500, 200, 200],
    );

    const result = await runDeterministicCheck(unchangedPlan(), withStateActor(sessions));

    expect(result.verdict).toBe('inconclusive');
    expect(result.detail).toContain('could not be compared');
  });

  it('is unevaluable when the record did not exist before the action', async () => {
    const sessions = stagedSessions(
      ['{"error":"not_found"}', '{}', '{"error":"not_found"}'],
      [404, 200, 404],
    );

    const result = await runDeterministicCheck(unchangedPlan(), withStateActor(sessions));

    expect(result.verdict).toBe('inconclusive');
    expect(result.detail).toContain('did not exist before the action');
  });

  it('is unevaluable when the plan found nowhere to read the record', async () => {
    const sessions = stagedSessions(['{"id":"INV-1001"}']);
    const withoutRoute = plan({
      request: { method: 'PATCH', path: '/api/invoices/INV-1001' },
      mutates: true,
      assertions: [{ kind: 'record-unchanged', entity: 'Invoice', instanceId: 'INV-1001' }],
      then: 'record Invoice INV-1001 is unchanged',
    });

    const result = await runDeterministicCheck(withoutRoute, withStateActor(sessions));

    expect(result.verdict).toBe('inconclusive');
    expect(result.detail).toContain('no route and instance');
  });

  it('accepts identical bodies that are not JSON, and refuses to compare differing ones', async () => {
    const identical = stagedSessions(['plain text', 'plain text', 'plain text']);
    expect((await runDeterministicCheck(unchangedPlan(), withStateActor(identical))).verdict).toBe(
      'pass',
    );

    const differing = stagedSessions(['plain text', 'ignored', 'other text']);
    const result = await runDeterministicCheck(unchangedPlan(), withStateActor(differing));

    // Two different unparseable bodies could differ by a rendered timestamp, which is not
    // evidence that the record changed.
    expect(result.verdict).toBe('inconclusive');
  });

  it('issues no read at all when a mutating criterion was refused', async () => {
    const sent: RequestSpec[] = [];
    const session = {
      id: 'owner',
      attributes: {},
      request(spec: RequestSpec) {
        sent.push(spec);
        return Promise.resolve({
          outcome: { kind: 'response' as const, response: response() },
          evidenceId: 'EV-000001',
          evidence: {} as never,
        });
      },
    };

    const result = await runDeterministicCheck(unchangedPlan(), {
      sessions: new Map([['owner', session]]),
      stateActorId: 'owner',
    });

    expect(result.verdict).toBe('inconclusive');
    expect(sent).toEqual([]);
  });
});

/**
 * The cross-request form. The session answers with a different status per call, so the
 * action and the reference can disagree, which a single canned response cannot express.
 */
describe('comparing the status against another request', () => {
  const reference: Assertion = {
    kind: 'status-matches',
    phrase: 'actor owner reads Invoice INV-9999',
    reference: {
      actorId: 'owner',
      action: 'read',
      entity: 'Invoice',
      instanceId: 'INV-9999',
      mutates: false,
    },
  };

  function stagedStatuses(statuses: number[], sent: RequestSpec[] = []) {
    let call = -1;
    const session = {
      id: 'owner',
      attributes: {},
      request(spec: RequestSpec) {
        call += 1;
        sent.push(spec);
        return Promise.resolve({
          outcome: {
            kind: 'response' as const,
            response: response({ status: statuses[call] ?? 200 }),
          },
          evidenceId: `EV-00000${call + 1}`,
          evidence: {} as never,
        });
      },
    };

    return new Map([['owner', session]]);
  }

  function matchingPlan(overrides: Partial<BehavioralPlan> = {}): BehavioralPlan {
    return plan({
      assertions: [reference],
      then: 'status matches actor owner reads Invoice INV-9999',
      referenceRequests: [
        {
          phrase: 'actor owner reads Invoice INV-9999',
          actorId: 'owner',
          request: { method: 'GET', path: '/api/invoices/INV-9999' },
        },
      ],
      ...overrides,
    });
  }

  it('passes when both requests answer the same', async () => {
    const result = await runDeterministicCheck(matchingPlan(), context(stagedStatuses([404, 404])));

    expect(result.verdict).toBe('pass');
  });

  it('fails when they differ, naming both statuses', async () => {
    const result = await runDeterministicCheck(matchingPlan(), context(stagedStatuses([200, 404])));

    expect(result.verdict).toBe('fail');
    expect(result.detail).toContain('status 200');
    expect(result.detail).toContain('returned 404');
  });

  it('issues the reference after the action, as the actor the phrase names', async () => {
    const sent: RequestSpec[] = [];
    await runDeterministicCheck(matchingPlan(), context(stagedStatuses([200, 404], sent)));

    expect(sent).toEqual([
      { method: 'GET', path: '/api/invoices/INV-9999' },
      { method: 'GET', path: '/api/invoices/INV-9999' },
    ]);
  });

  it('records the reference request as evidence, since a claim rests on it', async () => {
    const result = await runDeterministicCheck(matchingPlan(), context(stagedStatuses([404, 404])));

    expect(result.evidence).toEqual(['EV-000001', 'EV-000002']);
  });

  it('is unevaluable when the reference resolved to no route', async () => {
    const withoutRoute = plan({
      assertions: [reference],
      then: 'status matches actor owner reads Invoice INV-9999',
    });

    const result = await runDeterministicCheck(withoutRoute, context(stagedStatuses([404])));

    expect(result.verdict).toBe('inconclusive');
    expect(result.detail).toContain('no route is known');
  });

  it('is unevaluable when the reference names an actor that is not configured', async () => {
    const otherActor = matchingPlan({
      referenceRequests: [
        {
          phrase: 'actor owner reads Invoice INV-9999',
          actorId: 'admin',
          request: { method: 'GET', path: '/api/invoices/INV-9999' },
        },
      ],
    });

    const result = await runDeterministicCheck(otherActor, context(stagedStatuses([404])));

    expect(result.verdict).toBe('inconclusive');
    expect(result.detail).toContain('actor admin is not configured');
  });

  it('is unevaluable when the reference request could not be completed', async () => {
    let call = -1;
    const session = {
      id: 'owner',
      attributes: {},
      request() {
        call += 1;
        return Promise.resolve(
          call === 0
            ? {
                outcome: { kind: 'response' as const, response: response({ status: 404 }) },
                evidenceId: 'EV-000001',
                evidence: {} as never,
              }
            : {
                outcome: {
                  kind: 'transport-error' as const,
                  message: 'socket hang up',
                  durationMs: 1,
                },
                evidenceId: 'EV-000002',
                evidence: {} as never,
              },
        );
      },
    };

    const result = await runDeterministicCheck(
      matchingPlan(),
      context(new Map([['owner', session]])),
    );

    expect(result.verdict).toBe('inconclusive');
    expect(result.detail).toContain('socket hang up');
  });
});

describe('the acting actor reaches the assertion', () => {
  it('resolves an actor attribute from the session that issued the request', async () => {
    const sessions = sessionReturning(
      response({ body: '{"invoices":[{"id":"A","org_id":"org-9"}]}' }),
    );

    const result = await runDeterministicCheck(
      plan({
        assertions: [
          {
            kind: 'every-row',
            entity: 'Invoice',
            field: 'org_id',
            expected: { kind: 'actor', attribute: 'org_id' },
          },
        ],
      }),
      context(sessions),
    );

    // The fake session carries no attributes, so this is unevaluable rather than a
    // failure. The point of the test is that the runner reaches for them at all.
    expect(result.verdict).toBe('inconclusive');
    expect(result.detail).toContain('actor.org_id');
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
