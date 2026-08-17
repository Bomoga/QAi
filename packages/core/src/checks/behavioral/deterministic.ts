import type { CapturedResponse } from '../../target/request.ts';
import { isTransportError } from '../../target/request.ts';
import { resourceFieldsIn } from '../access/verdict.ts';
import { fail, inconclusive, pass } from '../result.ts';
import type { CheckResult } from '../types.ts';
import type { Assertion, LiteralValue } from './assertions.ts';
import type { Severity } from '../../contracts/index.ts';
import type { BehavioralContext, BehavioralPlan } from './types.ts';

/**
 * The deterministic behavioral runner.
 *
 * One criterion, one request, one verdict, with the evidence captured before anything is
 * decided. Every assertion in the vocabulary is evaluated against the response that came
 * back, and nothing here consults a model: this is the bulk of M5's value precisely
 * because it cannot be talked into an answer.
 *
 * Three-valued by construction. An assertion is satisfied, violated, or unevaluable, and
 * the last is not a failure. A body that is not JSON, or a persisted state assertion that
 * needs a follow-up read, tells us nothing about the criterion, and invariant I2 says the
 * honest answer to that is `inconclusive` rather than a guess in either direction.
 *
 * A definite violation outranks an unevaluable assertion. If one clause is proven false,
 * the criterion did not hold, whatever could not be read about the rest.
 */

export type AssertionState = 'satisfied' | 'violated' | 'unevaluable';

export interface AssertionOutcome {
  readonly assertion: Assertion;
  readonly state: AssertionState;
  /** What was seen, phrased for a reader. Never a label, always the observation. */
  readonly observed: string;
}

function parseBody(body: string): { ok: true; value: unknown } | { ok: false } {
  if (body.trim() === '') return { ok: false };
  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Reads `invoice.id` or `items[0].id` out of a parsed body. */
export function readPath(value: unknown, path: string): { found: boolean; value: unknown } {
  const segments = path
    .replace(/\[(\d+)\]/gu, '.$1')
    .split('.')
    .filter((segment) => segment !== '');

  let current = value;

  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { found: false, value: undefined };
      }
      current = current[index];
      continue;
    }

    if (typeof current !== 'object' || current === null) return { found: false, value: undefined };
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      return { found: false, value: undefined };
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return { found: true, value: current };
}

function describe(value: LiteralValue | unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  if (value === undefined) return 'nothing';
  return JSON.stringify(value) ?? String(value);
}

export function evaluateAssertion(
  assertion: Assertion,
  response: CapturedResponse,
): AssertionOutcome {
  switch (assertion.kind) {
    case 'status': {
      const satisfied = assertion.codes.includes(response.status);
      return {
        assertion,
        state: satisfied ? 'satisfied' : 'violated',
        observed: `status ${response.status}`,
      };
    }

    case 'field-present':
    case 'field-absent': {
      const parsed = parseBody(response.body);
      if (!parsed.ok) {
        return {
          assertion,
          state: 'unevaluable',
          observed: 'a response body that is not JSON, so its fields could not be read',
        };
      }

      const found = resourceFieldsIn(response.body, [assertion.field]).length > 0;
      const wanted = assertion.kind === 'field-present';

      return {
        assertion,
        state: found === wanted ? 'satisfied' : 'violated',
        observed: found
          ? `${assertion.entity}.${assertion.field} in the body`
          : `no ${assertion.entity}.${assertion.field} in the body`,
      };
    }

    case 'body-equals': {
      const parsed = parseBody(response.body);
      if (!parsed.ok) {
        return {
          assertion,
          state: 'unevaluable',
          observed: 'a response body that is not JSON, so the value could not be read',
        };
      }

      const found = readPath(parsed.value, assertion.path);
      return {
        assertion,
        state: found.found && found.value === assertion.value ? 'satisfied' : 'violated',
        observed: `body.${assertion.path} was ${describe(found.found ? found.value : undefined)}`,
      };
    }

    case 'record-count': {
      // Persisted state needs a second request as the owning actor, which is M5.3.
      // Reporting anything else here would be a verdict about state nobody read.
      return {
        assertion,
        state: 'unevaluable',
        observed: `the number of ${assertion.entity} records, which needs a follow-up read this runner does not yet perform`,
      };
    }

    case 'response-time': {
      const satisfied = response.durationMs <= assertion.maxMs;
      return {
        assertion,
        state: satisfied ? 'satisfied' : 'violated',
        observed: `a response after ${response.durationMs}ms`,
      };
    }
  }
}

/** Latency is informational, per the module. A slow answer is not a wrong answer. */
function severityFor(violations: readonly AssertionOutcome[], plan: BehavioralPlan): Severity {
  const allLatency = violations.every((outcome) => outcome.assertion.kind === 'response-time');
  return allLatency ? 'info' : plan.severityOnFail;
}

function requestLine(plan: BehavioralPlan): string {
  return `${plan.request.method} ${plan.request.path} as actor ${plan.actorId}`;
}

export async function runDeterministicCheck(
  plan: BehavioralPlan,
  context: BehavioralContext,
): Promise<CheckResult> {
  const identity = {
    type: 'behavioral' as const,
    requirementId: plan.requirementId,
    ruleId: plan.criterionId,
    actorId: plan.actorId,
    action: `${plan.request.method} ${plan.request.path}`,
  };

  const input = {
    identity,
    title: `Acceptance criterion ${plan.criterionId}`,
    ...(plan.locationRef === undefined ? {} : { locationRef: plan.locationRef }),
  };

  if (plan.mutates && context.mutation?.allowed !== true) {
    const reason = context.mutation?.reason ?? 'the target is not marked disposable';
    return inconclusive({
      ...input,
      detail: `${plan.criterionId} changes state and was not run: ${reason}. No request was issued.`,
    });
  }

  const session = context.sessions.get(plan.actorId);
  if (session === undefined) {
    return inconclusive({
      ...input,
      detail: `actor ${plan.actorId} is not configured, so ${plan.criterionId} could not be attempted.`,
    });
  }

  if (plan.assertions.length === 0) {
    return inconclusive({
      ...input,
      detail: `${plan.criterionId} states nothing this runner can assert, so no request was issued.`,
    });
  }

  // Evidence before verdict, rule R7. The session records one either way, including
  // when the request never reached the target.
  const { outcome, evidenceId } = await session.request(plan.request);

  if (isTransportError(outcome)) {
    return inconclusive({
      ...input,
      evidence: [evidenceId],
      detail: `${requestLine(plan)} could not be completed: ${outcome.message}.`,
    });
  }

  const outcomes = plan.assertions.map((assertion) =>
    evaluateAssertion(assertion, outcome.response),
  );
  const violations = outcomes.filter((entry) => entry.state === 'violated');
  const unevaluable = outcomes.filter((entry) => entry.state === 'unevaluable');

  if (violations.length > 0) {
    const observed = violations.map((entry) => entry.observed).join(', ');
    const unread =
      unevaluable.length === 0
        ? ''
        : ` ${unevaluable.length} further assertion(s) could not be evaluated.`;

    return fail(
      {
        ...input,
        evidence: [evidenceId],
        detail: `${requestLine(plan)} returned ${observed}. The criterion requires: ${plan.then}.${unread}`,
      },
      severityFor(violations, plan),
    );
  }

  if (unevaluable.length > 0) {
    return inconclusive({
      ...input,
      evidence: [evidenceId],
      detail: `${requestLine(plan)} returned ${unevaluable[0]?.observed ?? 'a response this runner could not read'}, so ${plan.criterionId} could not be decided.`,
    });
  }

  return pass({
    ...input,
    evidence: [evidenceId],
    detail: `${requestLine(plan)} returned ${outcomes.map((entry) => entry.observed).join(', ')}.`,
  });
}
