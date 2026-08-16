import type { CheckType } from '../contracts/index.ts';
import { inconclusive } from './result.ts';
import type { CheckPlan, CheckResult, CheckRunner } from './types.ts';

/**
 * Check registration and dispatch.
 *
 * The registry exists so that a thrown error cannot become a missing check. Rule R4
 * says a check returns `inconclusive` rather than throwing, and stating that as a
 * convention would leave it to every runner to remember. Here it is enforced in the
 * one place every check passes through: a runner that throws produces an inconclusive
 * result naming the error, and the run continues.
 *
 * The alternative, letting the exception escape, loses every check after it. A run
 * that reports less is acceptable. A run that stops early and still prints a summary
 * is a run that reports wrongly.
 */

export interface CheckRegistry<TContext> {
  register<TPlan extends CheckPlan>(type: CheckType, runner: CheckRunner<TPlan, TContext>): void;
  has(type: CheckType): boolean;
  run(plan: CheckPlan, context: TContext): Promise<CheckResult>;
  runAll(plans: readonly CheckPlan[], context: TContext): Promise<CheckResult[]>;
}

export function createCheckRegistry<TContext>(): CheckRegistry<TContext> {
  const runners = new Map<CheckType, CheckRunner<CheckPlan, TContext>>();

  async function run(plan: CheckPlan, context: TContext): Promise<CheckResult> {
    const runner = runners.get(plan.identity.type);

    if (runner === undefined) {
      return inconclusive({
        identity: plan.identity,
        title: `No runner registered for check type ${plan.identity.type}`,
        detail: `The check was planned but nothing was registered to carry it out, so nothing about it was established.`,
      });
    }

    try {
      return await runner(plan, context);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : 'the check threw a non-error value';
      return inconclusive({
        identity: plan.identity,
        title: `Check could not be completed`,
        detail: `The check stopped with an error and no verdict was reached: ${reason}`,
      });
    }
  }

  return {
    register(type, runner) {
      runners.set(type, runner as CheckRunner<CheckPlan, TContext>);
    },

    has(type) {
      return runners.has(type);
    },

    run,

    /**
     * Non-mutating checks first, then mutating ones serially. Ordering is by plan
     * rather than by caller discipline, so a mutating check cannot land in the middle
     * of a batch and change what the checks after it observe.
     */
    async runAll(plans, context) {
      const readOnly = plans.filter((plan) => !plan.mutates);
      const mutating = plans.filter((plan) => plan.mutates);

      const results: CheckResult[] = [];
      for (const plan of readOnly) {
        results.push(await run(plan, context));
      }
      for (const plan of mutating) {
        results.push(await run(plan, context));
      }
      return results;
    },
  };
}
