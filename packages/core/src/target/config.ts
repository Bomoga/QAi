import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { error, type LoadDiagnostic } from '../spec/diagnostics.ts';

/**
 * `qai.config.yaml`. Resolution of the target, its actors, and redaction settings.
 *
 * The config holds environment variable names, never values. A literal secret in a
 * file that lives in a repository is the failure this tool was built to notice in
 * other people's software, so it is rejected here with a message naming the
 * environment variable to use instead.
 */

export const DEFAULT_CONFIG_PATH = 'qai.config.yaml';

/** Names an environment variable, so the shape rules out a value at the type level. */
const EnvVarNameSchema = z
  .string()
  .regex(
    /^[A-Z][A-Z0-9_]*$/,
    'must be an environment variable name, for example LEDGER_OWNER_TOKEN',
  );

export const BearerAuthSchema = z
  .object({
    kind: z.literal('bearer'),
    tokenEnv: EnvVarNameSchema,
  })
  .strict();

export const CookieAuthSchema = z
  .object({
    kind: z.literal('cookie'),
    name: z.string().min(1),
    valueEnv: EnvVarNameSchema,
  })
  .strict();

export const HeaderAuthSchema = z
  .object({
    kind: z.literal('header'),
    name: z.string().min(1),
    valueEnv: EnvVarNameSchema,
  })
  .strict();

/** An actor that carries no credentials. Needed to check that a route refuses one. */
export const NoAuthSchema = z.object({ kind: z.literal('none') }).strict();

export const ActorAuthSchema = z.discriminatedUnion('kind', [
  BearerAuthSchema,
  CookieAuthSchema,
  HeaderAuthSchema,
  NoAuthSchema,
]);

export const ActorConfigSchema = z
  .object({
    id: z.string().min(1),
    auth: ActorAuthSchema,
    /** Merged into the actor's identity for condition evaluation, for example org_id. */
    attributes: z.record(z.string(), z.string()).default({}),
  })
  .strict();

export const TargetSectionSchema = z
  .object({
    baseUrl: z.url().optional(),
    sourceRoot: z.string().min(1).optional(),
    /**
     * Invariant I7. Defaults to false: a target is not disposable until someone says
     * so in writing. Seeding and every mutating check refuse to run without it.
     */
    disposable: z.boolean().default(false),
    resetCommand: z.string().min(1).optional(),
    seedCommand: z.string().min(1).optional(),
  })
  .strict();

export const RedactionSectionSchema = z
  .object({
    extraPatterns: z.array(z.string().min(1)).default([]),
  })
  .strict();

/**
 * Route and instance overrides, used when no Observation is available.
 *
 * An access rule names a resource, not a URL, and M3 refuses to guess one by
 * pluralizing an entity name. Until M4 can discover routes, this is where the mapping
 * comes from. `{id}` in a path is substituted with the instance being acted on.
 */
export const ResourceInstanceSchema = z
  .object({
    id: z.string().min(1),
    /** Compared against a rule's condition to decide which instance is foreign. */
    attributes: z.record(z.string(), z.string()).default({}),
  })
  .strict();

export const ResourceRoutesSchema = z
  .object({
    read: z.string().min(1).optional(),
    list: z.string().min(1).optional(),
    create: z.string().min(1).optional(),
    update: z.string().min(1).optional(),
    delete: z.string().min(1).optional(),
  })
  .strict();

export const ResourceConfigSchema = z
  .object({
    /** Matches an entity name in the spec. */
    name: z.string().min(1),
    routes: ResourceRoutesSchema.default({}),
    /**
     * Records the target is known to hold. A deny check needs a real record owned by
     * someone else: testing access control against a record that does not exist
     * proves nothing, so an absent instance produces `inconclusive`, never `pass`.
     */
    instances: z.array(ResourceInstanceSchema).default([]),
  })
  .strict();

/**
 * Run settings a project can write down instead of passing every time.
 *
 * Added at M8.2, a cross-module edit into M2's file with the same shape as M3.2 adding
 * `resources` and M2.8 adding `stateActor`. The M8 module states a precedence of command
 * line flag, then environment variable, then config file, then built-in default, and
 * this schema is `.strict()`, so without a section for them the config file layer of
 * that precedence could not exist at all: writing `format: sarif` would be a load error.
 *
 * Everything here is optional and everything here is overridable. These are defaults, not
 * policy, which is why the section is named for what it holds rather than for the
 * commands that read it.
 *
 * `--config` is deliberately absent. A file cannot name its own path, so that one
 * resolves from the flag and the environment only.
 */
export const DefaultsSectionSchema = z
  .object({
    format: z.enum(['text', 'json', 'sarif', 'junit']).optional(),
    out: z.string().min(1).optional(),
    failOn: z.enum(['high', 'medium', 'low']).optional(),
    failOnUnverified: z.boolean().optional(),
    concurrency: z.int().min(1).optional(),
  })
  .strict();

export const TargetConfigSchema = z
  .object({
    target: TargetSectionSchema,
    actors: z.array(ActorConfigSchema).default([]),
    resources: z.array(ResourceConfigSchema).default([]),
    /**
     * The actor persisted state is read as, after an action has been taken.
     *
     * Added at M2.8 because two behavioral assertion forms need one, the record count and
     * the before and after comparison, and every caller was choosing an identity for
     * itself. It names a configured actor rather than carrying credentials of its own.
     *
     * **No default, deliberately.** Absent leaves state assertions unevaluable, which is
     * honest, and neither available default is safe. The acting actor is frequently one
     * that cannot read the record at all, which is the point of the criterion; and an
     * actor scoped to its own organization counts only what it can see, so a scoping bug
     * would arrive dressed as a state bug.
     */
    stateActor: z.string().min(1).optional(),
    redaction: RedactionSectionSchema.default({ extraPatterns: [] }),
    /** Run settings a flag or an environment variable overrides. See the note above. */
    defaults: DefaultsSectionSchema.default({}),
  })
  .strict();

export type BearerAuth = z.infer<typeof BearerAuthSchema>;
export type CookieAuth = z.infer<typeof CookieAuthSchema>;
export type HeaderAuth = z.infer<typeof HeaderAuthSchema>;
export type ActorAuth = z.infer<typeof ActorAuthSchema>;
export type ActorConfig = z.infer<typeof ActorConfigSchema>;
export type TargetSection = z.infer<typeof TargetSectionSchema>;
export type ResourceInstance = z.infer<typeof ResourceInstanceSchema>;
export type ResourceRoutes = z.infer<typeof ResourceRoutesSchema>;
export type ResourceConfig = z.infer<typeof ResourceConfigSchema>;
export type DefaultsSection = z.infer<typeof DefaultsSectionSchema>;
export type TargetConfig = z.infer<typeof TargetConfigSchema>;

export interface ConfigError {
  readonly kind: 'error';
  readonly message: string;
  readonly diagnostics: readonly LoadDiagnostic[];
}

export interface LoadedConfig {
  readonly config: TargetConfig;
}

export type LoadConfigResult = LoadedConfig | { readonly error: ConfigError };

export function isConfigFailure(
  result: LoadConfigResult,
): result is { readonly error: ConfigError } {
  return 'error' in result;
}

/**
 * Keys that almost certainly hold a value rather than the name of one. Caught before
 * schema validation so the message can say what to do, rather than reporting an
 * unrecognized key and leaving the author to work out why it is unrecognized.
 */
const LITERAL_SECRET_KEYS = new Set(['token', 'password', 'secret', 'apikey', 'apiKey', 'value']);

function formatPath(segments: readonly (string | number | symbol)[]): string {
  return segments.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    if (acc === '') return String(segment);
    return `${acc}.${String(segment)}`;
  }, '');
}

function suggestedEnvVar(actorId: unknown, key: string): string {
  const actor = typeof actorId === 'string' && actorId !== '' ? actorId : 'actor';
  const stem = key.toLowerCase() === 'value' ? 'value' : key.toLowerCase();
  return `${actor}_${stem}`.replace(/[^A-Za-z0-9]+/gu, '_').toUpperCase();
}

/**
 * Walks the actor auth blocks looking for a literal where a variable name belongs.
 * Runs before the schema so the diagnostic can name the fix.
 */
function findLiteralSecrets(document: unknown, file: string): LoadDiagnostic[] {
  if (typeof document !== 'object' || document === null) return [];

  const actors = (document as { actors?: unknown }).actors;
  if (!Array.isArray(actors)) return [];

  const diagnostics: LoadDiagnostic[] = [];

  actors.forEach((actor, index) => {
    if (typeof actor !== 'object' || actor === null) return;
    const auth = (actor as { auth?: unknown }).auth;
    if (typeof auth !== 'object' || auth === null) return;

    for (const key of Object.keys(auth)) {
      if (!LITERAL_SECRET_KEYS.has(key)) continue;
      const envName = suggestedEnvVar((actor as { id?: unknown }).id, key);
      diagnostics.push(
        error(
          file,
          `actors[${index}].auth.${key}`,
          `"${key}" holds a credential value. Config files carry environment variable names, not secrets. Use "${key === 'token' ? 'tokenEnv' : 'valueEnv'}: ${envName}" and set ${envName} in the environment.`,
        ),
      );
    }
  });

  return diagnostics;
}

export function loadConfig(path?: string, cwd: string = process.cwd()): LoadConfigResult {
  const relative = path ?? DEFAULT_CONFIG_PATH;
  const absolute = isAbsolute(relative) ? relative : resolve(cwd, relative);

  let text: string;
  try {
    text = readFileSync(absolute, 'utf8');
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'unreadable';
    return {
      error: {
        kind: 'error',
        message: `could not read ${relative}`,
        diagnostics: [error(relative, '', reason)],
      },
    };
  }

  let document: unknown;
  try {
    document = parseYaml(text);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'invalid YAML';
    return {
      error: {
        kind: 'error',
        message: `could not parse ${relative}`,
        diagnostics: [error(relative, '', `could not parse YAML: ${reason}`)],
      },
    };
  }

  if (document === null || document === undefined) {
    return {
      error: {
        kind: 'error',
        message: `${relative} is empty`,
        diagnostics: [error(relative, '', 'the file is empty')],
      },
    };
  }

  const literals = findLiteralSecrets(document, relative);
  if (literals.length > 0) {
    return {
      error: {
        kind: 'error',
        message: `${relative} contains a credential value where an environment variable name belongs`,
        diagnostics: literals,
      },
    };
  }

  const parsed = TargetConfigSchema.safeParse(document);
  if (!parsed.success) {
    return {
      error: {
        kind: 'error',
        message: `${relative} is not a valid configuration`,
        diagnostics: parsed.error.issues.map((issue) =>
          error(relative, formatPath(issue.path), issue.message),
        ),
      },
    };
  }

  const duplicate = findDuplicateActorId(parsed.data.actors);
  if (duplicate !== undefined) {
    return {
      error: {
        kind: 'error',
        message: `${relative} defines actor "${duplicate}" more than once`,
        diagnostics: [
          error(relative, 'actors', `actor id "${duplicate}" is defined more than once`),
        ],
      },
    };
  }

  /**
   * A state actor naming nobody is an authoring mistake worth failing the load for.
   * Left to runtime it would make every state assertion unevaluable, and a run reporting
   * a column of unverified criteria for a reason nobody reads is how a typo becomes a
   * coverage gap that survives review.
   */
  const stateActor = parsed.data.stateActor;
  if (stateActor !== undefined && !parsed.data.actors.some((actor) => actor.id === stateActor)) {
    const known = parsed.data.actors.map((actor) => actor.id);
    return {
      error: {
        kind: 'error',
        message: `${relative} names a state actor that is not configured`,
        diagnostics: [
          error(
            relative,
            'stateActor',
            `"${stateActor}" is not a configured actor. ${known.length === 0 ? 'No actors are configured.' : `Configured actors: ${known.join(', ')}.`}`,
          ),
        ],
      },
    };
  }

  return { config: parsed.data };
}

function findDuplicateActorId(actors: readonly ActorConfig[]): string | undefined {
  const seen = new Set<string>();
  for (const actor of actors) {
    if (seen.has(actor.id)) return actor.id;
    seen.add(actor.id);
  }
  return undefined;
}
