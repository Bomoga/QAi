import type {
  Observation,
  ObservationNote,
  ObservedEndpoint,
  ObservedEntity,
  ProbeMode,
} from '../contracts/index.ts';
import { identityKey, mergeObservedEndpoints, normalizeEndpoints } from './identity.ts';
import {
  CONFIDENCE_BLACKBOX_ONLY,
  CONFIDENCE_BOTH_AGREE,
  CONFIDENCE_DISAGREEMENT,
  CONFIDENCE_SOURCE_ONLY,
  type SourceScan,
} from './types.ts';

/**
 * Reconciling what the source declares against what the target served.
 *
 * The module is explicit that disagreement is information rather than an error to
 * resolve silently, so nothing here drops an endpoint one side saw. What changes is the
 * confidence and the note attached to it:
 *
 * | mode     | seen by      | origin   | confidence | note                          |
 * |----------|--------------|----------|------------|-------------------------------|
 * | source   | source       | source   | high       | none                          |
 * | blackbox | black box    | blackbox | low        | none                          |
 * | hybrid   | both         | source   | high       | none                          |
 * | hybrid   | source only  | source   | medium     | declared, the crawl missed it |
 * | hybrid   | black box only | blackbox | medium   | served, nothing declares it   |
 *
 * The two hybrid rows are the interesting ones. A route the source declares and the
 * crawl never reached may be unlinked, or may be behind a budget, or may not be wired
 * up at all, and the tool cannot tell which from outside. A route that answered a
 * request while no adapter declares it is the shape of an endpoint nobody asked for,
 * which is the finding this stage exists to make possible. Neither is downgraded to a
 * guess and neither is presented as certain.
 */

export const OBSERVATION_VERSION = '0.1';

export interface MergeInput {
  readonly source?: SourceScan;
  readonly blackbox?: SourceScan;
}

export interface MergeResult {
  readonly mode: ProbeMode;
  readonly endpoints: readonly ObservedEndpoint[];
  readonly entities: readonly ObservedEntity[];
  readonly notes: readonly ObservationNote[];
}

export function probeModeFor(input: MergeInput): ProbeMode {
  if (input.source !== undefined && input.blackbox !== undefined) return 'hybrid';
  if (input.source !== undefined) return 'source';
  return 'blackbox';
}

/**
 * Entities by name, case-insensitively, since one model reported twice is one entity.
 * Fields are unioned rather than replaced: two readings of a model that each saw part
 * of it describe more together than either does alone.
 */
function mergeEntities(
  source: readonly ObservedEntity[],
  blackbox: readonly ObservedEntity[],
): ObservedEntity[] {
  const byName = new Map<string, ObservedEntity>();

  for (const entity of [...source, ...blackbox]) {
    const key = entity.name.toLowerCase();
    const existing = byName.get(key);

    if (existing === undefined) {
      byName.set(key, entity);
      continue;
    }

    const names = new Set(existing.fields.map((field) => field.name));
    byName.set(key, {
      ...existing,
      fields: [...existing.fields, ...entity.fields.filter((field) => !names.has(field.name))],
      evidence: [...new Set([...existing.evidence, ...entity.evidence])],
    });
  }

  return [...byName.values()];
}

export function mergeScans(input: MergeInput): MergeResult {
  const mode = probeModeFor(input);
  const hybrid = mode === 'hybrid';

  const source = normalizeEndpoints(input.source?.endpoints ?? []);
  const blackbox = normalizeEndpoints(input.blackbox?.endpoints ?? []);

  const observed = new Map<string, ObservedEndpoint>();
  for (const endpoint of blackbox) {
    observed.set(identityKey(endpoint.method, endpoint.path), endpoint);
  }

  const endpoints: ObservedEndpoint[] = [];
  const notes: ObservationNote[] = [];
  const matched = new Set<string>();

  for (const endpoint of source) {
    const key = identityKey(endpoint.method, endpoint.path);
    const counterpart = observed.get(key);

    if (counterpart === undefined) {
      endpoints.push({
        ...endpoint,
        confidence: hybrid ? CONFIDENCE_DISAGREEMENT : CONFIDENCE_SOURCE_ONLY,
      });

      if (hybrid) {
        notes.push({
          level: 'info',
          message: `${endpoint.id} is declared in source, and the crawl did not reach it. It may be unlinked, or outside the crawl budget.`,
          refs: [],
        });
      }
      continue;
    }

    matched.add(key);
    // Source first: it read the declaration, so its path spelling and handler
    // reference win, while the crawl contributes evidence and observed fields.
    endpoints.push({
      ...mergeObservedEndpoints(endpoint, counterpart),
      origin: 'source',
      confidence: CONFIDENCE_BOTH_AGREE,
    });
  }

  for (const endpoint of blackbox) {
    const key = identityKey(endpoint.method, endpoint.path);
    if (matched.has(key)) continue;

    endpoints.push({
      ...endpoint,
      confidence: hybrid ? CONFIDENCE_DISAGREEMENT : CONFIDENCE_BLACKBOX_ONLY,
    });

    if (hybrid) {
      notes.push({
        level: 'warn',
        message: `${endpoint.id} answered a request, and no source adapter declares it.`,
        refs: [...endpoint.evidence],
      });
    }
  }

  return {
    mode,
    endpoints,
    entities: mergeEntities(input.source?.entities ?? [], input.blackbox?.entities ?? []),
    notes: [...(input.source?.notes ?? []), ...(input.blackbox?.notes ?? []), ...notes],
  };
}

export interface ObservationTarget {
  readonly baseUrl?: string;
  readonly sourceRoot?: string;
}

export function buildObservation(
  merged: MergeResult,
  target: ObservationTarget,
  observedAt: string,
): Observation {
  return {
    observationVersion: OBSERVATION_VERSION,
    observedAt,
    mode: merged.mode,
    target: {
      ...(target.baseUrl === undefined ? {} : { baseUrl: target.baseUrl }),
      ...(target.sourceRoot === undefined ? {} : { sourceRoot: target.sourceRoot }),
    },
    entities: [...merged.entities],
    endpoints: [...merged.endpoints],
    notes: [...merged.notes],
  };
}
