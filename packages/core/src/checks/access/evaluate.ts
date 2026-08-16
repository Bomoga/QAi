import type { ComparisonNode, ConditionAst, OperandNode } from '../../spec/condition.ts';

/**
 * Condition evaluation against a candidate record.
 *
 * M1 parses a condition into an AST and never evaluates it. This is where evaluation
 * happens, and it is deliberately not an interpreter for a general language: it walks
 * a fixed AST comparing string attributes. Nothing here builds a function, and nothing
 * here reaches `eval`.
 *
 * The question being answered is narrow. Given a deny rule saying
 * `Invoice.org_id != actor.org_id`, which seeded invoice belongs to someone other
 * than the actor? That instance is the one worth requesting, because a refusal on a
 * record the actor already owns proves nothing.
 *
 * A comparison the tool cannot resolve is `unknown`, not false. Treating a missing
 * attribute as a failed match would silently pick the wrong record and then report a
 * confident verdict about it.
 */

export type Truth = 'true' | 'false' | 'unknown';

export interface EvaluationScope {
  /** Attributes of the record under consideration, keyed by field name. */
  readonly record: Readonly<Record<string, string>>;
  /** Attributes of the acting identity, from the actor's configured attributes. */
  readonly actor: Readonly<Record<string, string>>;
  /** The entity the record is an instance of, matched case-insensitively. */
  readonly entity: string;
}

type Resolved =
  | { readonly kind: 'value'; readonly value: string | number | null }
  | { readonly kind: 'list'; readonly values: readonly (string | number | null)[] }
  | { readonly kind: 'unknown' };

/**
 * Own properties only. A plain object inherits `constructor`, `toString`, and the rest
 * of `Object.prototype`, so a condition naming one of those would otherwise resolve to
 * a JavaScript internal and be compared as though it were data. That is not a value
 * the record carries, and treating it as one is how a condition starts reading the
 * runtime instead of the target.
 */
function ownValue(source: Readonly<Record<string, string>>, property: string): string | undefined {
  return Object.hasOwn(source, property) ? source[property] : undefined;
}

function resolveOperand(operand: OperandNode, scope: EvaluationScope): Resolved {
  switch (operand.kind) {
    case 'literal':
      return { kind: 'value', value: operand.value };

    case 'list':
      return { kind: 'list', values: operand.items.map((item) => item.value) };

    case 'actorRef': {
      const value = ownValue(scope.actor, operand.property);
      return value === undefined ? { kind: 'unknown' } : { kind: 'value', value };
    }

    case 'entityRef': {
      // A reference to a different entity cannot be answered from this record.
      if (operand.entity.toLowerCase() !== scope.entity.toLowerCase()) {
        return { kind: 'unknown' };
      }
      const value = ownValue(scope.record, operand.property);
      return value === undefined ? { kind: 'unknown' } : { kind: 'value', value };
    }
  }
}

/** Loose across string and number, so `org_id: 1` and `"1"` compare equal. */
function sameValue(left: string | number | null, right: string | number | null): boolean {
  if (left === null || right === null) return left === right;
  return String(left) === String(right);
}

function evaluateComparison(comparison: ComparisonNode, scope: EvaluationScope): Truth {
  const left = resolveOperand(comparison.left, scope);
  const right = resolveOperand(comparison.right, scope);

  if (left.kind === 'unknown' || right.kind === 'unknown') return 'unknown';

  switch (comparison.operator) {
    case '==':
    case '!=': {
      if (left.kind === 'list' || right.kind === 'list') return 'unknown';
      const equal = sameValue(left.value, right.value);
      const result = comparison.operator === '==' ? equal : !equal;
      return result ? 'true' : 'false';
    }

    case 'in':
    case 'not in': {
      if (left.kind !== 'value' || right.kind !== 'list') return 'unknown';
      const member = right.values.some((candidate) => sameValue(candidate, left.value));
      const result = comparison.operator === 'in' ? member : !member;
      return result ? 'true' : 'false';
    }
  }
}

/**
 * Conjunction over three values. One false makes the whole thing false even if
 * another comparison is unknown, because a conjunction with a false term cannot hold
 * whatever the rest turn out to be. Otherwise any unknown makes the result unknown.
 */
export function evaluateCondition(ast: ConditionAst, scope: EvaluationScope): Truth {
  let sawUnknown = false;

  for (const comparison of ast.comparisons) {
    const truth = evaluateComparison(comparison, scope);
    if (truth === 'false') return 'false';
    if (truth === 'unknown') sawUnknown = true;
  }

  return sawUnknown ? 'unknown' : 'true';
}

export interface CandidateRecord {
  readonly id: string;
  readonly attributes: Readonly<Record<string, string>>;
}

export interface CandidateSelection {
  readonly matched?: CandidateRecord;
  /** Present when nothing matched, naming why so the check can report it. */
  readonly reason?: 'no-candidates' | 'none-matched' | 'undecidable';
}

/**
 * Picks the record the condition holds for. Used by a deny check to find an instance
 * that belongs to someone else.
 *
 * An undecidable condition does not fall through to an arbitrary record. If ownership
 * cannot be established, the honest answer is that no suitable instance was found,
 * and the caller turns that into `inconclusive`.
 */
export function selectCandidate(
  candidates: readonly CandidateRecord[],
  ast: ConditionAst | undefined,
  entity: string,
  actor: Readonly<Record<string, string>>,
): CandidateSelection {
  if (candidates.length === 0) return { reason: 'no-candidates' };

  // With no condition, any seeded record is as good as another.
  if (ast === undefined) {
    const first = candidates[0];
    return first === undefined ? { reason: 'no-candidates' } : { matched: first };
  }

  let sawUnknown = false;

  for (const candidate of candidates) {
    const truth = evaluateCondition(ast, {
      record: candidate.attributes,
      actor,
      entity,
    });

    if (truth === 'true') return { matched: candidate };
    if (truth === 'unknown') sawUnknown = true;
  }

  return { reason: sawUnknown ? 'undecidable' : 'none-matched' };
}
