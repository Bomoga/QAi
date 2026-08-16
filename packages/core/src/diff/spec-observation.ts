import type {
  Confidence,
  Observation,
  ObservedEndpoint,
  Severity,
  Spec,
  StructuralFindings,
} from '../contracts/index.ts';
import { looksLikeAsset } from '../probe/crawl.ts';

/**
 * The structural diff: what was asked for, what is there, and where they disagree.
 *
 * This runs before any check and is the part of the output that describes an engineer's
 * own application back to them. It is also the easiest place in the tool to generate a
 * page of confident nonsense, so the rules below are deliberately narrow.
 *
 * Matching is one way only. The probe was never given the spec, and all the reconciling
 * happens here, where both sides are already fixed.
 *
 * Severity, from the module:
 *
 * - An observed endpoint nothing specifies is `medium` by default, `high` when it is
 *   known to be unauthenticated and returns fields belonging to a spec entity, and
 *   `info` for an obvious asset, health, or root route.
 * - A specified entity that was not observed is `low`, since a missing feature is
 *   usually known to the developer.
 * - An observed field the spec does not declare is `medium`, since undeclared fields in
 *   responses are how data leaks.
 *
 * The contract's `specifiedNotObserved` and `fieldMismatches` entries carry no severity
 * field, so those two are exported as constants for whoever turns an entry into a
 * finding. Adding the field to the entries would be a contract change.
 */

export const OBSERVED_NOT_SPECIFIED_SEVERITY: Severity = 'medium';
export const OBSERVED_NOT_SPECIFIED_UNAUTHENTICATED_SEVERITY: Severity = 'high';
export const OBSERVED_NOT_SPECIFIED_NOISE_SEVERITY: Severity = 'info';
export const SPECIFIED_NOT_OBSERVED_SEVERITY: Severity = 'low';
export const FIELD_MISMATCH_SEVERITY: Severity = 'medium';

/** Routes that exist in every application and answer to no requirement. */
const NOISE_PATHS = new Set([
  '/',
  '/health',
  '/healthz',
  '/healthcheck',
  '/status',
  '/ping',
  '/ready',
  '/live',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
]);

const NOISE_PREFIXES = ['/_next/', '/static/', '/assets/', '/.well-known/'];

/**
 * Field names almost every model carries. They are excluded when deciding whether a
 * response looks like an entity, because two records agreeing that they have an `id`
 * is not evidence that they are the same model.
 */
const UBIQUITOUS_FIELDS = new Set(['id', 'createdat', 'updatedat', 'deletedat']);

/** Lowercase and strip anything that is not a letter or a digit. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

/**
 * Enough plural handling for model names. Not a linguistics library.
 *
 * Words ending in `us`, `ss`, or `is` keep their last letter, so `status` does not
 * become `statu` and `address` does not become `addres`. Both sides of a comparison go
 * through this, so a wrong answer here costs a match rather than inventing one.
 */
export function singular(word: string): string {
  if (/(?:us|ss|is)$/u.test(word)) return word;
  if (word.length > 3 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && /(?:s|x|z|ch|sh)es$/u.test(word)) return word.slice(0, -2);
  if (word.length > 1 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/** Case-insensitive, separator-insensitive, and tolerant of singular against plural. */
export function namesMatch(left: string, right: string): boolean {
  return singular(normalizeName(left)) === singular(normalizeName(right));
}

export type EntityMatchVia = 'schema' | 'endpoint' | 'fields' | 'none';

export interface EntityMatch {
  readonly entity: string;
  readonly observed?: string;
  readonly via: EntityMatchVia;
  readonly confidence: Confidence;
}

/** Path segments that name something, so parameters and empties are left out. */
function nameableSegments(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '' && !segment.startsWith(':'));
}

/**
 * How an entity was recognized in the Observation, and how sure that is.
 *
 * A schema reading is the strong case: an adapter read the model. An endpoint named
 * after the entity is weaker, since a route called `/api/invoices` is evidence that
 * invoices exist rather than proof of the model behind them. Fields alone are weaker
 * still, and only count when several of them line up.
 */
export function matchEntities(spec: Spec, observation: Observation): EntityMatch[] {
  return spec.entities.map((entity) => {
    const observedEntity = observation.entities.find((candidate) =>
      namesMatch(candidate.name, entity.name),
    );

    if (observedEntity !== undefined) {
      const exact = observedEntity.name.toLowerCase() === entity.name.toLowerCase();
      return {
        entity: entity.name,
        observed: observedEntity.name,
        via: 'schema',
        confidence: exact ? 'high' : 'medium',
      };
    }

    const endpoint = observation.endpoints.find((candidate) =>
      nameableSegments(candidate.path).some((segment) => namesMatch(segment, entity.name)),
    );

    if (endpoint !== undefined) {
      return { entity: entity.name, observed: endpoint.id, via: 'endpoint', confidence: 'medium' };
    }

    const distinctive = new Set(
      entity.fields
        .map((field) => normalizeName(field.name))
        .filter((field) => !UBIQUITOUS_FIELDS.has(field)),
    );

    const byFields =
      distinctive.size === 0
        ? undefined
        : observation.endpoints.find((candidate) => {
            const overlap = (candidate.responseShape?.fields ?? []).filter((field) =>
              distinctive.has(normalizeName(field)),
            );
            return overlap.length >= Math.min(2, distinctive.size);
          });

    if (byFields !== undefined) {
      return { entity: entity.name, observed: byFields.id, via: 'fields', confidence: 'low' };
    }

    return { entity: entity.name, via: 'none', confidence: 'low' };
  });
}

function requirementsNaming(spec: Spec, entity: string): string[] {
  return spec.requirements
    .filter(
      (requirement) =>
        requirement.entities.some((name) => namesMatch(name, entity)) ||
        requirement.fields.some((field) => namesMatch(field.split('.')[0] ?? '', entity)) ||
        requirement.accessRules.some((rule) => namesMatch(rule.resource, entity)),
    )
    .map((requirement) => requirement.id);
}

function isNoiseRoute(path: string): boolean {
  if (NOISE_PATHS.has(path.toLowerCase())) return true;
  if (NOISE_PREFIXES.some((prefix) => path.toLowerCase().startsWith(prefix))) return true;
  return looksLikeAsset(path);
}

/**
 * Severity for an endpoint no requirement accounts for.
 *
 * The unauthenticated case is checked before the noise case on purpose. A health route
 * that answers without credentials and hands back fields from a spec entity is not
 * noise, whatever it is called.
 */
export function severityForUndeclared(endpoint: ObservedEndpoint, spec: Spec): Severity {
  const declared = new Set(
    spec.entities.flatMap((entity) => entity.fields.map((field) => normalizeName(field.name))),
  );

  const returnsEntityFields = (endpoint.responseShape?.fields ?? []).some((field) =>
    declared.has(normalizeName(field)),
  );

  if (endpoint.authRequired === false && returnsEntityFields) {
    return OBSERVED_NOT_SPECIFIED_UNAUTHENTICATED_SEVERITY;
  }

  if (isNoiseRoute(endpoint.path)) return OBSERVED_NOT_SPECIFIED_NOISE_SEVERITY;

  return OBSERVED_NOT_SPECIFIED_SEVERITY;
}

/** Field names observed for an entity, gathered from every endpoint that names it. */
function observedFieldsFor(entity: string, observation: Observation): Set<string> {
  const fields = new Set<string>();

  const observedEntity = observation.entities.find((candidate) =>
    namesMatch(candidate.name, entity),
  );
  for (const field of observedEntity?.fields ?? []) fields.add(field.name);

  for (const endpoint of observation.endpoints) {
    const namesEntity =
      nameableSegments(endpoint.path).some((segment) => namesMatch(segment, entity)) ||
      (endpoint.responseShape?.entity !== undefined &&
        namesMatch(endpoint.responseShape.entity, entity));

    if (!namesEntity) continue;
    for (const field of endpoint.responseShape?.fields ?? []) fields.add(field);
  }

  return fields;
}

/**
 * Diffs a spec against an Observation.
 *
 * An Observation that saw nothing at all produces no `specifiedNotObserved` entries. A
 * probe that failed to reach the target and a target that implements none of the spec
 * are not the same fact, and reporting the first as the second would fill a report with
 * findings about a run that never happened. The RunResult says that separately, through
 * the `probe-incomplete` reason.
 */
export function diffSpecObservation(spec: Spec, observation: Observation): StructuralFindings {
  const sawNothing = observation.endpoints.length === 0 && observation.entities.length === 0;

  const specifiedNotObserved = sawNothing
    ? []
    : matchEntities(spec, observation)
        .filter((match) => match.via === 'none')
        .map((match) => ({
          kind: 'entity' as const,
          name: match.entity,
          requirementIds: requirementsNaming(spec, match.entity),
        }));

  const accountedFor = new Set(
    spec.entities
      .filter((entity) => requirementsNaming(spec, entity.name).length > 0)
      .map((entity) => entity.name),
  );

  const observedNotSpecified = observation.endpoints
    .filter(
      (endpoint) =>
        !nameableSegments(endpoint.path).some((segment) =>
          [...accountedFor].some((entity) => namesMatch(segment, entity)),
        ),
    )
    .map((endpoint) => ({
      kind: 'endpoint' as const,
      id: endpoint.id,
      severity: severityForUndeclared(endpoint, spec),
    }));

  const fieldMismatches = spec.entities.flatMap((entity) => {
    const observed = observedFieldsFor(entity.name, observation);
    if (observed.size === 0) return [];

    const declared = new Set(entity.fields.map((field) => normalizeName(field.name)));
    const seen = new Set([...observed].map((field) => normalizeName(field)));

    const missing = entity.fields
      .filter((field) => !seen.has(normalizeName(field.name)))
      .map((field) => field.name);
    const extra = [...observed].filter((field) => !declared.has(normalizeName(field)));

    if (missing.length === 0 && extra.length === 0) return [];

    return [
      {
        entity: entity.name,
        specifiedNotObserved: missing,
        observedNotSpecified: extra,
      },
    ];
  });

  return { specifiedNotObserved, observedNotSpecified, fieldMismatches };
}
