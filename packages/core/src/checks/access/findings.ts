import type { Severity } from '../../contracts/index.ts';
import type { AccessCheckPlan } from './plan.ts';

/**
 * Severity and finding text.
 *
 * The output style in the style guide is the specification for everything here.
 * State the observation, not the label. Name the actor, the request, and the response.
 * Never claim intent. End with a file reference when source is available and a request
 * reference when it is not. Phrase a suggested fix as something a user could paste into
 * a coding agent, and always label it a suggestion.
 *
 * The reason for that discipline is narrow and worth restating: this tool reports what
 * happened and what the spec said. The moment output says "IDOR" it has classified
 * rather than observed, and a reader has to trust the classifier instead of reading the
 * request. A wrong observation can be checked; a wrong label just sounds authoritative.
 */

/**
 * Deny failures are the high severity class. A deny rule that fails means something the
 * spec forbids is reachable, which is the finding the tool exists to produce.
 *
 * Allow failures are medium. They mean a legitimate user is being refused, which is a
 * broken feature rather than an exposure, and this tool's audience already has tests
 * that catch broken features.
 *
 * Nothing here scales severity by how sensitive the fields were. That would look like a
 * refinement and would in practice mean guessing at the cost of an exposure from field
 * names, which is a judgment the spec author is better placed to make than the tool.
 */
export function severityForAccessFailure(plan: AccessCheckPlan): Severity {
  return plan.rule.effect === 'deny' ? 'high' : 'medium';
}

/** An observation, where to look, and what to do about it. Three fields, not one string. */
export interface FindingParts {
  readonly detail: string;
  readonly requestRef: string;
  readonly suggestion: string;
}

export interface FindingTextInput {
  readonly plan: AccessCheckPlan;
  /** The request as issued, for example `GET /api/invoices/INV-1001`. */
  readonly request: string;
  readonly status?: number;
  readonly evidenceId: string;
  /** Resource fields observed in the response, for a deny failure. */
  readonly observedFields?: readonly string[];
  /** Rows the rule denies, for a list failure. */
  readonly foreignRowIds?: readonly string[];
  readonly totalRows?: number;
}

/**
 * A fix a user could paste into a coding agent.
 *
 * **Unlabelled since 2026-08-23**, when `suggestion` became a field. It used to carry its
 * own `Suggestion:` prefix, which was the only way to guarantee the label that
 * the style guide requires when the text was going to be concatenated into `detail`.
 * A field does not need to smuggle its own label, and an emitter rendering it under a
 * heading would have printed the word twice. The rule stays structural rather than
 * remembered: `suggestion-label.test.ts` asserts that every emitter labels it.
 */
export function suggestionFor(plan: AccessCheckPlan): string {
  const ownership =
    plan.rule.condition === undefined
      ? 'the caller identity'
      : `the rule condition ${plan.rule.condition}`;

  if (plan.rule.effect === 'allow') {
    return `allow ${plan.method} ${plan.pathTemplate} for a caller matching ${ownership}, which ${plan.rule.actor} satisfies.`;
  }

  if (plan.action === 'list') {
    return `scope the ${plan.method} ${plan.pathTemplate} handler so it returns only rows matching ${ownership}, filtering in the query rather than after fetching.`;
  }

  return `in the ${plan.method} ${plan.pathTemplate} handler, check ${ownership} before returning the record, and respond 404 rather than 403 so the response does not confirm that the record exists.`;
}

/**
 * The three parts of a finding, as three fields rather than as one string.
 *
 * **They used to be joined into `detail`**, because `CheckResult` had no field for a
 * reference or a suggestion, and every emitter then printed the reference twice: once
 * inside the sentence and once from `locationRef` and `evidence`. M3.8 recorded that as
 * the contract question to raise and M7.7 saw the same duplication from the report's side.
 * Answered 2026-08-23: an observation, a reference, and a suggestion are three facts, and
 * an emitter that wants to lay them out differently should not have to parse a sentence to
 * do it.
 *
 * `detail` keeps its full stop, because it is a sentence and the next thing a reader sees
 * may be another one.
 */
function compose(
  observation: string,
  plan: AccessCheckPlan,
  request: string,
): { detail: string; requestRef: string; suggestion: string } {
  return {
    detail: `${observation}.`,
    requestRef: request,
    suggestion: suggestionFor(plan),
  };
}

/** A deny rule that failed: the record came back to an actor the spec refuses. */
export function denyFailureDetail(input: FindingTextInput): FindingParts {
  const fields = (input.observedFields ?? []).join(', ');
  const observation = `${input.request} as actor ${input.plan.actorId} returned ${input.status} with ${input.plan.resource} fields ${fields}`;

  return compose(observation, input.plan, input.request);
}

/**
 * A denied delete that the response could not settle and the record did.
 *
 * The observation names both readings rather than only the response, because the response
 * is precisely what was not sufficient here. A reader has to be able to see that the
 * verdict rests on the record having been there and then not.
 */
export function destructiveFailureDetail(
  input: FindingTextInput & { readonly instanceId: string },
): FindingParts {
  const observation = `${input.request} as actor ${input.plan.actorId} returned ${input.status} with no ${input.plan.resource} fields, and ${input.plan.resource} ${input.instanceId} was readable before the request and is absent after it`;

  return compose(observation, input.plan, input.request);
}

/** A deny rule on a list that failed: rows belonging to someone else came back. */
export function listFailureDetail(input: FindingTextInput): FindingParts {
  const rows = (input.foreignRowIds ?? []).join(', ');
  const observation = `${input.request} as actor ${input.plan.actorId} returned ${input.status} with ${input.totalRows} row(s), ${input.foreignRowIds?.length ?? 0} of which the rule denies: ${rows}`;

  return compose(observation, input.plan, input.request);
}

/** An allow rule that failed: a caller the spec permits was refused. */
export function allowFailureDetail(input: FindingTextInput): FindingParts {
  const observation = `${input.request} as actor ${input.plan.actorId} returned ${input.status}, and the spec allows this actor to perform it`;

  return compose(observation, input.plan, input.request);
}

/**
 * A passing check states what it saw and stops. No reference and no suggestion: there
 * is nothing to look up and nothing to fix, and a suggestion attached to a pass would
 * read as a finding to anyone skimming.
 */
export function passDetail(input: FindingTextInput & { readonly note: string }): string {
  return `${input.request} as actor ${input.plan.actorId} returned ${input.status} ${input.note}`;
}

/** Terms that classify rather than observe. Asserted absent from every finding. */
export const FORBIDDEN_FINDING_TERMS = [
  'idor',
  'vulnerability',
  'vulnerable',
  'exploit',
  'injection',
  'attack',
  'malicious',
  'cve',
  'owasp',
  'insecure direct object',
];
