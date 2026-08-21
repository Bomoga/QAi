import type { RunResult, Severity } from '../contracts/index.ts';

/**
 * The exit code a run recommends, computed here and applied by the CLI.
 *
 * **Nothing in this file exits.** Rule R5: `core` produces no output and calls no
 * `process.exit`. This returns a number and M8 decides what to do with it, which is what
 * keeps the rule from being a convention somebody has to remember.
 *
 * **Only 0 and 1 live here.** 03-CONTRACTS.md gives 2 to an invalid spec or a
 * configuration error and 3 to an unreachable target or a fatal runtime error, and both
 * describe a run that did not happen or did not finish. A function handed a finished
 * RunResult is by construction not in either case.
 */

/** Highest first. A threshold admits everything at its level and above. */
const SEVERITY_ORDER: readonly Severity[] = ['high', 'medium', 'low', 'info'];

export interface ExitPolicy {
  /**
   * The lowest severity that counts as failure. Defaults to `high`, per the exit code
   * table in 03-CONTRACTS.md.
   */
  readonly failOn?: Severity;
  /**
   * Opt in to treating coverage gaps as failure. Off by default: a requirement nobody
   * could check is not a requirement that failed, and turning gaps red by default would
   * make the honest verdict the one people switch off.
   */
  readonly failOnUnverified?: boolean;
}

function rank(severity: Severity): number {
  return SEVERITY_ORDER.indexOf(severity);
}

/**
 * True when `severity` is at or above `threshold`. `info` as a threshold admits
 * everything, which is the point of offering it.
 */
function atOrAbove(severity: Severity, threshold: Severity): boolean {
  return rank(severity) <= rank(threshold);
}

export function computeExitCode(result: RunResult, policy: ExitPolicy): 0 | 1 {
  const threshold = policy.failOn ?? 'high';

  // Findings are failures. `findingsBySeverity` already counts only those, so a passing
  // check carrying `info` cannot turn a clean run red through an `--fail-on info`.
  for (const severity of SEVERITY_ORDER) {
    if (!atOrAbove(severity, threshold)) continue;
    if (result.summary.findingsBySeverity[severity] > 0) return 1;
  }

  // Inconclusive checks never by themselves produce exit code 1, per the contract. This
  // is the opt in that changes that, and it reads the requirement verdict rather than
  // the check tally: a requirement with one inconclusive check and one that passed is
  // verified, and it is not a coverage gap.
  if (policy.failOnUnverified === true && result.summary.requirements.unverified > 0) {
    return 1;
  }

  return 0;
}
