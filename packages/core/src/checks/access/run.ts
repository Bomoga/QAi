import type { ActorSession } from '../../target/session.ts';
import { fail, inconclusive, pass } from '../result.ts';
import type { CheckResult } from '../types.ts';
import { selectCandidate, type CandidateRecord } from './evaluate.ts';
import {
  allowFailureDetail,
  denyFailureDetail,
  listFailureDetail,
  passDetail,
  severityForAccessFailure,
} from './findings.ts';
import { assessDenyListOutcome } from './list.ts';
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
  /**
   * Absent means mutating checks are not permitted. Supplied by the caller from the
   * M2 disposability gate rather than recomputed here, so there is one interlock
   * rather than two implementations of one.
   */
  readonly mutation?: MutationPermission;
}

export interface MutationPermission {
  readonly allowed: boolean;
  /** Why not, written for someone who has to change something. Present when refused. */
  readonly refusal?: string;
  /** Restores the target between mutating checks. Absent means no reset is possible. */
  reset?: () => Promise<void>;
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
  /**
   * Invariant I7, checked before anything is sent. A mutating check against a target
   * nobody declared disposable does not run, and reports why rather than passing
   * quietly. There is no flag that reaches past this.
   */
  if (plan.mutates && context.mutation?.allowed !== true) {
    return inconclusive({
      identity: plan.identity,
      title: `Mutating check on ${plan.resource} was not attempted`,
      detail:
        context.mutation?.refusal ??
        'The target is not declared disposable with a reset command, so no check that writes to it was run.',
    });
  }

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
  const request = `${plan.method} ${path}`;
  const where = `${request} as actor ${plan.actorId}`;
  const locationRef = plan.locationRef === undefined ? {} : { locationRef: plan.locationRef };

  if (plan.action === 'list' && plan.rule.effect === 'deny') {
    const assessment = assessDenyListOutcome({
      outcome,
      condition: plan.condition,
      entity: plan.resource,
      actorAttributes: session.attributes,
    });

    if (assessment.verdict === 'fail') {
      return fail(
        {
          identity: plan.identity,
          title: `${plan.resource} list returned rows belonging to another owner`,
          detail: listFailureDetail({
            plan,
            request,
            evidenceId,
            ...(assessment.status === undefined ? {} : { status: assessment.status }),
            foreignRowIds: assessment.foreignRowIds,
            totalRows: assessment.totalRows,
          }),
          evidence,
          ...locationRef,
        },
        severityForAccessFailure(plan),
      );
    }

    if (assessment.verdict === 'pass') {
      const note =
        assessment.reason === 'refused'
          ? ''
          : `with ${assessment.totalRows} row(s), none of which the rule denies`;

      return pass({
        identity: plan.identity,
        title: `${plan.resource} list is scoped to actor ${plan.actorId}`,
        detail: passDetail({
          plan,
          request,
          evidenceId,
          ...(assessment.status === undefined ? {} : { status: assessment.status }),
          note,
        }).trim(),
        evidence,
        ...locationRef,
      });
    }

    return inconclusive({
      identity: plan.identity,
      title: `Scoping of the ${plan.resource} list could not be established`,
      detail: describeListInconclusive(where, assessment.reason, assessment.status),
      evidence,
    });
  }

  if (plan.rule.effect === 'deny') {
    const assessment = assessDenyOutcome(outcome, plan.resourceFields);

    if (assessment.verdict === 'fail') {
      return fail(
        {
          identity: plan.identity,
          title: `${plan.resource} readable by actor ${plan.actorId}, which the spec denies`,
          detail: denyFailureDetail({
            plan,
            request,
            evidenceId,
            ...(assessment.status === undefined ? {} : { status: assessment.status }),
            observedFields: assessment.observedFields,
          }),
          evidence,
          ...locationRef,
        },
        severityForAccessFailure(plan),
      );
    }

    if (assessment.verdict === 'pass') {
      return pass({
        identity: plan.identity,
        title: `${plan.resource} refused to actor ${plan.actorId}`,
        detail: passDetail({
          plan,
          request,
          evidenceId,
          ...(assessment.status === undefined ? {} : { status: assessment.status }),
          note: `with no ${plan.resource} fields in the body`,
        }),
        evidence,
        ...locationRef,
      });
    }

    return inconclusive({
      identity: plan.identity,
      title: `Access to ${plan.resource} by actor ${plan.actorId} could not be established`,
      detail: describeInconclusive(where, assessment.reason, assessment.status),
      evidence,
      ...locationRef,
    });
  }

  const assessment = assessAllowOutcome(outcome, plan.resourceFields);

  if (assessment.verdict === 'pass') {
    return pass({
      identity: plan.identity,
      title: `${plan.resource} reachable by actor ${plan.actorId}, as the spec allows`,
      detail: passDetail({
        plan,
        request,
        evidenceId,
        ...(assessment.status === undefined ? {} : { status: assessment.status }),
        note: '',
      }).trim(),
      evidence,
      ...locationRef,
    });
  }

  if (assessment.verdict === 'fail') {
    return fail(
      {
        identity: plan.identity,
        title: `${plan.resource} refused to actor ${plan.actorId}, which the spec allows`,
        detail: allowFailureDetail({
          plan,
          request,
          evidenceId,
          ...(assessment.status === undefined ? {} : { status: assessment.status }),
        }),
        evidence,
        ...locationRef,
      },
      severityForAccessFailure(plan),
    );
  }

  return inconclusive({
    identity: plan.identity,
    title: `Access to ${plan.resource} by actor ${plan.actorId} could not be established`,
    detail: describeInconclusive(where, assessment.reason, assessment.status),
    evidence,
    ...locationRef,
  });
}

/**
 * Runs a batch. Non-mutating checks first, then mutating ones one at a time with a
 * reset between them.
 *
 * The ordering is not a convenience. A mutating check changes what every check after
 * it observes, so running one in the middle of a batch would make the results that
 * follow describe a target that no longer matches the one being reported on. Serial
 * execution with a reset between is what keeps each mutating check answerable on its
 * own, and a reset that fails stops the remaining mutating checks rather than letting
 * them run against a target in an unknown state.
 */
export async function runAccessChecks(
  plans: readonly AccessCheckPlan[],
  context: AccessRunContext,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const plan of plans.filter((candidate) => !candidate.mutates)) {
    results.push(await runAccessCheck(plan, context));
  }

  const mutating = plans.filter((candidate) => candidate.mutates);
  let resetFailed: string | undefined;

  for (const [index, plan] of mutating.entries()) {
    if (resetFailed !== undefined) {
      results.push(
        inconclusive({
          identity: plan.identity,
          title: `Mutating check on ${plan.resource} was not attempted`,
          detail: `An earlier reset did not complete, so the target state is unknown and no further mutating check was run: ${resetFailed}`,
        }),
      );
      continue;
    }

    results.push(await runAccessCheck(plan, context));

    const isLast = index === mutating.length - 1;
    const reset = context.mutation?.reset;
    if (isLast || reset === undefined) continue;

    try {
      await reset();
    } catch (cause) {
      resetFailed = cause instanceof Error ? cause.message : 'the reset command failed';
    }
  }

  return results;
}

/** Q5: an empty list and an unreadable one are different facts and read differently. */
function describeListInconclusive(where: string, reason: string, status?: number): string {
  switch (reason) {
    case 'transport-error':
      return `${where} did not complete, so nothing was established about it`;
    case 'server-error':
      return `${where} returned ${status}, which says nothing about how the list is scoped`;
    case 'no-rows-returned':
      return `${where} returned ${status} with no rows. An empty list may mean the endpoint scopes correctly or that there was nothing to return, and those are not distinguishable from here`;
    case 'no-rows-recognized':
      return `${where} returned ${status} in a shape this check could not read as a list of records`;
    case 'ownership-undecidable':
      return `${where} returned ${status}, but ownership of the returned rows could not be established from the rule condition`;
    default:
      return `${where} returned ${status}, which the verdict table does not cover`;
  }
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
