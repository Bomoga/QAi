import type { RunResult } from '../contracts/index.ts';

/**
 * The JSON projection of a RunResult, and the golden format everything else is checked
 * against.
 *
 * **Keys are sorted, arrays are not.** `JSON.stringify` emits object keys in insertion
 * order, so two structurally identical results can differ byte for byte depending on how
 * they were built, which would make a golden file a test of construction order rather
 * than of content. Array order is the opposite case: it carries meaning here.
 * `assembleRun` puts requirements in spec order deliberately so a reader comparing two
 * runs looks down the same list, and sorting them here would destroy that.
 *
 * **Why this is not `stableStringify` from `spec/hash.ts`.** That one exists to feed a
 * digest, so it is compact and it writes `null` where a key has no value. Both are wrong
 * for a report: the golden files want indentation a human can diff, and RunResult has
 * optional fields that a strict schema rejects when they arrive as `null` rather than
 * absent. Two serializers with genuinely different requirements, not two answers to one
 * question.
 */

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value === null || typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};

  for (const key of Object.keys(source).sort()) {
    const entry = source[key];
    // An absent optional field stays absent. `JSON.stringify` drops it anyway; doing it
    // here as well keeps the intermediate object honest for anyone who logs it.
    if (entry === undefined) continue;
    sorted[key] = sortKeysDeep(entry);
  }

  return sorted;
}

/**
 * Two spaces and a trailing newline: the output is committed as a golden file and read in
 * diffs, so it is formatted for the reader rather than for the wire.
 */
export function renderJson(result: RunResult): string {
  return renderJsonDocument(result);
}

/**
 * The same projection for anything else this tool serializes as JSON, currently the
 * RunDelta that `qai diff` prints.
 *
 * Exported rather than copied. A second sorted serializer would be two answers to one
 * question, which is the thing the note above says this file is not: `stableStringify` in
 * `spec/hash.ts` differs because it feeds a digest, and a delta document wants exactly
 * what a run document wants.
 */
export function renderJsonDocument(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}
