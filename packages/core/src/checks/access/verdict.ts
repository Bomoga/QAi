import type { CapturedResponse, RequestOutcome } from '../../target/request.ts';

/**
 * The deny rule verdict table, from modules/M3-access-checks.md.
 *
 * | Observed                                          | Verdict      |
 * | 401, 403, or 404 with no resource fields in body  | pass         |
 * | 2xx with any field belonging to the resource      | fail, high   |
 * | 2xx with an empty or unrelated body               | inconclusive |
 * | 5xx                                               | inconclusive |
 * | Network error or timeout                          | inconclusive |
 *
 * The 2xx-with-empty-body row is the one that matters. An endpoint answering 200 with
 * nothing may be refusing correctly, or may be leaking under a shape this tool does
 * not recognize. Calling that a pass is the false positive in reverse: it reports
 * coverage the run did not earn. Calling it a fail is the false positive that costs a
 * user. So it is neither.
 *
 * Nothing in this file consults a model. Every branch is a comparison against a status
 * code and a set of field names.
 */

export type DenyVerdict = 'pass' | 'fail' | 'inconclusive';

export interface DenyAssessment {
  readonly verdict: DenyVerdict;
  /** Which row of the table produced this, so a report can explain itself. */
  readonly reason:
    | 'refused'
    | 'resource-fields-returned'
    | 'empty-or-unrelated-body'
    | 'server-error'
    | 'transport-error';
  /** Resource fields seen in the body. Empty unless the verdict is fail. */
  readonly observedFields: readonly string[];
  readonly status?: number;
}

const REFUSAL_STATUSES: ReadonlySet<number> = new Set([401, 403, 404]);

/**
 * Field names of the protected resource, found anywhere in the body.
 *
 * Matching by name rather than by shape is deliberate: an endpoint that wraps the
 * record in an envelope, or returns it inside a list, is still returning the record.
 * A caller asking about `Invoice` gets told which of its fields came back.
 */
export function resourceFieldsIn(body: string, fieldNames: readonly string[]): string[] {
  if (body === '' || fieldNames.length === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }

  const wanted = new Set(fieldNames.map((name) => name.toLowerCase()));
  const found = new Set<string>();

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value !== 'object' || value === null) return;

    for (const [key, child] of Object.entries(value)) {
      if (wanted.has(key.toLowerCase())) found.add(key);
      walk(child);
    }
  };

  walk(parsed);
  return [...found].sort();
}

function isEmptyBody(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed === '') return true;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed === null) return true;
    if (Array.isArray(parsed)) return parsed.length === 0;
    if (typeof parsed === 'object') return Object.keys(parsed).length === 0;
    return false;
  } catch {
    return false;
  }
}

/**
 * Applies the table. Takes an outcome and the resource's field names, and returns
 * which row matched. It decides nothing else: severity and wording are M3.8.
 */
export function assessDenyOutcome(
  outcome: RequestOutcome,
  resourceFields: readonly string[],
): DenyAssessment {
  if (outcome.kind === 'transport-error') {
    return { verdict: 'inconclusive', reason: 'transport-error', observedFields: [] };
  }

  const response: CapturedResponse = outcome.response;
  const { status } = response;

  if (REFUSAL_STATUSES.has(status)) {
    const leaked = resourceFieldsIn(response.body, resourceFields);
    // A refusal that still returns the record is not a refusal.
    if (leaked.length > 0) {
      return {
        verdict: 'fail',
        reason: 'resource-fields-returned',
        observedFields: leaked,
        status,
      };
    }
    return { verdict: 'pass', reason: 'refused', observedFields: [], status };
  }

  if (status >= 500) {
    return { verdict: 'inconclusive', reason: 'server-error', observedFields: [], status };
  }

  if (status >= 200 && status < 300) {
    const observed = resourceFieldsIn(response.body, resourceFields);

    if (observed.length > 0) {
      return {
        verdict: 'fail',
        reason: 'resource-fields-returned',
        observedFields: observed,
        status,
      };
    }

    return {
      verdict: 'inconclusive',
      reason: 'empty-or-unrelated-body',
      observedFields: [],
      status,
    };
  }

  /**
   * Everything else, including 3xx and 4xx outside the refusal set. The table does not
   * cover them, and a status the table does not name is not evidence of anything.
   */
  return { verdict: 'inconclusive', reason: 'empty-or-unrelated-body', observedFields: [], status };
}

export function isEmptyResponseBody(body: string): boolean {
  return isEmptyBody(body);
}
