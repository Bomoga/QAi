import type { Observation, Spec, UnverifiedReason } from '../../contracts/index.ts';
import { resolvePath, type PlanningContext } from '../access/plan.ts';
import { isSupported, parseThen, type Assertion } from './assertions.ts';
import {
  BEHAVIORAL_SEVERITY,
  type BehavioralPlan,
  type RecordRead,
  type ReferenceRequest,
  type StateRead,
} from './types.ts';
import {
  isRequest,
  METHOD_FOR_WHEN,
  parseWhen,
  type WhenAction,
  type WhenRequest,
} from './when.ts';

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

/** Resolution order, matching access rules: an observed endpoint, then config, then nothing. */
function routeTemplateFor(
  entity: string,
  action: Exclude<WhenAction, 'path'>,
  observation: Observation | null,
  context: PlanningContext,
): string | undefined {
  const method = METHOD_FOR_WHEN[action];
  const collection = action === 'list' || action === 'create';

  const observed = observation?.endpoints.find(
    (endpoint) =>
      endpoint.responseShape?.entity?.toLowerCase() === entity.toLowerCase() &&
      endpoint.method.toUpperCase() === method &&
      (collection ? !endpoint.path.includes(':') : endpoint.path.includes(':')),
  );

  const configured = context.resources.find(
    (entry) => entry.name.toLowerCase() === entity.toLowerCase(),
  )?.routes[action];

  return observed?.path ?? configured;
}

function routeFor(
  request: WhenRequest,
  observation: Observation | null,
  context: PlanningContext,
): string | undefined {
  if (request.action === 'path') return request.path;
  if (request.entity === undefined) return undefined;

  return routeTemplateFor(request.entity, request.action, observation, context);
}

/**
 * Where each counted entity's records can be read after the action.
 *
 * An entity with no list route contributes nothing, and the runner reports the count as
 * unevaluable rather than the criterion as unplannable. The clause is expressible; it is
 * the target that offers nowhere to look, and that is a capability gap rather than an
 * authoring mistake.
 */
function stateReadsFor(
  assertions: readonly Assertion[],
  observation: Observation | null,
  context: PlanningContext,
): StateRead[] {
  const reads: StateRead[] = [];

  for (const assertion of assertions) {
    if (assertion.kind !== 'record-count') continue;
    if (reads.some((read) => read.entity.toLowerCase() === assertion.entity.toLowerCase())) {
      continue;
    }

    const path = routeTemplateFor(assertion.entity, 'list', observation, context);
    if (path !== undefined) reads.push({ entity: assertion.entity, path });
  }

  return reads;
}

/**
 * Where each record an `is unchanged` assertion names can be read.
 *
 * The instance is taken from the assertion when it names one, and otherwise from the
 * record the `when` clause acts on, which is what "the invoice is unchanged" means in a
 * criterion about updating one invoice. An entity with no read route or no instance
 * contributes nothing, and the runner reports the assertion unevaluable rather than the
 * criterion unplannable: the clause is expressible and it is the target that offers
 * nowhere to look.
 */
function recordReadsFor(
  assertions: readonly Assertion[],
  request: WhenRequest,
  fallbackInstanceId: string | undefined,
  observation: Observation | null,
  context: PlanningContext,
): RecordRead[] {
  const reads: RecordRead[] = [];

  for (const assertion of assertions) {
    if (assertion.kind !== 'record-unchanged') continue;

    const instanceId =
      assertion.instanceId ??
      (assertion.entity.toLowerCase() === request.entity?.toLowerCase()
        ? fallbackInstanceId
        : undefined);
    if (instanceId === undefined) continue;

    const key = `${assertion.entity.toLowerCase()} ${instanceId}`;
    if (reads.some((read) => `${read.entity.toLowerCase()} ${read.instanceId}` === key)) continue;

    const template = routeTemplateFor(assertion.entity, 'read', observation, context);
    if (template === undefined) continue;

    reads.push({
      entity: assertion.entity,
      instanceId,
      path: resolvePath(template, instanceId),
    });
  }

  return reads;
}

/**
 * Resolves each `status matches` reference into a request that can be issued.
 *
 * A reference resolves exactly as an action does, through the same route table and the
 * same instance rules, because it is written in the same vocabulary. One that resolves to
 * nothing is left out and the runner reports the assertion unevaluable, naming the phrase
 * the author wrote.
 */
function referenceRequestsFor(
  assertions: readonly Assertion[],
  observation: Observation | null,
  context: PlanningContext,
): ReferenceRequest[] {
  const references: ReferenceRequest[] = [];

  for (const assertion of assertions) {
    if (assertion.kind !== 'status-matches') continue;
    if (references.some((entry) => entry.phrase === assertion.phrase)) continue;

    const reference = assertion.reference;
    const template = routeFor(reference, observation, context);
    if (template === undefined) continue;

    const instanceId = instanceFor(reference, context);
    const needsInstance = template.includes('{id}') || template.includes(':id');
    if (needsInstance && instanceId === undefined) continue;

    references.push({
      phrase: assertion.phrase,
      actorId: reference.actorId,
      request: {
        method: METHOD_FOR_WHEN[reference.action],
        path: needsInstance ? resolvePath(template, instanceId ?? '') : template,
      },
    });
  }

  return references;
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

      const when = parseWhen(criterion.when);
      if (!isRequest(when)) {
        refuse('unsupported-condition', `its when clause could not be read: ${when.reason}`);
        return;
      }

      // A fuzzy criterion still needs a page to open, so its `when` goes through the
      // request vocabulary like any other. Its `then` does not: the assertion table is
      // not the contract for a clause a model reads, and parsing it would refuse the
      // criterion for being exactly what it declares itself to be. It plans with no
      // assertions, which is also what makes the deterministic runner decline it if one
      // is ever handed there by mistake.
      let assertions: readonly Assertion[] = [];

      if (criterion.mode === 'deterministic') {
        const then = parseThen(criterion.then);
        if (!isSupported(then)) {
          refuse(
            'unsupported-condition',
            `its then clause could not be read: "${then.clause}" ${then.reason}`,
          );
          return;
        }
        assertions = then.assertions;
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
      const stateReads = stateReadsFor(assertions, observation, context);
      const recordReads = recordReadsFor(assertions, when, instanceId, observation, context);
      const referenceRequests = referenceRequestsFor(assertions, observation, context);

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
        assertions,
        mode: criterion.mode,
        given: criterion.given,
        when: criterion.when,
        then: criterion.then,
        ...(handlerRef === undefined ? {} : { locationRef: handlerRef }),
        ...(stateReads.length === 0 ? {} : { stateReads }),
        ...(recordReads.length === 0 ? {} : { recordReads }),
        ...(referenceRequests.length === 0 ? {} : { referenceRequests }),
      });
    });
  }

  return { plans, unplannable };
}
