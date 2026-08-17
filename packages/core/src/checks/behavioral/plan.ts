import type { Observation, Spec, UnverifiedReason } from '../../contracts/index.ts';
import { resolvePath, type PlanningContext } from '../access/plan.ts';
import { isSupported, parseThen } from './assertions.ts';
import { BEHAVIORAL_SEVERITY, type BehavioralPlan } from './types.ts';
import { isRequest, METHOD_FOR_WHEN, parseWhen, type WhenRequest } from './when.ts';

/**
 * Turning acceptance criteria into checks.
 *
 * A criterion becomes a plan only when both halves are expressible: the `when` in the
 * request vocabulary and the `then` in the assertion vocabulary. Anything else comes back
 * in `unplannable` with a reason, never dropped, because a criterion that vanished from
 * the plan would read as coverage that does not exist. That is the same posture M3 takes
 * with a rule it cannot plan.
 *
 * Routes resolve the way they do for access rules: an Observation endpoint first, since
 * a probe read the application, then a configured route, then nothing. A URL is never
 * guessed from an entity name.
 */

export interface UnplannableCriterion {
  readonly requirementId: string;
  readonly criterionId: string;
  readonly reason: UnverifiedReason;
  readonly detail: string;
}

export interface BehavioralPlanResult {
  readonly plans: readonly BehavioralPlan[];
  readonly unplannable: readonly UnplannableCriterion[];
}

function routeFor(
  request: WhenRequest,
  observation: Observation | null,
  context: PlanningContext,
): string | undefined {
  if (request.action === 'path') return request.path;
  if (request.entity === undefined) return undefined;

  const method = METHOD_FOR_WHEN[request.action];
  const collection = request.action === 'list' || request.action === 'create';

  const observed = observation?.endpoints.find(
    (endpoint) =>
      endpoint.responseShape?.entity?.toLowerCase() === request.entity?.toLowerCase() &&
      endpoint.method.toUpperCase() === method &&
      (collection ? !endpoint.path.includes(':') : endpoint.path.includes(':')),
  );

  // `path` returned above, so what is left maps one to one onto an access action.
  const configured = context.resources.find(
    (entry) => entry.name.toLowerCase() === request.entity?.toLowerCase(),
  )?.routes[request.action];

  return observed?.path ?? configured;
}

function handlerRefFor(request: WhenRequest, observation: Observation | null): string | undefined {
  if (request.entity === undefined) return undefined;

  return observation?.endpoints.find(
    (endpoint) => endpoint.responseShape?.entity?.toLowerCase() === request.entity?.toLowerCase(),
  )?.handlerRef;
}

function instanceFor(request: WhenRequest, context: PlanningContext): string | undefined {
  if (request.instanceId !== undefined) return request.instanceId;

  return context.resources.find(
    (entry) => entry.name.toLowerCase() === request.entity?.toLowerCase(),
  )?.instances[0]?.id;
}

export function planBehavioralChecks(
  spec: Spec,
  observation: Observation | null,
  context: PlanningContext,
): BehavioralPlanResult {
  const plans: BehavioralPlan[] = [];
  const unplannable: UnplannableCriterion[] = [];

  for (const requirement of spec.requirements) {
    requirement.acceptanceCriteria.forEach((criterion, index) => {
      const criterionId = criterion.id ?? `${requirement.id}-AC-${index + 1}`;
      const refuse = (reason: UnverifiedReason, detail: string): void => {
        unplannable.push({ requirementId: requirement.id, criterionId, reason, detail });
      };

      // Fuzzy criteria are the browser path and do not go through either vocabulary.
      if (criterion.mode !== 'deterministic') {
        refuse('capability-unavailable', 'the criterion is fuzzy and needs the browser runner');
        return;
      }

      const when = parseWhen(criterion.when);
      if (!isRequest(when)) {
        refuse('unsupported-condition', `its when clause could not be read: ${when.reason}`);
        return;
      }

      const then = parseThen(criterion.then);
      if (!isSupported(then)) {
        refuse(
          'unsupported-condition',
          `its then clause could not be read: "${then.clause}" ${then.reason}`,
        );
        return;
      }

      if (!context.actorIds.has(when.actorId)) {
        refuse('actor-unavailable', `actor ${when.actorId} is not configured`);
        return;
      }

      const template = routeFor(when, observation, context);
      if (template === undefined) {
        refuse(
          'probe-incomplete',
          `no route is known for ${when.action} on ${when.entity ?? 'the target'}`,
        );
        return;
      }

      const instanceId = instanceFor(when, context);
      const needsInstance = template.includes('{id}') || template.includes(':id');

      if (needsInstance && instanceId === undefined) {
        refuse(
          'probe-incomplete',
          `${when.entity ?? 'the resource'} has no configured instance to act on`,
        );
        return;
      }

      const path = needsInstance ? resolvePath(template, instanceId ?? '') : template;
      const method = METHOD_FOR_WHEN[when.action];
      const handlerRef = handlerRefFor(when, observation);

      plans.push({
        identity: {
          type: 'behavioral',
          requirementId: requirement.id,
          ruleId: criterionId,
          actorId: when.actorId,
          action: `${method} ${path}`,
        },
        mutates: when.mutates,
        severityOnFail: BEHAVIORAL_SEVERITY,
        requirementId: requirement.id,
        criterionId,
        actorId: when.actorId,
        request: { method, path },
        assertions: then.assertions,
        mode: criterion.mode,
        then: criterion.then,
        ...(handlerRef === undefined ? {} : { locationRef: handlerRef }),
      });
    });
  }

  return { plans, unplannable };
}
