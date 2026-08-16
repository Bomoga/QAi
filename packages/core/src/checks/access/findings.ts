import type { Severity } from '../../contracts/index.ts';
import type { AccessCheckPlan } from './plan.ts';

/**
 * Severity and finding text.
 *
 * The output style in 04-CONVENTIONS.md is the specification for everything here.
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
 * The closing reference. Source when a probe supplied a handler, the request otherwise,
 * and the evidence id either way so a reader can find what was recorded.
 */
export function referenceLine(plan: AccessCheckPlan, request: string, evidenceId: string): string {
  const where =
    plan.locationRef === undefined ? `Request: ${request}` : `Source: ${plan.locationRef}`;
  return `${where}. Evidence: ${evidenceId}.`;
}

/**
 * A fix a user could paste into a coding agent. Always prefixed as a suggestion, since
 * the tool knows what the spec said and what the target did, and nothing about what the
 * code should look like.
 */
export function suggestionFor(plan: AccessCheckPlan): string {
  const ownership =
    plan.rule.condition === undefined
      ? 'the caller identity'
      : `the rule condition ${plan.rule.condition}`;

  if (plan.rule.effect === 'allow') {
    return `Suggestion: allow ${plan.method} ${plan.pathTemplate} for a caller matching ${ownership}, which ${plan.rule.actor} satisfies.`;
  }

  if (plan.action === 'list') {
    return `Suggestion: scope the ${plan.method} ${plan.pathTemplate} handler so it returns only rows matching ${ownership}, filtering in the query rather than after fetching.`;
  }

  return `Suggestion: in the ${plan.method} ${plan.pathTemplate} handler, check ${ownership} before returning the record, and respond 404 rather than 403 so the response does not confirm that the record exists.`;
}

/** A deny rule that failed: the record came back to an actor the spec refuses. */
export function denyFailureDetail(input: FindingTextInput): string {
  const fields = (input.observedFields ?? []).join(', ');
  const observation = `${input.request} as actor ${input.plan.actorId} returned ${input.status} with ${input.plan.resource} fields ${fields}`;

  return [
    observation,
    referenceLine(input.plan, input.request, input.evidenceId),
    suggestionFor(input.plan),
  ].join(' ');
}

/** A deny rule on a list that failed: rows belonging to someone else came back. */
export function listFailureDetail(input: FindingTextInput): string {
  const rows = (input.foreignRowIds ?? []).join(', ');
  const observation = `${input.request} as actor ${input.plan.actorId} returned ${input.status} with ${input.totalRows} row(s), ${input.foreignRowIds?.length ?? 0} of which the rule denies: ${rows}`;

  return [
    observation,
    referenceLine(input.plan, input.request, input.evidenceId),
    suggestionFor(input.plan),
  ].join(' ');
}

/** An allow rule that failed: a caller the spec permits was refused. */
export function allowFailureDetail(input: FindingTextInput): string {
  const observation = `${input.request} as actor ${input.plan.actorId} returned ${input.status}, and the spec allows this actor to perform it`;

  return [
    observation,
    referenceLine(input.plan, input.request, input.evidenceId),
    suggestionFor(input.plan),
  ].join(' ');
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
