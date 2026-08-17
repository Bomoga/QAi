import type { CheckVerdict } from '../../contracts/index.ts';
import { fail, inconclusive, pass } from '../result.ts';
import type { CheckResult } from '../types.ts';
import { capturePage } from './browser.ts';
import type { Judge, JudgeAnswer, JudgeResponse } from './judge.ts';
import type { BehavioralContext, BehavioralPlan } from './types.ts';

/**
 * Fuzzy criteria, and the mapping that makes invariant I1 true in code.
 *
 * | Judge answer    | A deterministic assertion failed | Verdict        |
 * |-----------------|----------------------------------|----------------|
 * | any             | yes                              | `fail`         |
 * | `satisfied`     | no                               | `pass`         |
 * | `not-satisfied` | no                               | `inconclusive` |
 * | `uncertain`     | no                               | `inconclusive` |
 *
 * Read the first row carefully. The only route to `fail` runs through a deterministic
 * assertion, so the verdict there was decided by an assertion on a response, not by the
 * model. Every other row is `pass` or `inconclusive`. That is the whole of invariant I1
 * as an executable rule: the worst a hallucinating or prompt-injected model can do is
 * under-report, and `mapFuzzyVerdict` is exhaustively tested over the answer union to
 * prove no answer alone produces a failure.
 *
 * The first row also runs the other way. A model answering `satisfied` cannot erase a
 * deterministic failure, which is the same principle pointed at the more tempting
 * mistake: a check that a model can talk out of failing is worth nothing.
 *
 * Every result here sets `deterministic: false`, which is what drives
 * `modelAssistedCheckCount` and the model assisted label in the report. A reader is
 * always told how much of a run was not deterministic.
 */

export function mapFuzzyVerdict(answer: JudgeAnswer, deterministicFailed: boolean): CheckVerdict {
  // A failed assertion decides, whatever the model said. This is the only `fail` in the
  // file, and it is reached without consulting `answer` at all.
  if (deterministicFailed) return 'fail';

  if (answer === 'satisfied') return 'pass';

  // `not-satisfied` and `uncertain` both land here. A model saying a page looks wrong is
  // a reason to look, not a verdict, so it goes in the unverified bucket with its reason
  // attached rather than becoming a finding somebody has to disprove.
  return 'inconclusive';
}

export interface FuzzyOptions {
  /** The deterministic result for the same criterion, when one was run. */
  readonly deterministic?: CheckResult;
}

function label(response: JudgeResponse): string {
  return `Model assisted: the model answered ${response.answer}, "${response.reason}"`;
}

/**
 * Runs one fuzzy criterion.
 *
 * The page is read, the model is asked, and the answer is mapped. Nothing on this path
 * can produce a finding on its own: `fail` arrives only from the deterministic result
 * passed in, which carries its own evidence, so invariant I3 holds without this function
 * needing an evidence writer of its own.
 */
export async function runFuzzyCheck(
  plan: BehavioralPlan,
  context: BehavioralContext,
  judge: Judge,
  options: FuzzyOptions = {},
): Promise<CheckResult> {
  const deterministicFailed = options.deterministic?.verdict === 'fail';

  const input = {
    identity: {
      type: 'behavioral' as const,
      requirementId: plan.requirementId,
      ruleId: plan.criterionId,
      actorId: plan.actorId,
      action: `fuzzy ${plan.request.path}`,
    },
    title: `Acceptance criterion ${plan.criterionId}`,
    deterministic: false,
    evidence: options.deterministic?.evidence ?? [],
    ...(plan.locationRef === undefined ? {} : { locationRef: plan.locationRef }),
  };

  const browser = context.browser;

  if (browser === undefined) {
    return inconclusive({
      ...input,
      detail: `${plan.criterionId} needs a browser and none is configured, so the page was not read.`,
    });
  }

  const capture = await capturePage(`${browser.baseUrl}${plan.request.path}`, {
    ...(browser.headers === undefined ? {} : { headers: browser.headers }),
    ...(browser.screenshotPath === undefined ? {} : { screenshotPath: browser.screenshotPath }),
    ...(browser.launcher === undefined ? {} : { launcher: browser.launcher }),
  });

  if (capture.kind !== 'captured') {
    const remedy = capture.kind === 'unavailable' ? ` ${capture.remedy}` : '';
    return inconclusive({
      ...input,
      detail: `${plan.criterionId} was not assessed: ${capture.reason}.${remedy}`,
    });
  }

  const response = await judge.judge({
    criterionId: plan.criterionId,
    given: plan.given,
    when: plan.when,
    then: plan.then,
    pageText: capture.capture.text,
    ...(capture.capture.screenshotPath === undefined
      ? {}
      : { screenshotRef: capture.capture.screenshotPath }),
  });

  const verdict = mapFuzzyVerdict(response.answer, deterministicFailed);

  if (verdict === 'fail') {
    // Reached only because an assertion failed. The detail leads with that, and the
    // model's opinion trails it clearly labeled, so nobody reads this as the model
    // having decided anything.
    return fail(
      {
        ...input,
        detail: `${options.deterministic?.detail ?? 'a deterministic assertion failed'} ${label(response)}`,
      },
      plan.severityOnFail,
    );
  }

  const detail = `${plan.criterionId} was assessed against the page at ${plan.request.path}. ${label(response)}`;

  return verdict === 'pass' ? pass({ ...input, detail }) : inconclusive({ ...input, detail });
}
