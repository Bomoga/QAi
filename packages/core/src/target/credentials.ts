import type { ActorAuth, ActorConfig } from './config.ts';

/**
 * Environment variable resolution.
 *
 * Resolved values live here in memory and nowhere else. They are never logged, never
 * serialized, never written to evidence, and never returned in an error. The only way
 * out of this module is through an `ActorCredential`, which the request layer reads
 * and immediately redacts on capture.
 *
 * Every missing variable is reported in one pass. Discovering them one run at a time
 * is the pattern that makes people paste a secret into the config file to get moving,
 * which is exactly the failure the config shape exists to prevent.
 */

export interface BearerCredential {
  readonly kind: 'bearer';
  readonly token: string;
}

export interface CookieCredential {
  readonly kind: 'cookie';
  readonly name: string;
  readonly value: string;
}

export interface HeaderCredential {
  readonly kind: 'header';
  readonly name: string;
  readonly value: string;
}

export interface NoCredential {
  readonly kind: 'none';
}

export type ActorCredential = BearerCredential | CookieCredential | HeaderCredential | NoCredential;

export interface ResolvedActor {
  readonly id: string;
  readonly credential: ActorCredential;
  readonly attributes: Readonly<Record<string, string>>;
}

export interface MissingVariable {
  readonly actorId: string;
  readonly variable: string;
}

export interface CredentialResolution {
  readonly actors: readonly ResolvedActor[];
  /** Actors whose variables were absent. They are dropped, never silently blanked. */
  readonly missing: readonly MissingVariable[];
}

/** The variable an auth block names, or undefined for an actor that carries none. */
export function requiredVariable(auth: ActorAuth): string | undefined {
  switch (auth.kind) {
    case 'bearer':
      return auth.tokenEnv;
    case 'cookie':
    case 'header':
      return auth.valueEnv;
    case 'none':
      return undefined;
  }
}

function readVariable(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const value = env[name];
  if (value === undefined) return undefined;
  // An empty variable is treated as absent. A blank credential produces a confusing
  // 401 that looks like a finding rather than a configuration mistake.
  if (value.trim() === '') return undefined;
  return value;
}

function credentialFor(
  auth: ActorAuth,
  env: Readonly<Record<string, string | undefined>>,
): ActorCredential | undefined {
  switch (auth.kind) {
    case 'none':
      return { kind: 'none' };
    case 'bearer': {
      const token = readVariable(env, auth.tokenEnv);
      return token === undefined ? undefined : { kind: 'bearer', token };
    }
    case 'cookie': {
      const value = readVariable(env, auth.valueEnv);
      return value === undefined ? undefined : { kind: 'cookie', name: auth.name, value };
    }
    case 'header': {
      const value = readVariable(env, auth.valueEnv);
      return value === undefined ? undefined : { kind: 'header', name: auth.name, value };
    }
  }
}

/**
 * Environment is passed in rather than read from `process.env`, per rule R6 and the
 * architecture rule that core never reads the environment directly.
 */
export function resolveCredentials(
  actors: readonly ActorConfig[],
  env: Readonly<Record<string, string | undefined>>,
): CredentialResolution {
  const resolved: ResolvedActor[] = [];
  const missing: MissingVariable[] = [];

  for (const actor of actors) {
    const credential = credentialFor(actor.auth, env);

    if (credential === undefined) {
      const variable = requiredVariable(actor.auth);
      if (variable !== undefined) missing.push({ actorId: actor.id, variable });
      continue;
    }

    resolved.push({ id: actor.id, credential, attributes: actor.attributes });
  }

  return { actors: resolved, missing };
}

/** One line naming every absent variable, so a reader can set them all in one go. */
export function describeMissing(missing: readonly MissingVariable[]): string {
  if (missing.length === 0) return '';
  const parts = missing.map((entry) => `${entry.variable} for actor ${entry.actorId}`);
  return `${missing.length} credential variable(s) are not set: ${parts.join(', ')}`;
}
