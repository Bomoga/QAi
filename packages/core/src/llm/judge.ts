import type { Judge, JudgeQuestion, JudgeResponse } from '../checks/behavioral/judge.ts';

/**
 * The model layer. The only directory permitted to import a model client, per rule R1.
 *
 * Nothing here decides anything. Every function returns a suggestion, a summary, an
 * extraction, or an opinion, and none of them can return a value assignable to a
 * `Verdict`, which `boundary.test.ts` proves by type over everything this directory
 * exports rather than by inspection.
 *
 * No model client is imported yet, and none can be until a dependency is approved: the
 * list in 04-CONVENTIONS.md has no model SDK on it. What exists here is the boundary and
 * the honest answer for when no model is configured.
 */

/**
 * The judge used when no model is available, which is the default.
 *
 * It answers `uncertain` every time, because that is true: nothing looked at the page.
 * `uncertain` maps to `inconclusive` and never to `fail`, so a run without a model
 * reports coverage it did not achieve rather than a clean bill of health. Invariant I4,
 * and the reason unverified has to be a first-class verdict.
 */
export function unavailableJudge(reason?: string): Judge {
  const detail =
    reason ??
    'no model is configured, so the criterion was not assessed. Fuzzy criteria need a model and are reported as unverified without one.';

  return {
    judge(question: JudgeQuestion): Promise<JudgeResponse> {
      return Promise.resolve({
        answer: 'uncertain',
        reason: `${question.criterionId}: ${detail}`,
      });
    },
  };
}

/**
 * A judge that answers from a fixed script, for tests and for the corpus run.
 *
 * It exists here rather than in a test helper for the same reason `fixedDeps` does: every
 * module that needs a fake needs the same one, and three slightly different fakes is how
 * two suites start disagreeing about what the boundary permits. Adversarial answers are
 * exactly what M5.6 has to be tested against.
 */
export function scriptedJudge(answers: readonly JudgeResponse[]): Judge {
  let index = 0;

  return {
    judge(): Promise<JudgeResponse> {
      const answer = answers[index] ?? answers[answers.length - 1];
      index += 1;

      return Promise.resolve(
        answer ?? { answer: 'uncertain', reason: 'the script ran out of answers' },
      );
    },
  };
}
