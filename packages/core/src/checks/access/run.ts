import type { ActorSession } from '../../target/session.ts';
import { fail, inconclusive, pass } from '../result.ts';
import type { CheckResult } from '../types.ts';
import { selectCandidate, type CandidateRecord } from './evaluate.ts';
import { resolvePath, type AccessCheckPlan } from './plan.ts';
import { assessAllowOutcome, assessDenyOutcome } from './verdict.ts';

/**
 * Executing an access check.
 *
 * The order is fixed by rule R7: resolve a target record, issue the request, capture
 * evidence, then decide. The session captures evidence on every request including one
 * that never connected, so a verdict here always has an evidence id to point at.
 *
 * Nothing in this file consults a model, and the verdict comes entirely from the
 * assessment tables in `verdict.ts`.
 */

export interface AccessRunContext {
  readonly sessions: ReadonlyMap<string, ActorSession>;
}

/** Actions that act on one record and therefore need one identified first. */
const INSTANCE_ACTIONS = new Set(['read', 'update', 'delete']);

function candidatesOf(plan: AccessCheckPlan): CandidateRecord[] {
  return plan.candidates.map((instance) => ({
    id: instance.id,
    attributes: instance.attributes,
  }));
}

export async function runAccessCheck(
  plan: AccessCheckPlan,
  context: AccessRunContext,
): Promise<CheckResult> {
  const session = context.sessions.get(plan.actorId);

  if (session === undefined) {
    return inconclusive({
      identity: plan.identity,
      title: `Actor ${plan.actorId} was not available`,
      detail: `The rule acts as "${plan.actorId}" and no session resolved for it, so the action was never attempted.`,
    });
  }

  let path = plan.pathTemplate;

  if (INSTANCE_ACTIONS.has(plan.action)) {
    const selection = selectCandidate(
      candidatesOf(plan),
      plan.condition,
      plan.resource,
      session.attributes,
    );

    if (selection.matched === undefined) {
      /**
       * No suitable record means the check proves nothing, whatever the target
       * answers. Requesting an id that was never seeded would produce a 404 that
       * looks exactly like correct enforcement.
       */
      const because =
        selection.reason === 'no-candidates'
          ? `no instances of ${plan.resource} are configured`
          : selection.reason === 'none-matched'
            ? `no configured ${plan.resource} satisfies the rule condition`
            : `ownership of the configured ${plan.resource} instances could not be established from the rule condition`;

      return inconclusive({
        identity: plan.identity,
        title: `No suitable ${plan.resource} to act on`,
        detail: `The check was not attempted because ${because}. Testing access control against a record that does not exist proves nothing.`,
      });
    }

    path = resolvePath(plan.pathTemplate, selection.matched.id);
  }

  const { outcome, evidenceId } = await session.request({ method: plan.method, path });
  const evidence = [evidenceId];

  if (plan.rule.effect === 'deny') {
    const assessment = assessDenyOutcome(outcome, plan.resourceFields);
    const where = `${plan.method} ${path} as actor ${plan.actorId}`;

    if (assessment.verdict === 'fail') {
      return fail(
        {
          identity: plan.identity,
          title: `${plan.resource} readable by actor ${plan.actorId}, which the spec denies`,
          detail: `${where} returned ${assessment.status} with ${plan.resource} fields ${assessment.observedFields.join(', ')}`,
          evidence,
        },
        plan.severityOnFail,
      );
    }

    if (assessment.verdict === 'pass') {
      return pass({
        identity: plan.identity,
        title: `${plan.resource} refused to actor ${plan.actorId}`,
        detail: `${where} returned ${assessment.status} with no ${plan.resource} fields in the body`,
        evidence,
      });
    }

    return inconclusive({
      identity: plan.identity,
      title: `Access to ${plan.resource} by actor ${plan.actorId} could not be established`,
      detail: describeInconclusive(where, assessment.reason, assessment.status),
      evidence,
    });
  }

  const assessment = assessAllowOutcome(outcome, plan.resourceFields);
  const where = `${plan.method} ${path} as actor ${plan.actorId}`;

  if (assessment.verdict === 'pass') {
    return pass({
      identity: plan.identity,
      title: `${plan.resource} reachable by actor ${plan.actorId}, as the spec allows`,
      detail: `${where} returned ${assessment.status}`,
      evidence,
    });
  }

  if (assessment.verdict === 'fail') {
    return fail(
      {
        identity: plan.identity,
        title: `${plan.resource} refused to actor ${plan.actorId}, which the spec allows`,
        detail: `${where} returned ${assessment.status}`,
        evidence,
      },
      plan.severityOnFail,
    );
  }

  return inconclusive({
    identity: plan.identity,
    title: `Access to ${plan.resource} by actor ${plan.actorId} could not be established`,
    detail: describeInconclusive(where, assessment.reason, assessment.status),
    evidence,
  });
}

/** States the observation, never the label. See the output style in 04-CONVENTIONS.md. */
function describeInconclusive(where: string, reason: string, status?: number): string {
  switch (reason) {
    case 'transport-error':
      return `${where} did not complete, so nothing was established about it`;
    case 'server-error':
      return `${where} returned ${status}, which says nothing about whether access is enforced`;
    case 'empty-or-unrelated-body':
      return `${where} returned ${status} with no recognizable fields, which may be a refusal or a response in a shape this check does not recognize`;
    default:
      return `${where} returned ${status}, which the verdict table does not cover`;
  }
}
