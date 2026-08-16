import { readFileSync } from 'node:fs';

import fastGlob from 'fast-glob';
import { parse as parseYaml } from 'yaml';

import {
  SpecSchema,
  type AccessRule,
  type AcceptanceCriterion,
  type Actor,
  type Entity,
  type Requirement,
  type Spec,
} from '../contracts/index.ts';
import { isConditionParseError, parseCondition, type ConditionAst } from './condition.ts';
import { error, hasErrors, warning, type LoadDiagnostic, type SpecError } from './diagnostics.ts';
import { hashSpec } from './hash.ts';

/**
 * Spec loading, merging, identifier derivation, and diagnostics.
 *
 * The Spec this returns matches 03-CONTRACTS.md exactly. Parsed conditions travel
 * beside it in `conditions` rather than on the rule, because adding an AST field to
 * the Spec contract would be a contract change, and the contract is the thing every
 * other module is typed by. M3 looks a rule's AST up by its now-assigned id.
 */

export interface LoadOptions {
  /** Base directory for relative paths and glob expansion. */
  readonly cwd?: string;
}

export interface LoadedSpec {
  readonly spec: Spec;
  /** sha256 over the canonicalized spec. M6 uses it to tell whether two runs compare. */
  readonly hash: string;
  readonly diagnostics: readonly LoadDiagnostic[];
  /** Parsed conditions, keyed by access rule id. Populated for every rule that has one. */
  readonly conditions: ReadonlyMap<string, ConditionAst>;
}

export interface LoadFailure {
  readonly error: SpecError;
}

export type LoadSpecResult = LoadedSpec | LoadFailure;

export function isLoadFailure(result: LoadSpecResult): result is LoadFailure {
  return 'error' in result;
}

interface ParsedFile {
  readonly file: string;
  readonly spec: Spec;
}

function formatPath(segments: readonly (string | number | symbol)[]): string {
  return segments.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    if (acc === '') return String(segment);
    return `${acc}.${String(segment)}`;
  }, '');
}

/**
 * Sorted so that merge order, derived identifiers, and diagnostic order are the same
 * on every machine. Rule R6: nothing about a load may depend on filesystem ordering.
 */
function resolveFiles(paths: readonly string[], cwd: string): string[] {
  const matches = fastGlob.sync([...paths], {
    cwd,
    absolute: false,
    onlyFiles: true,
    dot: false,
  });
  return [...new Set(matches)].sort();
}

function readAndValidate(
  file: string,
  cwd: string,
  diagnostics: LoadDiagnostic[],
): Spec | undefined {
  let text: string;
  try {
    text = readFileSync(`${cwd}/${file}`, 'utf8');
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'unreadable';
    diagnostics.push(error(file, '', `could not read the file: ${reason}`));
    return undefined;
  }

  let document: unknown;
  try {
    document = parseYaml(text);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'invalid YAML';
    diagnostics.push(error(file, '', `could not parse YAML: ${reason}`));
    return undefined;
  }

  if (document === null || document === undefined) {
    diagnostics.push(error(file, '', 'the file is empty'));
    return undefined;
  }

  const parsed = SpecSchema.safeParse(document);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      diagnostics.push(error(file, formatPath(issue.path), issue.message));
    }
    return undefined;
  }

  return parsed.data;
}

/** `REQ-014` and ordinal 1 give `AR-014-01`. A hand-written id is never renumbered. */
function deriveId(prefix: 'AR' | 'AC', requirementId: string, ordinal: number): string {
  const stem = requirementId.startsWith('REQ-') ? requirementId.slice(4) : requirementId;
  return `${prefix}-${stem}-${String(ordinal).padStart(2, '0')}`;
}

function mergeActors(files: readonly ParsedFile[], diagnostics: LoadDiagnostic[]): Actor[] {
  const merged = new Map<string, { actor: Actor; file: string }>();

  for (const { file, spec } of files) {
    spec.actors.forEach((actor, index) => {
      const existing = merged.get(actor.id);
      if (existing === undefined) {
        merged.set(actor.id, { actor, file });
        return;
      }
      if (existing.actor.description !== actor.description) {
        diagnostics.push(
          error(
            file,
            `actors[${index}]`,
            `actor "${actor.id}" is defined differently in ${existing.file} and ${file}`,
          ),
        );
      }
    });
  }

  return [...merged.values()].map((entry) => entry.actor);
}

/**
 * Fields are compared by name, not by position. Declaration order carries no meaning
 * for an entity: nothing derives an identifier from it, and `hash.ts` already sorts
 * fields before hashing. Comparing positionally made two files that agree about an
 * entity, and hash identically, fail to load as a conflicting redefinition.
 */
function sameEntity(left: Entity, right: Entity): boolean {
  if (left.ownedBy !== right.ownedBy) return false;
  if (left.fields.length !== right.fields.length) return false;

  const byName = new Map(right.fields.map((field) => [field.name, field]));

  return left.fields.every((field) => {
    const other = byName.get(field.name);
    return other !== undefined && field.type === other.type && field.sensitive === other.sensitive;
  });
}

function mergeEntities(files: readonly ParsedFile[], diagnostics: LoadDiagnostic[]): Entity[] {
  const merged = new Map<string, { entity: Entity; file: string }>();

  for (const { file, spec } of files) {
    spec.entities.forEach((entity, index) => {
      const existing = merged.get(entity.name);
      if (existing === undefined) {
        merged.set(entity.name, { entity, file });
        return;
      }
      if (!sameEntity(existing.entity, entity)) {
        diagnostics.push(
          error(
            file,
            `entities[${index}]`,
            `entity "${entity.name}" is defined differently in ${existing.file} and ${file}`,
          ),
        );
      }
    });
  }

  return [...merged.values()].map((entry) => entry.entity);
}

function mergeRequirements(
  files: readonly ParsedFile[],
  diagnostics: LoadDiagnostic[],
): { requirement: Requirement; file: string }[] {
  const merged = new Map<string, { requirement: Requirement; file: string }>();

  for (const { file, spec } of files) {
    spec.requirements.forEach((requirement, index) => {
      const existing = merged.get(requirement.id);
      if (existing !== undefined) {
        diagnostics.push(
          error(
            file,
            `requirements[${index}]`,
            `requirement id "${requirement.id}" is defined in both ${existing.file} and ${file}`,
          ),
        );
        return;
      }
      merged.set(requirement.id, { requirement, file });
    });
  }

  return [...merged.values()];
}

/** Assigns absent rule and criterion ids, and rejects a collision rather than resolving one. */
function assignIdentifiers(
  entries: readonly { requirement: Requirement; file: string }[],
  diagnostics: LoadDiagnostic[],
): Requirement[] {
  const seen = new Map<string, string>();

  const claim = (id: string, file: string, path: string): void => {
    const owner = seen.get(id);
    if (owner !== undefined) {
      diagnostics.push(
        error(file, path, `identifier "${id}" is used more than once, also in ${owner}`),
      );
      return;
    }
    seen.set(id, file);
  };

  return entries.map(({ requirement, file }) => {
    claim(requirement.id, file, 'requirements');

    const accessRules: AccessRule[] = requirement.accessRules.map((rule, index) => {
      const id = rule.id ?? deriveId('AR', requirement.id, index + 1);
      claim(id, file, `requirements.${requirement.id}.accessRules[${index}]`);
      return { ...rule, id };
    });

    const acceptanceCriteria: AcceptanceCriterion[] = requirement.acceptanceCriteria.map(
      (criterion, index) => {
        const id = criterion.id ?? deriveId('AC', requirement.id, index + 1);
        claim(id, file, `requirements.${requirement.id}.acceptanceCriteria[${index}]`);
        return { ...criterion, id };
      },
    );

    return { ...requirement, accessRules, acceptanceCriteria };
  });
}

function parseConditions(
  requirements: readonly Requirement[],
  fileOf: ReadonlyMap<string, string>,
  diagnostics: LoadDiagnostic[],
): Map<string, ConditionAst> {
  const conditions = new Map<string, ConditionAst>();

  for (const requirement of requirements) {
    const file = fileOf.get(requirement.id) ?? '';

    requirement.accessRules.forEach((rule, index) => {
      if (rule.condition === undefined) return;

      const parsed = parseCondition(rule.condition);
      const path = `requirements.${requirement.id}.accessRules[${index}].condition`;

      if (isConditionParseError(parsed)) {
        diagnostics.push(
          error(file, path, `${requirement.id}: ${parsed.message}, at "${parsed.offendingText}"`),
        );
        return;
      }

      if (rule.id !== undefined) conditions.set(rule.id, parsed);
    });
  }

  return conditions;
}

/**
 * Coverage facts, not authoring mistakes. They are warnings so the spec still loads,
 * and they are emitted at all so a gap is visible rather than silently absent.
 */
function collectWarnings(
  spec: Spec,
  fileOf: ReadonlyMap<string, string>,
  primaryFile: string,
  diagnostics: LoadDiagnostic[],
): void {
  const referencedActors = new Set(
    spec.requirements.flatMap((requirement) => requirement.accessRules.map((rule) => rule.actor)),
  );

  for (const actor of spec.actors) {
    if (!referencedActors.has(actor.id)) {
      diagnostics.push(
        warning(primaryFile, 'actors', `actor "${actor.id}" is referenced by no access rule`),
      );
    }
  }

  const referencedEntities = new Set([
    ...spec.requirements.flatMap((requirement) => requirement.entities),
    ...spec.requirements.flatMap((requirement) =>
      requirement.accessRules.map((rule) => rule.resource),
    ),
  ]);

  for (const entity of spec.entities) {
    if (!referencedEntities.has(entity.name)) {
      diagnostics.push(
        warning(primaryFile, 'entities', `entity "${entity.name}" is referenced by no requirement`),
      );
    }
  }

  for (const requirement of spec.requirements) {
    if (requirement.accessRules.length === 0 && requirement.acceptanceCriteria.length === 0) {
      diagnostics.push(
        warning(
          fileOf.get(requirement.id) ?? primaryFile,
          `requirements.${requirement.id}`,
          `requirement "${requirement.id}" defines no checks and will be reported as unverified with reason no-checks-defined`,
        ),
      );
    }
  }
}

export function loadSpec(paths: readonly string[], options: LoadOptions = {}): LoadSpecResult {
  const cwd = options.cwd ?? process.cwd();
  const diagnostics: LoadDiagnostic[] = [];

  if (paths.length === 0) {
    return {
      error: {
        kind: 'error',
        message: 'no spec paths were given',
        diagnostics: [],
      },
    };
  }

  const files = resolveFiles(paths, cwd);
  if (files.length === 0) {
    return {
      error: {
        kind: 'error',
        message: `no spec files matched ${paths.join(', ')}`,
        diagnostics: [],
      },
    };
  }

  const parsed: ParsedFile[] = [];
  for (const file of files) {
    const spec = readAndValidate(file, cwd, diagnostics);
    if (spec !== undefined) parsed.push({ file, spec });
  }

  if (parsed.length === 0) {
    return {
      error: {
        kind: 'error',
        message: 'no spec file could be loaded',
        diagnostics,
      },
    };
  }

  const first = parsed[0];
  if (first === undefined) {
    return { error: { kind: 'error', message: 'no spec file could be loaded', diagnostics } };
  }

  for (const { file, spec } of parsed.slice(1)) {
    if (spec.specVersion !== first.spec.specVersion) {
      diagnostics.push(
        error(
          file,
          'specVersion',
          `specVersion "${spec.specVersion}" does not match "${first.spec.specVersion}" in ${first.file}`,
        ),
      );
    }
    if (spec.name !== first.spec.name) {
      diagnostics.push(
        warning(
          file,
          'name',
          `name "${spec.name}" differs from "${first.spec.name}" in ${first.file}, the first is used`,
        ),
      );
    }
  }

  const actors = mergeActors(parsed, diagnostics);
  const entities = mergeEntities(parsed, diagnostics);
  const requirementEntries = mergeRequirements(parsed, diagnostics);
  const requirements = assignIdentifiers(requirementEntries, diagnostics);

  const fileOf = new Map(requirementEntries.map((entry) => [entry.requirement.id, entry.file]));
  const conditions = parseConditions(requirements, fileOf, diagnostics);

  const spec: Spec = {
    specVersion: first.spec.specVersion,
    name: first.spec.name,
    actors,
    entities,
    requirements,
  };

  collectWarnings(spec, fileOf, first.file, diagnostics);

  if (hasErrors(diagnostics)) {
    return {
      error: {
        kind: 'error',
        message: `${diagnostics.filter((d) => d.severity === 'error').length} error(s) loading the spec`,
        diagnostics,
      },
    };
  }

  return { spec, hash: hashSpec(spec), diagnostics, conditions };
}
