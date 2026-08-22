import type {
  AccessAction,
  AccessRule,
  Observation,
  Spec,
  UnverifiedReason,
} from '../../contracts/index.ts';
import { pathIdentity, templateIdentity } from '../../probe/identity.ts';
import type { ConditionAst } from '../../spec/condition.ts';
import type { ResourceInstance } from '../../target/config.ts';
import type { HttpMethod } from '../../target/request.ts';
import type { CheckIdentity, CheckPlan } from '../types.ts';

/**
 * Rule to plan expansion.
 *
 * A rule names an actor and a resource. A plan names a request. Everything uncertain
 * is resolved here, before anything is sent, so that a check either has a concrete
 * action to perform or a stated reason why it does not. There is no third state where
 * a check runs against a guess.
 *
 * A rule that cannot be planned is not dropped. It comes back in `unplannable` with a
 * reason from the closed set in 03-CONTRACTS.md, which is what keeps a coverage gap
 * visible instead of turning it into a quiet green.
 */

/** Read and list are safe. The rest mutate and run behind the disposability gate. */
const METHOD_FOR_ACTION: Record<AccessAction, HttpMethod> = {
  read: 'GET',
  list: 'GET',
  create: 'POST',
  update: 'PATCH',
  delete: 'DELETE',
};

const MUTATING_ACTIONS: ReadonlySet<AccessAction> = new Set(['create', 'update', 'delete']);

export interface AccessCheckPlan extends CheckPlan {
  readonly rule: AccessRule;
  readonly ruleId: string;
  readonly requirementId: string;
  readonly actorId: string;
  readonly resource: string;
  readonly action: AccessAction;
  readonly method: HttpMethod;
  /** May contain `{id}`, substituted with the instance the check acts on. */
  readonly pathTemplate: string;
  readonly condition?: ConditionAst;
  /** Records the check may act on. Narrowed to a foreign one by M3.3 at run time. */
  readonly candidates: readonly ResourceInstance[];
  /**
   * Field names the spec declares for this resource. A verdict asks whether any of
   * them came back, so they are resolved once here rather than per response.
   */
  readonly resourceFields: readonly string[];
  /** `app/api/invoices/[id]/route.ts:12` when a probe supplied one. */
  readonly locationRef?: string;
}

export interface UnplannableRule {
  readonly requirementId: string;
  readonly ruleId: string;
  readonly reason: UnverifiedReason;
  /** Written for someone who has to change something for the check to run. */
  readonly detail: string;
}

export interface AccessPlanResult {
  readonly plans: readonly AccessCheckPlan[];
  readonly unplannable: readonly UnplannableRule[];
}

/** Just enough of the target context to plan. Keeps planning testable without a target. */
export interface PlanningContext {
  readonly actorIds: ReadonlySet<string>;
  readonly resources: readonly {
    readonly name: string;
    readonly routes: Readonly<Partial<Record<AccessAction, string>>>;
    readonly instances: readonly ResourceInstance[];
  }[];
}

function identityFor(rule: AccessRule, requirementId: string): CheckIdentity {
  return {
    type: 'access',
    requirementId,
    ...(rule.id === undefined ? {} : { ruleId: rule.id }),
    actorId: rule.actor,
    resource: rule.resource,
    // The rule's own action, not the route it resolves to today.
    action: rule.action,
  };
}

/**
 * Resolution order from modules/M3-access-checks.md: an Observation endpoint whose
 * `responseShape.entity` matches, then a configured route, then nothing. Never a URL
 * guessed by pluralizing an entity name.
 *
 * **Nothing in the probe writes `responseShape.entity` today**, so the first branch is
 * reachable only from an Observation a caller built by hand. It is the right precedence
 * if an adapter ever names the entity an endpoint serves, and it is not where a real run
 * gets its handler reference. `handlerRefFor` below is.
 */
function resolveRoute(
  resource: string,
  action: AccessAction,
  observation: Observation | null,
  context: PlanningContext,
): { method: HttpMethod; path: string; handlerRef?: string } | undefined {
  const method = METHOD_FOR_ACTION[action];

  const observed = observation?.endpoints.find(
    (endpoint) =>
      endpoint.responseShape?.entity?.toLowerCase() === resource.toLowerCase() &&
      endpoint.method.toUpperCase() === method &&
      // A list acts on a collection, everything else on an instance.
      (action === 'list' || action === 'create'
        ? !endpoint.path.includes(':')
        : endpoint.path.includes(':')),
  );
  if (observed !== undefined) {
    // The handler reference is what lets a finding cite a file rather than a request.
    return {
      method,
      path: observed.path,
      ...(observed.handlerRef === undefined ? {} : { handlerRef: observed.handlerRef }),
    };
  }

  const configured = context.resources.find(
    (entry) => entry.name.toLowerCase() === resource.toLowerCase(),
  )?.routes[action];
  if (configured !== undefined) {
    const handlerRef = handlerRefFor(method, configured, observation);
    return { method, path: configured, ...(handlerRef === undefined ? {} : { handlerRef }) };
  }

  return undefined;
}

/**
 * The file serving a configured route, when a source adapter read one.
 *
 * The config says where a resource lives and the Observation says which file serves that
 * URL, so joining the two names the code without the probe ever being told what the spec
 * asked for. M4 is deliberate that an Observation shaped by the spec cannot support a
 * finding that the two disagree, and this leaves the probe exactly as spec-blind as it
 * was.
 *
 * Both sides go through the erasure in `probe/identity.ts`, so a configured
 * `/api/invoices/{id}` and an observed `/api/invoices/:id` are one route. A route the
 * Observation does not hold, or holds only from a crawl, leaves the finding with its
 * request reference, which is what `04-CONVENTIONS.md` asks for when there is no source.
 */
function handlerRefFor(
  method: HttpMethod,
  template: string,
  observation: Observation | null,
): string | undefined {
  const wanted = templateIdentity(template);

  return observation?.endpoints.find(
    (endpoint) =>
      endpoint.handlerRef !== undefined &&
      endpoint.method.toUpperCase() === method &&
      pathIdentity(endpoint.path) === wanted,
  )?.handlerRef;
}

function instancesFor(resource: string, context: PlanningContext): readonly ResourceInstance[] {
  return (
    context.resources.find((entry) => entry.name.toLowerCase() === resource.toLowerCase())
      ?.instances ?? []
  );
}

export function planAccessChecks(
  spec: Spec,
  conditions: ReadonlyMap<string, ConditionAst>,
  observation: Observation | null,
  context: PlanningContext,
): AccessPlanResult {
  const plans: AccessCheckPlan[] = [];
  const unplannable: UnplannableRule[] = [];

  for (const requirement of spec.requirements) {
    for (const rule of requirement.accessRules) {
      const ruleId = rule.id ?? `${requirement.id}-unnamed`;

      if (!context.actorIds.has(rule.actor)) {
        unplannable.push({
          requirementId: requirement.id,
          ruleId,
          reason: 'actor-unavailable',
          detail: `The rule acts as "${rule.actor}", which no configured actor resolved to. Configure that actor and its credential variable, or the rule cannot be attempted.`,
        });
        continue;
      }

      const route = resolveRoute(rule.resource, rule.action, observation, context);
      if (route === undefined) {
        unplannable.push({
          requirementId: requirement.id,
          ruleId,
          reason: 'unsupported-condition',
          detail: `No route is known for ${rule.action} on "${rule.resource}". Configure resources[].routes.${rule.action} for it, or run a probe first. A URL is never guessed from the entity name.`,
        });
        continue;
      }

      const candidates = instancesFor(rule.resource, context);
      const condition = rule.id === undefined ? undefined : conditions.get(rule.id);
      const resourceFields =
        spec.entities
          .find((entity) => entity.name.toLowerCase() === rule.resource.toLowerCase())
          ?.fields.map((field) => field.name) ?? [];

      plans.push({
        identity: identityFor(rule, requirement.id),
        mutates: MUTATING_ACTIONS.has(rule.action),
        /**
         * Deny rules are the higher severity class: a deny that fails means something
         * reachable that was stated as forbidden. An allow that fails means a feature
         * is broken, which matters less to this tool's audience. M3.8 refines this.
         */
        severityOnFail: rule.effect === 'deny' ? 'high' : 'medium',
        rule,
        ruleId,
        requirementId: requirement.id,
        actorId: rule.actor,
        resource: rule.resource,
        action: rule.action,
        method: route.method,
        pathTemplate: route.path,
        ...(condition === undefined ? {} : { condition }),
        candidates,
        resourceFields,
        ...(route.handlerRef === undefined ? {} : { locationRef: route.handlerRef }),
      });
    }
  }

  return { plans, unplannable };
}

/** Substitutes `{id}` and `:id` in a route template. */
export function resolvePath(template: string, instanceId: string): string {
  return template.replace(/\{id\}/gu, instanceId).replace(/:id\b/gu, instanceId);
}
