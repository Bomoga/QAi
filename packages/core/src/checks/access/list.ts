import type { ConditionAst } from '../../spec/condition.ts';
import type { RequestOutcome } from '../../target/request.ts';
import { evaluateCondition } from './evaluate.ts';

/**
 * List action handling, answering Q5.
 *
 * The assertion for a deny rule on `list` is the absence of foreign rows, not an empty
 * response. An empty list is ambiguous: it could mean the endpoint scopes correctly, or
 * that the dataset happens to be empty, or that a filter excluded everything. Reading
 * an empty list as proof of scoping would report coverage on a run that established
 * nothing, and the first time it was wrong it would be wrong silently.
 *
 * So rows have to be present and identifiable. If no row can be identified as foreign,
 * the verdict is inconclusive with the reason recorded, never pass.
 */

export type ListVerdict = 'pass' | 'fail' | 'inconclusive';

export interface ListAssessment {
  readonly verdict: ListVerdict;
  readonly reason:
    | 'foreign-rows-returned'
    | 'no-foreign-rows'
    | 'refused'
    | 'no-rows-returned'
    | 'no-rows-recognized'
    | 'ownership-undecidable'
    | 'server-error'
    | 'transport-error'
    | 'unexpected-status';
  readonly foreignRowCount: number;
  readonly totalRows: number;
  /** Ids or indices of the foreign rows, so a finding can point at them. */
  readonly foreignRowIds: readonly string[];
  readonly status?: number;
}

const REFUSAL_STATUSES: ReadonlySet<number> = new Set([401, 403, 404]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRowArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

/**
 * Finds the rows in a response body.
 *
 * A top-level array is the rows. Otherwise the first own property holding an array of
 * objects is, which covers `{ invoices: [...] }` and `{ data: [...] }` without
 * guessing at a key name. Returning undefined rather than an empty array matters: not
 * recognizing the shape is a different fact from the list being empty, and they get
 * different verdicts.
 */
export function extractRows(body: string): Record<string, unknown>[] | undefined {
  if (body.trim() === '') return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }

  if (isRowArray(parsed)) return parsed;
  if (!isRecord(parsed)) return undefined;

  for (const value of Object.values(parsed)) {
    if (isRowArray(value)) return value;
  }

  return undefined;
}

/** Row values as strings, so the condition evaluator sees the same shape it always does. */
function attributesOf(row: Record<string, unknown>): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      attributes[key] = String(value);
    }
  }
  return attributes;
}

function rowLabel(row: Record<string, unknown>, index: number): string {
  const id = row['id'];
  if (typeof id === 'string' || typeof id === 'number') return String(id);
  return `row ${index}`;
}

export interface ListAssessmentInput {
  readonly outcome: RequestOutcome;
  readonly condition: ConditionAst | undefined;
  readonly entity: string;
  readonly actorAttributes: Readonly<Record<string, string>>;
}

export function assessDenyListOutcome(input: ListAssessmentInput): ListAssessment {
  const empty = { foreignRowCount: 0, totalRows: 0, foreignRowIds: [] };

  if (input.outcome.kind === 'transport-error') {
    return { verdict: 'inconclusive', reason: 'transport-error', ...empty };
  }

  const { status, body } = input.outcome.response;

  if (REFUSAL_STATUSES.has(status)) {
    return { verdict: 'pass', reason: 'refused', ...empty, status };
  }

  if (status >= 500) {
    return { verdict: 'inconclusive', reason: 'server-error', ...empty, status };
  }

  if (status < 200 || status >= 300) {
    return { verdict: 'inconclusive', reason: 'unexpected-status', ...empty, status };
  }

  const rows = extractRows(body);

  if (rows === undefined) {
    return { verdict: 'inconclusive', reason: 'no-rows-recognized', ...empty, status };
  }

  /**
   * Q5, stated plainly: an empty list proves nothing. The endpoint may be scoping
   * correctly or the dataset may simply be empty, and the two are indistinguishable
   * from here.
   */
  if (rows.length === 0) {
    return { verdict: 'inconclusive', reason: 'no-rows-returned', ...empty, status };
  }

  /** With no condition there is no notion of foreign, so ownership is undecidable. */
  if (input.condition === undefined) {
    return {
      verdict: 'inconclusive',
      reason: 'ownership-undecidable',
      foreignRowCount: 0,
      totalRows: rows.length,
      foreignRowIds: [],
      status,
    };
  }

  const foreignRowIds: string[] = [];
  let undecidable = 0;

  rows.forEach((row, index) => {
    const truth = evaluateCondition(input.condition as ConditionAst, {
      record: attributesOf(row),
      actor: input.actorAttributes,
      entity: input.entity,
    });

    if (truth === 'true') foreignRowIds.push(rowLabel(row, index));
    if (truth === 'unknown') undecidable += 1;
  });

  if (foreignRowIds.length > 0) {
    return {
      verdict: 'fail',
      reason: 'foreign-rows-returned',
      foreignRowCount: foreignRowIds.length,
      totalRows: rows.length,
      foreignRowIds,
      status,
    };
  }

  /**
   * No foreign row was found, but some row could not be judged. Calling that a pass
   * would claim the endpoint scopes correctly on the strength of rows nobody could
   * read, so it is inconclusive.
   */
  if (undecidable > 0) {
    return {
      verdict: 'inconclusive',
      reason: 'ownership-undecidable',
      foreignRowCount: 0,
      totalRows: rows.length,
      foreignRowIds: [],
      status,
    };
  }

  return {
    verdict: 'pass',
    reason: 'no-foreign-rows',
    foreignRowCount: 0,
    totalRows: rows.length,
    foreignRowIds: [],
    status,
  };
}
