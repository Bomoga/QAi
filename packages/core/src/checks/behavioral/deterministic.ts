import type { CapturedResponse } from '../../target/request.ts';
import { isTransportError } from '../../target/request.ts';
import { extractRows } from '../access/list.ts';
import { resourceFieldsIn } from '../access/verdict.ts';
import { fail, inconclusive, pass } from '../result.ts';
import type { CheckResult } from '../types.ts';
import type { Assertion, AssertionValue, LiteralValue } from './assertions.ts';
import type { Severity } from '../../contracts/index.ts';
import type { BehavioralContext, BehavioralPlan, RecordRead } from './types.ts';

/**
 * The deterministic behavioral runner.
 *
 * One criterion, one action, one verdict, with the evidence captured before anything is
 * decided. Nothing here consults a model: this is the bulk of M5's value precisely
 * because it cannot be talked into an answer.
 *
 * Most assertions are a pure function of the response the action returned. Three are not,
 * and each says so in its own form: a record count reads the entity back, an unchanged
 * record is read before the action and again after, and a status match issues the
 * reference request the criterion names. Every one of those is a read, and every request
 * any of them makes is recorded as evidence.
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

/**
 * What an assertion can be resolved against besides the response itself.
 *
 * Only the acting actor's attributes today. It is optional because most forms need
 * nothing, and an actor form evaluated without it is unevaluable rather than false, in
 * keeping with the rule that runs through all of this: what cannot be resolved is
 * unknown, never a verdict.
 */
export interface AssertionScope {
  readonly actorAttributes?: Readonly<Record<string, string>>;
}

/** Loose across string and number, exactly as `evaluateCondition` compares, so that
 * `org_id: 1` and `"1"` agree. A configured attribute is always a string, since config
 * holds strings, and comparing it strictly would fail against every numeric field. */
function sameValue(left: unknown, right: string): boolean {
  if (left === null || left === undefined) return false;
  if (typeof left === 'object') return false;
  return String(left) === right;
}

/**
 * The expected side of an equality, resolved.
 *
 * An actor attribute that is not configured comes back unresolved, which the callers
 * turn into `unevaluable`. Reporting a violation there would be a finding about the
 * configuration dressed up as a finding about the application.
 */
function resolveExpected(
  expected: AssertionValue,
  scope: AssertionScope | undefined,
):
  | { resolved: true; value: LiteralValue | string; label: string }
  | { resolved: false; label: string } {
  if (expected.kind === 'literal') {
    return { resolved: true, value: expected.value, label: describe(expected.value) };
  }

  const label = `actor.${expected.attribute}`;
  const attributes = scope?.actorAttributes;
  if (attributes === undefined || !Object.hasOwn(attributes, expected.attribute)) {
    return { resolved: false, label };
  }

  const value = attributes[expected.attribute];
  return value === undefined
    ? { resolved: false, label }
    : { resolved: true, value, label: `${label}, which is ${describe(value)}` };
}

function matches(
  actual: unknown,
  expected: AssertionValue,
  resolvedValue: LiteralValue | string,
): boolean {
  // A literal keeps the strict comparison it has always had: the author wrote the type
  // down. An actor attribute is compared loosely, because config can only carry strings.
  return expected.kind === 'literal'
    ? actual === resolvedValue
    : sameValue(actual, String(resolvedValue));
}

export function evaluateAssertion(
  assertion: Assertion,
  response: CapturedResponse,
  scope?: AssertionScope,
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

      const expected = resolveExpected(assertion.expected, scope);
      if (!expected.resolved) {
        return {
          assertion,
          state: 'unevaluable',
          observed: `${expected.label}, which the acting actor does not carry`,
        };
      }

      const found = readPath(parsed.value, assertion.path);
      const satisfied = found.found && matches(found.value, assertion.expected, expected.value);

      return {
        assertion,
        state: satisfied ? 'satisfied' : 'violated',
        observed: `body.${assertion.path} was ${describe(found.found ? found.value : undefined)}`,
      };
    }

    /**
     * Every row of a list carries the field with the expected value.
     *
     * Rows are found by `extractRows`, the same function access checks use, so a list
     * under an `invoices` key is recognized here exactly as it is there. Two readings of
     * what counts as a list would eventually disagree, and the one in access checks is
     * already the one findings are written against.
     *
     * An empty list is unevaluable rather than vacuously satisfied. That is Q5's answer
     * for deny lists and it holds for the same reason: an endpoint scoping correctly and
     * a dataset that happens to be empty are indistinguishable from out here, and reading
     * zero rows as proof would report coverage on a run that established nothing.
     */
    case 'every-row': {
      const rows = extractRows(response.body);
      if (rows === undefined) {
        return {
          assertion,
          state: 'unevaluable',
          observed: 'a response body with no list of records this runner could recognize',
        };
      }

      if (rows.length === 0) {
        return {
          assertion,
          state: 'unevaluable',
          observed: `an empty list, which shows nothing about whether every ${assertion.entity} would carry ${assertion.field}`,
        };
      }

      const expected = resolveExpected(assertion.expected, scope);
      if (!expected.resolved) {
        return {
          assertion,
          state: 'unevaluable',
          observed: `${expected.label}, which the acting actor does not carry`,
        };
      }

      const offending: string[] = [];
      rows.forEach((row, index) => {
        const present = Object.hasOwn(row, assertion.field);
        const value = present ? row[assertion.field] : undefined;
        if (!present || !matches(value, assertion.expected, expected.value)) {
          const id = row['id'];
          offending.push(
            typeof id === 'string' || typeof id === 'number' ? String(id) : `row ${index}`,
          );
        }
      });

      return {
        assertion,
        state: offending.length === 0 ? 'satisfied' : 'violated',
        observed:
          offending.length === 0
            ? `${rows.length} ${assertion.entity} row(s), every one with ${assertion.field} equal to ${expected.label}`
            : `${offending.length} of ${rows.length} ${assertion.entity} row(s) without ${assertion.field} equal to ${expected.label}: ${offending.join(', ')}`,
      };
    }

    case 'record-count': {
      // Persisted state is read by a second request after the action, in
      // `evaluateRecordCount`. Nothing about it can be seen in this response.
      return {
        assertion,
        state: 'unevaluable',
        observed: `the number of ${assertion.entity} records, which is read separately`,
      };
    }

    case 'record-unchanged': {
      // Read before the action and again after it, in `evaluateRecordUnchanged`. The
      // response to the action is the one thing that cannot answer this.
      return {
        assertion,
        state: 'unevaluable',
        observed: `whether ${assertion.entity} changed, which is read before and after separately`,
      };
    }

    case 'status-matches': {
      // Needs a second request, issued in `evaluateStatusMatches`.
      return {
        assertion,
        state: 'unevaluable',
        observed: `the status of ${assertion.phrase}, which is requested separately`,
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

/**
 * Counts an entity's records by reading them back after the action.
 *
 * Read as the configured state actor rather than as the acting one, per the module. An
 * actor scoped to their own organization would count only what they can see, and a
 * scoping bug would then read as a state bug.
 *
 * Every way this can fail to produce a number is unevaluable, never a count of zero. A
 * body whose rows cannot be found and a list that is genuinely empty are different facts,
 * which is why `extractRows` distinguishes them and this does too.
 */
async function evaluateRecordCount(
  assertion: Extract<Assertion, { kind: 'record-count' }>,
  plan: BehavioralPlan,
  context: BehavioralContext,
): Promise<{ outcome: AssertionOutcome; evidenceId?: string }> {
  const unevaluable = (observed: string, evidenceId?: string) => ({
    outcome: { assertion, state: 'unevaluable' as const, observed },
    ...(evidenceId === undefined ? {} : { evidenceId }),
  });

  const read = plan.stateReads?.find(
    (entry) => entry.entity.toLowerCase() === assertion.entity.toLowerCase(),
  );
  if (read === undefined) {
    return unevaluable(`no route for listing ${assertion.entity}, so its records were not counted`);
  }

  const actorId = context.stateActorId;
  if (actorId === undefined) {
    return unevaluable(
      `no actor is configured for reading persisted state, so ${assertion.entity} records were not counted`,
    );
  }

  const session = context.sessions.get(actorId);
  if (session === undefined) {
    return unevaluable(`actor ${actorId} is not configured, so records were not counted`);
  }

  const { outcome, evidenceId } = await session.request({ method: 'GET', path: read.path });

  if (isTransportError(outcome)) {
    return unevaluable(`${read.path} could not be reached: ${outcome.message}`, evidenceId);
  }

  if (outcome.response.status >= 400) {
    return unevaluable(
      `GET ${read.path} as actor ${actorId} returned status ${outcome.response.status}, so records were not counted`,
      evidenceId,
    );
  }

  const rows = extractRows(outcome.response.body);
  if (rows === undefined) {
    return unevaluable(
      `GET ${read.path} returned a body whose rows could not be read, so records were not counted`,
      evidenceId,
    );
  }

  return {
    outcome: {
      assertion,
      state: rows.length === assertion.count ? 'satisfied' : 'violated',
      observed: `${rows.length} ${assertion.entity} record(s) at ${read.path}`,
    },
    evidenceId,
  };
}

/**
 * One record, as the state actor could see it at a moment in time.
 *
 * `missing` and `unreadable` are kept apart all the way through. A record that was there
 * and is now gone is the largest change there is, while a read that failed says nothing
 * about the record at all, and collapsing the two would turn a broken read into a
 * finding about somebody's application.
 */
type RecordSnapshot =
  | { readonly kind: 'record'; readonly body: string; readonly evidenceId: string }
  | { readonly kind: 'missing'; readonly evidenceId: string }
  | { readonly kind: 'unreadable'; readonly reason: string; readonly evidenceId?: string };

async function readRecord(read: RecordRead, context: BehavioralContext): Promise<RecordSnapshot> {
  const actorId = context.stateActorId;
  if (actorId === undefined) {
    return {
      kind: 'unreadable',
      reason: `no actor is configured for reading persisted state, so ${read.entity} ${read.instanceId} was not read`,
    };
  }

  const session = context.sessions.get(actorId);
  if (session === undefined) {
    return { kind: 'unreadable', reason: `actor ${actorId} is not configured` };
  }

  const { outcome, evidenceId } = await session.request({ method: 'GET', path: read.path });

  if (isTransportError(outcome)) {
    return { kind: 'unreadable', reason: `${read.path} could not be reached`, evidenceId };
  }

  if (outcome.response.status === 404) return { kind: 'missing', evidenceId };

  if (outcome.response.status >= 400) {
    return {
      kind: 'unreadable',
      reason: `GET ${read.path} as actor ${actorId} returned status ${outcome.response.status}`,
      evidenceId,
    };
  }

  return { kind: 'record', body: outcome.response.body, evidenceId };
}

/**
 * Reads every record an `is unchanged` assertion names, before the action is taken.
 *
 * This is the one thing in this runner that has to happen first. An assertion about what
 * changed cannot be answered from the response to the change.
 */
export async function readRecordsBefore(
  plan: BehavioralPlan,
  context: BehavioralContext,
): Promise<Map<string, RecordSnapshot>> {
  const snapshots = new Map<string, RecordSnapshot>();

  for (const read of plan.recordReads ?? []) {
    snapshots.set(snapshotKey(read.entity, read.instanceId), await readRecord(read, context));
  }

  return snapshots;
}

function snapshotKey(entity: string, instanceId: string): string {
  return `${entity.toLowerCase()} ${instanceId}`;
}

/** Field names whose values differ between two readings of the same record. */
function changedFields(before: unknown, after: unknown): string[] {
  const left =
    typeof before === 'object' && before !== null ? (before as Record<string, unknown>) : {};
  const right =
    typeof after === 'object' && after !== null ? (after as Record<string, unknown>) : {};

  const names = new Set([...Object.keys(left), ...Object.keys(right)]);
  const changed: string[] = [];

  for (const name of names) {
    if (JSON.stringify(left[name]) !== JSON.stringify(right[name])) changed.push(name);
  }

  return changed.sort();
}

/**
 * Compares the record as it was against the record as it is.
 *
 * Two readable records that differ is the only violation. Everything else that could go
 * wrong, a missing state actor, a read that failed, a body that will not parse, is
 * unevaluable with the reason attached, because none of it is evidence that the record
 * did or did not change.
 *
 * A record present before and absent after is a violation rather than an unreadable
 * reading. That is the delete case, and it is the largest change a record can undergo.
 */
async function evaluateRecordUnchanged(
  assertion: Extract<Assertion, { kind: 'record-unchanged' }>,
  plan: BehavioralPlan,
  context: BehavioralContext,
  before: ReadonlyMap<string, RecordSnapshot>,
): Promise<{ outcome: AssertionOutcome; evidenceIds: string[] }> {
  const read = plan.recordReads?.find(
    (entry) =>
      entry.entity.toLowerCase() === assertion.entity.toLowerCase() &&
      (assertion.instanceId === undefined || entry.instanceId === assertion.instanceId),
  );

  const unevaluable = (observed: string, evidenceIds: string[] = []) => ({
    outcome: { assertion, state: 'unevaluable' as const, observed },
    evidenceIds,
  });

  if (read === undefined) {
    return unevaluable(
      `no route and instance for reading one ${assertion.entity}, so it was not compared before and after`,
    );
  }

  const label = `${assertion.entity} ${read.instanceId}`;
  const first = before.get(snapshotKey(read.entity, read.instanceId));

  if (first === undefined || first.kind === 'unreadable') {
    const reason = first?.reason ?? 'it was not read before the action';
    return unevaluable(
      `${label} could not be compared: ${reason}`,
      first?.evidenceId === undefined ? [] : [first.evidenceId],
    );
  }

  const second = await readRecord(read, context);
  const evidenceIds = [first.evidenceId, second.evidenceId].filter(
    (id): id is string => id !== undefined,
  );

  if (second.kind === 'unreadable') {
    return unevaluable(`${label} could not be compared: ${second.reason}`, evidenceIds);
  }

  if (first.kind === 'missing') {
    return second.kind === 'missing'
      ? unevaluable(
          `${label} did not exist before the action, so nothing could change`,
          evidenceIds,
        )
      : {
          outcome: {
            assertion,
            state: 'violated',
            observed: `${label} did not exist before the action and does now`,
          },
          evidenceIds,
        };
  }

  if (second.kind === 'missing') {
    return {
      outcome: { assertion, state: 'violated', observed: `${label} no longer exists` },
      evidenceIds,
    };
  }

  const parsedBefore = parseBody(first.body);
  const parsedAfter = parseBody(second.body);

  if (!parsedBefore.ok || !parsedAfter.ok) {
    // Byte-identical bodies are still evidence of nothing having changed, whatever the
    // format. Two different unparseable bodies are not evidence of a change, since the
    // difference could be a timestamp in a rendered page.
    return first.body === second.body
      ? {
          outcome: {
            assertion,
            state: 'satisfied',
            observed: `${label} returned an identical body before and after`,
          },
          evidenceIds,
        }
      : unevaluable(
          `${label} returned a body that is not JSON, so before and after could not be compared`,
          evidenceIds,
        );
  }

  const changed = changedFields(parsedBefore.value, parsedAfter.value);

  return {
    outcome: {
      assertion,
      state: changed.length === 0 ? 'satisfied' : 'violated',
      observed:
        changed.length === 0
          ? `${label} unchanged across the action`
          : `${label} changed across the action: ${changed.join(', ')}`,
    },
    evidenceIds,
  };
}

/**
 * Issues the reference request and compares its status against the action's.
 *
 * The comparison is of status codes only, which is what the form claims and all it
 * claims. Comparing two whole responses would be a far larger assertion wearing the same
 * words, and widening it is a separate approval.
 *
 * The request is issued after the action, as the actor the phrase names. It cannot mutate,
 * refused by the parser, so issuing it changes nothing about what the action did.
 */
async function evaluateStatusMatches(
  assertion: Extract<Assertion, { kind: 'status-matches' }>,
  plan: BehavioralPlan,
  context: BehavioralContext,
  response: CapturedResponse,
): Promise<{ outcome: AssertionOutcome; evidenceId?: string }> {
  const unevaluable = (observed: string, evidenceId?: string) => ({
    outcome: { assertion, state: 'unevaluable' as const, observed },
    ...(evidenceId === undefined ? {} : { evidenceId }),
  });

  const reference = plan.referenceRequests?.find((entry) => entry.phrase === assertion.phrase);
  if (reference === undefined) {
    return unevaluable(`no route is known for "${assertion.phrase}", so no status was compared`);
  }

  const session = context.sessions.get(reference.actorId);
  if (session === undefined) {
    return unevaluable(
      `actor ${reference.actorId} is not configured, so "${assertion.phrase}" was not requested`,
    );
  }

  const { outcome, evidenceId } = await session.request(reference.request);

  if (isTransportError(outcome)) {
    return unevaluable(
      `"${assertion.phrase}" could not be completed: ${outcome.message}`,
      evidenceId,
    );
  }

  const other = outcome.response.status;

  return {
    outcome: {
      assertion,
      state: response.status === other ? 'satisfied' : 'violated',
      observed:
        response.status === other
          ? `status ${response.status}, the same as ${reference.request.method} ${reference.request.path}`
          : `status ${response.status} where ${reference.request.method} ${reference.request.path} as actor ${reference.actorId} returned ${other}`,
    },
    evidenceId,
  };
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

  /**
   * The one read that has to happen before the action. An assertion about what a request
   * changed cannot be answered afterwards, and reading the record as the state actor
   * rather than the acting one is what makes the answer about the record: the actor under
   * test here is frequently one that cannot read it at all, which is the point of the
   * criterion.
   */
  const before = await readRecordsBefore(plan, context);

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

  // The state read comes after the action, which is the whole point of asserting on
  // persisted state: what the target holds once the request has been made.
  const evidence = [evidenceId];
  const outcomes: AssertionOutcome[] = [];

  for (const assertion of plan.assertions) {
    if (assertion.kind === 'record-count') {
      const counted = await evaluateRecordCount(assertion, plan, context);
      if (counted.evidenceId !== undefined) evidence.push(counted.evidenceId);
      outcomes.push(counted.outcome);
      continue;
    }

    if (assertion.kind === 'record-unchanged') {
      const compared = await evaluateRecordUnchanged(assertion, plan, context, before);
      evidence.push(...compared.evidenceIds);
      outcomes.push(compared.outcome);
      continue;
    }

    if (assertion.kind === 'status-matches') {
      const matched = await evaluateStatusMatches(assertion, plan, context, outcome.response);
      if (matched.evidenceId !== undefined) evidence.push(matched.evidenceId);
      outcomes.push(matched.outcome);
      continue;
    }

    // The acting actor's attributes, so a criterion can compare a field against the
    // caller. Read from the session that issued the request rather than looked up again,
    // since the identity that asked is the only one the answer is about.
    outcomes.push(
      evaluateAssertion(assertion, outcome.response, { actorAttributes: session.attributes }),
    );
  }

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
        evidence,
        detail: `${requestLine(plan)} returned ${observed}. The criterion requires: ${plan.then}.${unread}`,
      },
      severityFor(violations, plan),
    );
  }

  if (unevaluable.length > 0) {
    return inconclusive({
      ...input,
      evidence,
      detail: `${requestLine(plan)} returned ${unevaluable[0]?.observed ?? 'a response this runner could not read'}, so ${plan.criterionId} could not be decided.`,
    });
  }

  return pass({
    ...input,
    evidence,
    detail: `${requestLine(plan)} returned ${outcomes.map((entry) => entry.observed).join(', ')}.`,
  });
}
