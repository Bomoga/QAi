import type { UnverifiedReason } from '../contracts/index.ts';
import type { UnplannableRule } from './access/plan.ts';
import type { UnplannableCriterion } from './behavioral/plan.ts';
import type { UnverifiedCheck } from './behavioral/run.ts';

/**
 * Every way a run can fail to check something, gathered in one place.
 *
 * Three side channels report coverage gaps, and they are all correct: an access rule that
 * could not be planned, a criterion that could not be planned, and a fuzzy criterion that
 * could not be assessed. Nothing joined them, so a caller had to remember all three, and
 * a caller that remembered two would drop a gap silently. That is how AR-011-01 stayed
 * unplannable across two stages while being reported honestly on every run.
 *
 * **These are deliberately not `CheckResult`s.** The vocabulary in 00-INDEX.md defines a
 * check as a single verification attempt producing one verdict, and none of these was
 * attempted. Turning them into inconclusive results would put things that never ran into
 * `summary.checks.total`, which reads as work the tool did. 03-CONTRACTS.md already has
 * the right home for them, `unverifiedReasons` on the RunResult, keyed by requirement and
 * drawn from a closed set, and every shape below already carries a reason from that set.
 *
 * One gap per rule or criterion, not per requirement. A requirement with two unplannable
 * rules has two things wrong with it and a reader fixing them needs both named. Whoever
 * assembles the RunResult collapses these per requirement, which is M7's to do.
 */

export interface CoverageGap {
  readonly requirementId: string;
  /** The rule or criterion that was not checked, so a reader can find it in the spec. */
  readonly id: string;
  readonly kind: 'access' | 'behavioral';
  readonly reason: UnverifiedReason;
  /** Written for someone who has to change something before the check can run. */
  readonly detail: string;
}

export interface CoverageGapSources {
  /** Access rules `planAccessChecks` could not turn into a check. */
  readonly accessUnplannable?: readonly UnplannableRule[];
  /** Criteria `planBehavioralChecks` could not turn into a check. */
  readonly behavioralUnplannable?: readonly UnplannableCriterion[];
  /** Criteria that were planned and could not be assessed, from `runBehavioralChecks`. */
  readonly behavioralUnverified?: readonly UnverifiedCheck[];
}

/**
 * Ordering is by requirement then id, not by which source reported it. A reader looking
 * for what is wrong with REQ-011 should find it in one place, and a stable order is what
 * lets two runs of the same target be compared by eye, per rule R6.
 */
export function collectCoverageGaps(sources: CoverageGapSources): CoverageGap[] {
  const gaps: CoverageGap[] = [
    ...(sources.accessUnplannable ?? []).map((entry): CoverageGap => ({
      requirementId: entry.requirementId,
      id: entry.ruleId,
      kind: 'access',
      reason: entry.reason,
      detail: entry.detail,
    })),
    ...(sources.behavioralUnplannable ?? []).map((entry): CoverageGap => ({
      requirementId: entry.requirementId,
      id: entry.criterionId,
      kind: 'behavioral',
      reason: entry.reason,
      detail: entry.detail,
    })),
    ...(sources.behavioralUnverified ?? []).map((entry): CoverageGap => ({
      requirementId: entry.requirementId,
      id: entry.criterionId,
      kind: 'behavioral',
      reason: entry.reason,
      detail: entry.detail,
    })),
  ];

  /**
   * A criterion can be reported by two sources at once, unplannable and unverified, and
   * the same gap twice reads as two problems. The first wins, since planning happens
   * before running and its reason is the earlier and more actionable one.
   */
  const seen = new Set<string>();
  const unique = gaps.filter((gap) => {
    const key = `${gap.kind} ${gap.requirementId} ${gap.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.sort(
    (left, right) =>
      left.requirementId.localeCompare(right.requirementId) || left.id.localeCompare(right.id),
  );
}

/** One line per gap, for a caller that has somewhere to print. Core never writes output. */
export function formatCoverageGap(gap: CoverageGap): string {
  return `${gap.id.padEnd(12)}${gap.reason}\n    ${gap.detail}`;
}
