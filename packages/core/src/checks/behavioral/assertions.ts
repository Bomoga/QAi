import type { Spec } from '../../contracts/index.ts';
import { type LoadDiagnostic, warning } from '../../spec/diagnostics.ts';

/**
 * The assertion vocabulary for deterministic acceptance criteria.
 *
 * The table in `modules/M5-behavioral-checks.md` is a closed set, extended only with
 * approval, and this file is that table in code:
 *
 *   status is 404
 *   status in 401, 403
 *   body contains field Invoice.org_id
 *   body omits field Invoice.notes
 *   body.status equals "ok"
 *   record count of AuditLog is 1
 *   response time under 500ms
 *
 * Two rules keep this from drifting into natural language understanding.
 *
 * **Tolerance is mechanical, never interpretive.** A leading `the`, a leading `response`,
 * a trailing period, and `and` between clauses are absorbed. Nothing else. A parser that
 * decided "the body reports status ok" means `body.status equals "ok"` would be guessing,
 * and a wrong guess here becomes a confident verdict about an application.
 *
 * **A criterion is all or nothing.** If one clause of three falls outside the table, the
 * whole criterion is unsupported. Asserting the two that parsed and reporting `pass`
 * would claim the criterion was verified while a third of it was never tested, which is
 * invariant I2 and the quiet green run this tool exists to prevent. The honest outcome is
 * a warning telling the author to rewrite the clause or mark the criterion `mode: fuzzy`.
 */

export type Assertion =
  | { readonly kind: 'status'; readonly codes: readonly number[] }
  | { readonly kind: 'field-present'; readonly entity: string; readonly field: string }
  | { readonly kind: 'field-absent'; readonly entity: string; readonly field: string }
  | { readonly kind: 'body-equals'; readonly path: string; readonly value: LiteralValue }
  | { readonly kind: 'record-count'; readonly entity: string; readonly count: number }
  /** Informational severity only, per the module. A slow response is not a failure. */
  | { readonly kind: 'response-time'; readonly maxMs: number };

export type LiteralValue = string | number | boolean | null;

export interface ThenAssertions {
  readonly kind: 'assertions';
  readonly assertions: readonly Assertion[];
}

export interface ThenUnsupported {
  readonly kind: 'unsupported';
  /** The clause that could not be read, not the whole sentence. */
  readonly clause: string;
  readonly reason: string;
}

export type ParsedThen = ThenAssertions | ThenUnsupported;

/** Filler the forms may carry in front, absorbed without changing meaning. */
const LEADING_FILLER = /^(?:the\s+)?(?:response\s+)?/iu;

const STATUS = /^status\s+(?:is|in)\s+(.+)$/iu;
const FIELD_PRESENT = /^body\s+contains\s+field\s+([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)$/iu;
const FIELD_ABSENT = /^body\s+omits\s+field\s+([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)$/iu;
const BODY_EQUALS = /^body\.([A-Za-z_][\w.[\]]*)\s+equals\s+(.+)$/iu;
const RECORD_COUNT = /^record\s+count\s+of\s+([A-Za-z_][\w]*)\s+is\s+(\d+)$/iu;
const RESPONSE_TIME = /^time\s+under\s+(\d+)\s*(?:ms)?$/iu;

const STATUS_CODE = /^[1-5]\d{2}$/u;

/** Splits on `and`, leaving an `and` inside a quoted literal alone. */
export function splitClauses(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | undefined;

  const words = text.split(/(\s+)/u);

  for (const word of words) {
    if (quote === undefined && /^and$/iu.test(word) && current.trim() !== '') {
      parts.push(current.trim());
      current = '';
      continue;
    }

    for (const char of word) {
      if (quote === undefined && (char === '"' || char === "'")) quote = char;
      else if (quote === char) quote = undefined;
    }

    current += word;
  }

  if (current.trim() !== '') parts.push(current.trim());
  return parts.filter((part) => part !== '');
}

function parseLiteral(raw: string): LiteralValue | undefined {
  const text = raw.trim();

  if (/^"[^"]*"$/u.test(text) || /^'[^']*'$/u.test(text)) return text.slice(1, -1);
  if (/^-?\d+(?:\.\d+)?$/u.test(text)) return Number(text);
  if (/^true$/iu.test(text)) return true;
  if (/^false$/iu.test(text)) return false;
  if (/^null$/iu.test(text)) return null;

  return undefined;
}

/** `404`, `401 or 403`, `401, 403`, `[401, 403]`. */
function parseStatusCodes(raw: string): number[] | undefined {
  const inner = raw.trim().replace(/^\[/u, '').replace(/\]$/u, '');
  const parts = inner
    .split(/\s*(?:,|\bor\b)\s*/iu)
    .map((part) => part.trim())
    .filter((part) => part !== '');

  if (parts.length === 0) return undefined;
  if (!parts.every((part) => STATUS_CODE.test(part))) return undefined;

  return parts.map((part) => Number(part));
}

function parseClause(clause: string): Assertion | undefined {
  const text = clause.replace(LEADING_FILLER, '').trim();

  const status = STATUS.exec(text);
  if (status?.[1] !== undefined) {
    const codes = parseStatusCodes(status[1]);
    return codes === undefined ? undefined : { kind: 'status', codes };
  }

  const present = FIELD_PRESENT.exec(text);
  if (present?.[1] !== undefined && present[2] !== undefined) {
    return { kind: 'field-present', entity: present[1], field: present[2] };
  }

  const absent = FIELD_ABSENT.exec(text);
  if (absent?.[1] !== undefined && absent[2] !== undefined) {
    return { kind: 'field-absent', entity: absent[1], field: absent[2] };
  }

  const equals = BODY_EQUALS.exec(text);
  if (equals?.[1] !== undefined && equals[2] !== undefined) {
    const value = parseLiteral(equals[2]);
    return value === undefined ? undefined : { kind: 'body-equals', path: equals[1], value };
  }

  const count = RECORD_COUNT.exec(text);
  if (count?.[1] !== undefined && count[2] !== undefined) {
    return { kind: 'record-count', entity: count[1], count: Number(count[2]) };
  }

  const time = RESPONSE_TIME.exec(text);
  if (time?.[1] !== undefined) {
    return { kind: 'response-time', maxMs: Number(time[1]) };
  }

  return undefined;
}

/**
 * Reads a `then` clause into assertions, or reports the first clause it could not.
 *
 * Returning the offending clause rather than a generic failure is the whole point: the
 * author has to know which words to rewrite, and a message saying only that a criterion
 * is unsupported is a message that gets ignored.
 */
export function parseThen(text: string): ParsedThen {
  const trimmed = text.trim().replace(/\.$/u, '');
  const clauses = splitClauses(trimmed);

  if (clauses.length === 0) {
    return { kind: 'unsupported', clause: text, reason: 'it states nothing to assert' };
  }

  const assertions: Assertion[] = [];

  for (const clause of clauses) {
    const assertion = parseClause(clause);

    if (assertion === undefined) {
      return {
        kind: 'unsupported',
        clause,
        reason: 'it is not one of the assertion forms the vocabulary defines',
      };
    }

    assertions.push(assertion);
  }

  return { kind: 'assertions', assertions };
}

/**
 * Narrows to the supported case, and, just as usefully, to the unsupported one when it
 * returns false. The predicate names a member of the union rather than a structurally
 * equivalent shape, because only the former lets TypeScript remove the member on the
 * negative branch. Written the other way, the compiler rejected `parsed.reason` in code
 * that plainly could only be reached with an unsupported result.
 */
export function isSupported(parsed: ParsedThen): parsed is ThenAssertions {
  return parsed.kind === 'assertions';
}

/** The forms, spelled out for an error message a reader can act on. */
export const ASSERTION_FORMS: readonly string[] = [
  'status is <code>, or status in <code>, <code>',
  'body contains field <Entity>.<field>',
  'body omits field <Entity>.<field>',
  'body.<path> equals <literal>',
  'record count of <Entity> is <n>',
  'response time under <ms>',
];

/**
 * Warnings for every deterministic criterion the vocabulary cannot express.
 *
 * A warning rather than an error, and never a silent skip: the criterion still loads,
 * still appears in the report, and lands in the unverified bucket with a stated reason.
 * Invariant I4.
 *
 * This is called by whoever assembles a run rather than by `loadSpec`, though the module
 * calls it a load-time warning. M1 does not depend on M5, and having the loader emit M5's
 * diagnostics would invert that for the sake of the word "load-time".
 */
export function validateAcceptanceCriteria(spec: Spec, file: string): LoadDiagnostic[] {
  const diagnostics: LoadDiagnostic[] = [];

  spec.requirements.forEach((requirement, requirementIndex) => {
    requirement.acceptanceCriteria.forEach((criterion, criterionIndex) => {
      if (criterion.mode !== 'deterministic') return;

      const parsed = parseThen(criterion.then);
      if (isSupported(parsed)) return;

      const path = `requirements[${requirementIndex}].acceptanceCriteria[${criterionIndex}].then`;
      const id = criterion.id ?? `${requirement.id} criterion ${criterionIndex + 1}`;

      diagnostics.push(
        warning(
          file,
          path,
          `${id} cannot be checked deterministically: "${parsed.clause}" ${parsed.reason}. Rewrite it using one of ${ASSERTION_FORMS.join('; ')}, or mark the criterion mode: fuzzy.`,
        ),
      );
    });
  });

  return diagnostics;
}
