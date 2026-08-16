import { request as undiciRequest } from 'undici';

import type { ActorCredential } from './credentials.ts';

/**
 * The HTTP layer. A thin wrapper over undici that returns what happened, including
 * when what happened was a failure to connect.
 *
 * No retry and no backoff. A flaky target has to surface as `inconclusive` rather than
 * be smoothed over, because a check that quietly succeeds on the third attempt is
 * reporting on a target that does not exist.
 */

/**
 * A closed set rather than a string. The probe issues GET-equivalent traffic and
 * checks declare themselves mutating, so an arbitrary method reaching the target is
 * a mistake worth catching at the type level.
 */
export type HttpMethod = 'GET' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestSpec {
  readonly method: HttpMethod;
  /** Path or absolute URL. A path is resolved against the target base URL. */
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface CapturedResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** True when the body exceeded the capture limit and was cut short. */
  readonly truncated: boolean;
  readonly durationMs: number;
}

/** A transport failure. Not a verdict: the caller decides what it means. */
export interface RequestFailure {
  readonly kind: 'transport-error';
  readonly message: string;
  readonly durationMs: number;
}

export type RequestOutcome =
  { readonly kind: 'response'; readonly response: CapturedResponse } | RequestFailure;

export function isTransportError(outcome: RequestOutcome): outcome is RequestFailure {
  return outcome.kind === 'transport-error';
}

/** 256 KB, from modules/M2-target.md. Beyond it a body is cut and marked truncated. */
export const DEFAULT_BODY_LIMIT_BYTES = 256 * 1024;

export interface HttpClientOptions {
  readonly baseUrl?: string;
  readonly bodyLimitBytes?: number;
  readonly timeoutMs?: number;
}

/**
 * The seam tests substitute. A fake here keeps unit tests off the network entirely,
 * per rule R9, while the integration tests use the real client against the local
 * fixture app and nothing else.
 */
export interface HttpClient {
  send(spec: RequestSpec, credential: ActorCredential): Promise<RequestOutcome>;
}

/** Applies a credential to the outgoing headers. The only place one is read. */
export function applyCredential(
  headers: Readonly<Record<string, string>>,
  credential: ActorCredential,
): Record<string, string> {
  const merged: Record<string, string> = { ...headers };

  switch (credential.kind) {
    case 'none':
      return merged;
    case 'bearer':
      merged['authorization'] = `Bearer ${credential.token}`;
      return merged;
    case 'header':
      merged[credential.name.toLowerCase()] = credential.value;
      return merged;
    case 'cookie': {
      const existing = merged['cookie'];
      const pair = `${credential.name}=${credential.value}`;
      merged['cookie'] = existing === undefined ? pair : `${existing}; ${pair}`;
      return merged;
    }
  }
}

export function resolveUrl(path: string, baseUrl?: string): string {
  if (/^https?:\/\//iu.test(path)) return path;
  if (baseUrl === undefined) {
    throw new Error(`cannot resolve "${path}" without a target baseUrl`);
  }
  return new URL(path, baseUrl).toString();
}

function flattenHeaders(raw: Readonly<Record<string, string | string[] | undefined>>): {
  [key: string]: string;
} {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    flat[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return flat;
}

export function createHttpClient(
  options: HttpClientOptions = {},
  now: () => number = () => Date.now(),
): HttpClient {
  const limit = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;

  return {
    async send(spec, credential) {
      const startedAt = now();
      const headers = applyCredential(spec.headers ?? {}, credential);

      let url: string;
      try {
        url = resolveUrl(spec.path, options.baseUrl);
      } catch (cause) {
        return {
          kind: 'transport-error',
          message: cause instanceof Error ? cause.message : 'could not resolve the URL',
          durationMs: now() - startedAt,
        };
      }

      try {
        const result = await undiciRequest(url, {
          method: spec.method,
          headers,
          ...(spec.body === undefined ? {} : { body: spec.body }),
          ...(options.timeoutMs === undefined ? {} : { headersTimeout: options.timeoutMs }),
        });

        const raw = await result.body.text();
        const truncated = Buffer.byteLength(raw, 'utf8') > limit;
        const body = truncated ? raw.slice(0, limit) : raw;

        return {
          kind: 'response',
          response: {
            status: result.statusCode,
            headers: flattenHeaders(result.headers),
            body,
            truncated,
            durationMs: now() - startedAt,
          },
        };
      } catch (cause) {
        return {
          kind: 'transport-error',
          message: cause instanceof Error ? cause.message : 'the request failed',
          durationMs: now() - startedAt,
        };
      }
    },
  };
}
