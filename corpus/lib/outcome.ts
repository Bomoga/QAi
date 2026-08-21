import type { RunResult } from '../../packages/core/src/index.ts';

/**
 * What an exit code from `qai check` means to a corpus run.
 *
 * **0 and 1 are both a completed run.** 03-CONTRACTS.md gives 1 to a run that finished
 * and found something at or above the threshold, which for an application in this corpus
 * is the expected and interesting case. Treating it as a failure would drop exactly the
 * applications the corpus exists to measure.
 *
 * **2 and 3 are not.** They describe a run that did not happen: an invalid spec or
 * configuration, and a target that could not be reached. An application whose spec does
 * not load produced no findings to review, so it belongs in the numerator of nothing and
 * has to be visible as a gap rather than as a clean result.
 */

export type CheckOutcome =
  | { readonly kind: 'checked'; readonly exitCode: 0 | 1 }
  | { readonly kind: 'check-failed'; readonly reason: string };

/** The last few lines of stderr, which is where the CLI's error presentation ends up. */
function tail(stderr: string, lines = 3): string {
  return stderr
    .trim()
    .split('\n')
    .slice(-lines)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ');
}

export function classifyCheckExit(code: number, stderr = ''): CheckOutcome {
  if (code === 0 || code === 1) return { kind: 'checked', exitCode: code };

  const detail = tail(stderr);
  return {
    kind: 'check-failed',
    reason: detail.length > 0 ? `qai check exited ${code}: ${detail}` : `qai check exited ${code}`,
  };
}

/**
 * What one run actually covered, in a line, printed beside its exit code.
 *
 * An application whose acceptance criteria the vocabulary cannot read still checks,
 * still exits 0, and still writes a result. Nothing the runner printed said so, and five
 * of the first six corpus applications carried a criterion that never ran because of it,
 * across two batches and two reviews. The findings were reviewed and the coverage behind
 * them was not, which made the corpus look larger than it was.
 *
 * So coverage is printed for every application, with the reasons, since invariant I4
 * says a requirement nobody could check is a first class result rather than an absence.
 */
export function describeCoverage(result: RunResult): string {
  const { total, verified, failed, unverified } = result.summary.requirements;
  const reasons = [...new Set(result.unverifiedReasons.map((one) => one.reason))].sort();
  const why = reasons.length === 0 ? '' : `, unverified for ${reasons.join(', ')}`;

  return `${verified} verified, ${failed} failed, ${unverified} unverified of ${total} requirement(s)${why}`;
}
