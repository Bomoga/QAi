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

export const TargetConfigSchema = z
  .object({
    target: TargetSectionSchema,
    actors: z.array(ActorConfigSchema).default([]),
    redaction: RedactionSectionSchema.default({ extraPatterns: [] }),
  })
  .strict();

export type BearerAuth = z.infer<typeof BearerAuthSchema>;
export type CookieAuth = z.infer<typeof CookieAuthSchema>;
export type HeaderAuth = z.infer<typeof HeaderAuthSchema>;
export type ActorAuth = z.infer<typeof ActorAuthSchema>;
export type ActorConfig = z.infer<typeof ActorConfigSchema>;
export type TargetSection = z.infer<typeof TargetSectionSchema>;
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
