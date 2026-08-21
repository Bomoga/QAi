import type { AuthRequired, Confidence, ObservedEndpoint } from '../contracts/index.ts';

/**
 * Endpoint identity.
 *
 * A crawl sees `/api/invoices/INV-1001` and `/api/invoices/INV-1002`; the application
 * has one route. Identity is what collapses those into `GET /api/invoices/:id`, and M6
 * diffs runs on it, so a change in what this produces renames every endpoint in every
 * stored run. It is therefore deliberately conservative: a segment is turned into a
 * parameter only when it is recognizably an identifier, never merely because it
 * contains a digit, since `/api/v1/invoices` and `/oauth2/callback` are routes rather
 * than records.
 *
 * Nothing here reads a clock, a random source, or the environment. The same path gives
 * the same identity on every run, which is rule R6 and what makes the delta possible.
 *
 * Two levels, because they answer different questions:
 *
 * - `endpointId` is what a reader sees, `GET /api/invoices/:id`, with parameter names
 *   left as the source wrote them.
 * - `identityKey` erases parameter names, so a source adapter's `:invoiceId` and a
 *   crawl's `:id` are recognized as one route. M4.7 matches on that.
 */

/** `:id`, and the catch-all form `:path*` the Next.js adapter produces. */
const PARAMETER_SEGMENT = /^:(.+?)(\*?)$/u;

/** `v1`, `v2`. A version is part of the route, not a record identifier. */
const VERSION_SEGMENT = /^v\d+$/iu;

const ALL_DIGITS = /^\d+$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const LONG_HEX = /^[0-9a-f]{24,}$/iu;
/** `INV-1001`, `user_42`. Letters, one separator, then digits, and nothing after. */
const PREFIXED_ID = /^[A-Za-z]{1,10}[-_]\d+$/u;
/** A long opaque token such as a cuid. Requires a digit, so a long slug is left alone. */
const OPAQUE_TOKEN = /^(?=.*\d)[A-Za-z0-9]{20,}$/u;

/** The name every derived parameter takes, so two crawls never disagree about it. */
export const DERIVED_PARAMETER = ':id';

const CONFIDENCE_ORDER: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export function isParameterSegment(segment: string): boolean {
  return PARAMETER_SEGMENT.test(segment);
}

/** True when a segment names one record rather than one route. */
export function looksLikeIdentifier(segment: string): boolean {
  if (segment === '' || isParameterSegment(segment)) return false;
  if (VERSION_SEGMENT.test(segment)) return false;

  return (
    ALL_DIGITS.test(segment) ||
    UUID.test(segment) ||
    LONG_HEX.test(segment) ||
    PREFIXED_ID.test(segment) ||
    OPAQUE_TOKEN.test(segment)
  );
}

/**
 * The path as an identity: concrete record identifiers become `:id`, duplicate and
 * trailing slashes go, and a parameter already written by an adapter is left as it is.
 * Idempotent, so normalizing a normalized path changes nothing.
 */
export function normalizePath(path: string): string {
  const withoutQuery = path.split(/[?#]/u)[0] ?? path;

  const segments = withoutQuery
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => (looksLikeIdentifier(segment) ? DERIVED_PARAMETER : segment));

  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

/** What a reader sees, and what the Observation stores. */
export function endpointId(method: string, path: string): string {
  return `${method.toUpperCase()} ${normalizePath(path)}`;
}

/**
 * The path with every parameter name erased. `/api/invoices/:id` and
 * `/api/invoices/:invoiceId` are one route written twice, and anything comparing the
 * written form reports each side as a route the other did not have. A catch-all keeps
 * its own marker, since it matches a different number of segments.
 *
 * Exported because the structural diff compares an observed path against a configured
 * route template, which is the same question this answers, and two implementations of
 * one comparison eventually disagree.
 */
export function pathIdentity(path: string): string {
  const segments = normalizePath(path)
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => {
      const parameter = PARAMETER_SEGMENT.exec(segment);
      if (parameter === null) return segment;
      return parameter[2] === '*' ? ':*' : ':';
    });

  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

/**
 * The same route under any parameter name, as a key a merge can compare. M4.7 matches
 * on this, and M6 diffs stored runs by it.
 */
export function identityKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${pathIdentity(path)}`;
}

/** Rewrites an endpoint onto its normalized path and id, leaving everything else. */
export function normalizeEndpoint(endpoint: ObservedEndpoint): ObservedEndpoint {
  const path = normalizePath(endpoint.path);
  return { ...endpoint, path, id: endpointId(endpoint.method, path) };
}

function mergeAuthRequired(left: AuthRequired, right: AuthRequired): AuthRequired {
  if (left === right) return left;
  if (left === 'unknown') return right;
  if (right === 'unknown') return left;
  // One observation says yes and another says no. Neither is safe to keep, and
  // guessing which was right is how an endpoint gets reported as protected when it
  // is not. Unknown is the honest answer.
  return 'unknown';
}

function mergeFields(
  left: ObservedEndpoint['responseShape'],
  right: ObservedEndpoint['responseShape'],
): ObservedEndpoint['responseShape'] {
  if (left === undefined) return right;
  if (right === undefined) return left;

  const fields = [...new Set([...left.fields, ...right.fields])].sort();
  const entity = left.entity ?? right.entity;

  return { ...(entity === undefined ? {} : { entity }), fields };
}

/**
 * Folds a second observation of one endpoint into the first, keeping everything that
 * was learned. The first wins every scalar the two simply state differently, so a
 * caller decides precedence by argument order. M4.7 uses this across the source and
 * black box sides, where it passes the authoritative side first.
 */
export function mergeObservedEndpoints(
  first: ObservedEndpoint,
  next: ObservedEndpoint,
): ObservedEndpoint {
  const shape = mergeFields(first.responseShape, next.responseShape);
  const handlerRef = first.handlerRef ?? next.handlerRef;

  return {
    ...first,
    confidence:
      CONFIDENCE_ORDER[next.confidence] > CONFIDENCE_ORDER[first.confidence]
        ? next.confidence
        : first.confidence,
    authRequired: mergeAuthRequired(first.authRequired, next.authRequired),
    ...(handlerRef === undefined ? {} : { handlerRef }),
    ...(shape === undefined ? {} : { responseShape: shape }),
    actorVisibility: { ...next.actorVisibility, ...first.actorVisibility },
    evidence: [...new Set([...first.evidence, ...next.evidence])],
  };
}

/**
 * Normalizes a list and folds the endpoints that turn out to be one route, keeping
 * every piece of evidence that led to it. Order follows the input, so the result is
 * the same on every run over the same target.
 *
 * This folds within one side of a probe. Reconciling a source reading against a black
 * box one, where the origins and the confidence have to be argued about rather than
 * merged, is M4.7.
 */
export function normalizeEndpoints(
  endpoints: readonly ObservedEndpoint[],
): readonly ObservedEndpoint[] {
  const byId = new Map<string, ObservedEndpoint>();

  for (const endpoint of endpoints) {
    const normalized = normalizeEndpoint(endpoint);
    const existing = byId.get(normalized.id);
    byId.set(
      normalized.id,
      existing === undefined ? normalized : mergeObservedEndpoints(existing, normalized),
    );
  }

  return [...byId.values()];
}
