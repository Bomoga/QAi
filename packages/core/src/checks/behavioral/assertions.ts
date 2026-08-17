import type { Spec } from '../../contracts/index.ts';
import { type LoadDiagnostic, warning } from '../../spec/diagnostics.ts';
import { isRequest, parseWhen, type WhenRequest } from './when.ts';

/**
 * The assertion vocabulary for deterministic acceptance criteria.
 *
 * The table in `modules/M5-behavioral-checks.md` is a closed set, extended only with
 * approval, and this file is that table in code:
 *
 *   status is 404
 *   status in 401, 403
 *   status matches actor outsider reads Invoice INV-9999
 *   body contains field Invoice.org_id
 *   body omits field Invoice.notes
 *   body.status equals "ok"
 *   body.org_id equals actor.org_id
 *   every Invoice has org_id equal to actor.org_id
 *   every endpoint omits field User.token
 *   record count of AuditLog is 1
 *   record Invoice INV-1001 is unchanged
 *   response time under 500ms
 *
 * The last two right hand sides arrived together on 2026-08-17, with approval, because
 * the fixture spec had two criteria the table could not state: one comparing a field
 * against the caller, and one making that claim about every row of a list. Both were
 * being carried as recorded coverage gaps, which is the honest way to hold a gap and a
 * poor substitute for closing it.
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

/**
 * The right hand side of an equality, added 2026-08-17 with approval.
 *
 * A literal is a value the spec author wrote down. An actor reference is resolved
 * against the acting actor's configured attributes when the assertion is evaluated,
 * which is what lets a criterion say a row belongs to the caller without the spec
 * carrying target data. The two are separate members rather than one string, so nothing
 * has to guess whether `actor.org_id` was meant as a reference or as text.
 */
export type AssertionValue =
  | { readonly kind: 'literal'; readonly value: LiteralValue }
  | { readonly kind: 'actor'; readonly attribute: string };

export type Assertion =
  | { readonly kind: 'status'; readonly codes: readonly number[] }
  | { readonly kind: 'field-present'; readonly entity: string; readonly field: string }
  | { readonly kind: 'field-absent'; readonly entity: string; readonly field: string }
  | { readonly kind: 'body-equals'; readonly path: string; readonly expected: AssertionValue }
  /**
   * Every row of a list response carries the field with that value. Added with the same
   * approval, and the reason the fixture's REQ-002 criterion is checkable at all: a
   * scoping claim is about every row, and asserting one row is a different claim.
   */
  | {
      readonly kind: 'every-row';
      readonly entity: string;
      readonly field: string;
      readonly expected: AssertionValue;
    }
  /**
   * The status equals the status another request returns. Added 2026-08-17 with approval,
   * and the first assertion that issues traffic of its own.
   *
   * The reference is stated in the `when` request vocabulary rather than a second grammar,
   * so a reader learns one table and a reference resolves its route and instance exactly
   * as an action does. It must not mutate, refused at parse time: an assertion that
   * changes the target would break invariant I7 from inside a verdict.
   */
  | {
      readonly kind: 'status-matches';
      readonly reference: WhenRequest;
      /** The phrase as authored, quoted in findings and used to match the planned request. */
      readonly phrase: string;
    }
  /**
   * No endpoint the probe observed returns the field. Added 2026-08-17 with approval.
   *
   * The quantifier is the dangerous part and is bounded deliberately. It ranges over the
   * endpoints in the Observation, never over an idea of the application, and with no
   * Observation or no endpoints it is unevaluable rather than vacuously satisfied. A
   * criterion that passed because a crawl stopped early would be the exact false
   * confidence invariant I2 exists to prevent, so the count of what was checked is stated
   * in the result and an endpoint whose body could not be read blocks a pass.
   */
  | { readonly kind: 'every-endpoint-omits'; readonly entity: string; readonly field: string }
  | { readonly kind: 'record-count'; readonly entity: string; readonly count: number }
  /**
   * The record is the same after the action as it was before it. Added 2026-08-17 with
   * approval, and the only form that needs the runner to hold state across requests: the
   * record is read once before the action and once after, and the two are compared.
   *
   * The instance is optional so a criterion can say "the invoice" and mean the one the
   * `when` clause acts on, which is what an author means every time.
   */
  | { readonly kind: 'record-unchanged'; readonly entity: string; readonly instanceId?: string }
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
const EVERY_ROW = /^every\s+([A-Za-z_][\w]*)\s+has\s+([A-Za-z_][\w]*)\s+equal\s+to\s+(.+)$/iu;
/** `endpoint` is reserved here. An entity of that name cannot use the every row form. */
const EVERY_ENDPOINT_OMITS =
  /^every\s+endpoint\s+omits\s+field\s+([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)$/iu;
const RECORD_UNCHANGED = /^record\s+([A-Za-z_][\w]*)(?:\s+(\S+))?\s+is\s+unchanged$/iu;
const STATUS_MATCHES = /^status\s+matches\s+(.+)$/iu;
const ACTOR_REF = /^actor\.([A-Za-z_][\w]*)$/iu;

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

/**
 * A literal, or a reference to the acting actor.
 *
 * The actor form is tried first, and a bare identifier is still refused. `Invoice.org_id`
 * on the right of an equality is far more likely a mistyped reference than a string
 * somebody meant literally, and the parser stays a parser rather than a guesser.
 */
function parseAssertionValue(raw: string): AssertionValue | undefined {
  const text = raw.trim();

  const actor = ACTOR_REF.exec(text);
  if (actor?.[1] !== undefined) return { kind: 'actor', attribute: actor[1] };

  const value = parseLiteral(text);
  return value === undefined ? undefined : { kind: 'literal', value };
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

  // Tried before the status form, whose `is|in` cannot match `matches` either way. The
  // order is stated rather than relied on, since both begin with the same word.
  const matching = STATUS_MATCHES.exec(text);
  if (matching?.[1] !== undefined) {
    const phrase = matching[1].trim();
    const reference = parseWhen(phrase);

    if (!isRequest(reference)) return undefined;

    // A reference that writes would make an assertion change the target, which is
    // invariant I7 broken from inside a verdict. Refused here rather than guarded in the
    // runner, so the criterion is reported unsupported with the clause named.
    if (reference.mutates) return undefined;

    // The parse discriminator belongs to the parse result, not to the request, so the
    // request is rebuilt field by field. An AST carrying a stray `kind: "request"` inside
    // another `kind` reads like a bug the first time somebody serializes or compares one,
    // and spelling the fields out makes a future addition to `WhenRequest` visible here.
    return {
      kind: 'status-matches',
      phrase,
      reference: {
        actorId: reference.actorId,
        action: reference.action,
        mutates: reference.mutates,
        ...(reference.entity === undefined ? {} : { entity: reference.entity }),
        ...(reference.instanceId === undefined ? {} : { instanceId: reference.instanceId }),
        ...(reference.path === undefined ? {} : { path: reference.path }),
      },
    };
  }

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
    const expected = parseAssertionValue(equals[2]);
    return expected === undefined ? undefined : { kind: 'body-equals', path: equals[1], expected };
  }

  // Before the every row form, which cannot match this anyway since it requires `has`.
  // Stated as an order rather than left to two regexes agreeing forever.
  const everyEndpoint = EVERY_ENDPOINT_OMITS.exec(text);
  if (everyEndpoint?.[1] !== undefined && everyEndpoint[2] !== undefined) {
    return { kind: 'every-endpoint-omits', entity: everyEndpoint[1], field: everyEndpoint[2] };
  }

  const everyRow = EVERY_ROW.exec(text);
  if (everyRow?.[1] !== undefined && everyRow[2] !== undefined && everyRow[3] !== undefined) {
    const expected = parseAssertionValue(everyRow[3]);
    return expected === undefined
      ? undefined
      : { kind: 'every-row', entity: everyRow[1], field: everyRow[2], expected };
  }

  const count = RECORD_COUNT.exec(text);
  if (count?.[1] !== undefined && count[2] !== undefined) {
    return { kind: 'record-count', entity: count[1], count: Number(count[2]) };
  }

  // Tried after the count form, which also begins with `record`. The two cannot collide,
  // since a count says `count of` where this says the entity, but order makes that a
  // property of the code rather than of a reader's confidence in two regexes.
  const unchanged = RECORD_UNCHANGED.exec(text);
  if (unchanged?.[1] !== undefined) {
    const instanceId = unchanged[2];
    return {
      kind: 'record-unchanged',
      entity: unchanged[1],
      ...(instanceId === undefined ? {} : { instanceId }),
    };
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
  'status matches <a non-mutating request in the when vocabulary>',
  'body contains field <Entity>.<field>',
  'body omits field <Entity>.<field>',
  'body.<path> equals <literal>, or equals actor.<attribute>',
  'every <Entity> has <field> equal to <literal>, or equal to actor.<attribute>',
  'every endpoint omits field <Entity>.<field>, over the endpoints a probe observed',
  'record count of <Entity> is <n>',
  'record <Entity> is unchanged, optionally naming an instance',
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
