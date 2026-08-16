import { createHash } from 'node:crypto';

import type { Spec } from '../contracts/index.ts';

/**
 * Canonicalization and hashing.
 *
 * The hash answers one question for M6: are these two runs comparable, or did the spec
 * change underneath them? So it has to be stable across everything that does not change
 * meaning, and move for everything that does.
 *
 * Excluded from the hash, deliberately:
 *
 *   Derived identifiers. `AR-014-01` is a function of the requirement and the ordinal,
 *   so including it would add nothing, but it would also let a hand-written id that
 *   merely restates the derived one shift the hash. Hand-written ids are excluded on
 *   the same grounds: naming a rule is not changing what it asserts.
 *
 *   Formatting. YAML comments, key order, indentation, and surrounding whitespace in
 *   free text never reach this function's output.
 *
 *   Declaration order of actors and entities, which are sets keyed by name. Requirement
 *   order is also normalized, since a requirement means the same thing wherever it sits
 *   in the file, and the loader already merges across files where order is arbitrary.
 */

/** Collapses runs of whitespace and trims, so a rewrapped statement hashes the same. */
function normalizeText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

type Canonical = string | number | boolean | null | Canonical[] | { [key: string]: Canonical };

function canonicalizeSpec(spec: Spec): Canonical {
  const actors = [...spec.actors]
    .map((actor) => ({
      id: actor.id,
      description: normalizeText(actor.description ?? ''),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  const entities = [...spec.entities]
    .map((entity) => ({
      name: entity.name,
      ownedBy: entity.ownedBy ?? '',
      fields: [...entity.fields]
        .map((field) => ({
          name: field.name,
          type: field.type,
          sensitive: field.sensitive ?? false,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const requirements = [...spec.requirements]
    .map((requirement) => ({
      id: requirement.id,
      statement: normalizeText(requirement.statement),
      entities: [...requirement.entities].sort(),
      fields: [...requirement.fields].sort(),
      tags: [...requirement.tags].sort(),
      /**
       * Rule order is kept. Ordinal position determines a derived identifier, so
       * reordering two rules renames them, and a renamed check is a different check
       * to M6 even though the assertions are unchanged.
       */
      accessRules: requirement.accessRules.map((rule) => ({
        actor: rule.actor,
        action: rule.action,
        resource: rule.resource,
        condition: normalizeText(rule.condition ?? ''),
        effect: rule.effect,
      })),
      acceptanceCriteria: requirement.acceptanceCriteria.map((criterion) => ({
        mode: criterion.mode,
        given: normalizeText(criterion.given),
        when: normalizeText(criterion.when),
        then: normalizeText(criterion.then),
      })),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    specVersion: spec.specVersion,
    name: normalizeText(spec.name),
    actors,
    entities,
    requirements,
  };
}

/**
 * Serializes with sorted keys at every level, so the JSON encoder's insertion order
 * cannot leak into the digest.
 */
function stableStringify(value: Canonical): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const keys = Object.keys(value).sort();
  const body = keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key] ?? null)}`)
    .join(',');
  return `{${body}}`;
}

/** The canonical form, exposed so a test can show what a hash difference came from. */
export function canonicalizeSpecToString(spec: Spec): string {
  return stableStringify(canonicalizeSpec(spec));
}

/** `sha256:` prefixed, matching `spec.hash` in the RunResult contract. */
export function hashSpec(spec: Spec): string {
  const digest = createHash('sha256').update(canonicalizeSpecToString(spec), 'utf8').digest('hex');
  return `sha256:${digest}`;
}
