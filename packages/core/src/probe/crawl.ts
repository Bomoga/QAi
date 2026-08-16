import type { ObservationNote, ObservedEndpoint } from '../contracts/index.ts';
import type { RequestOutcome, RequestSpec } from '../target/request.ts';
import {
  CONFIDENCE_BLACKBOX_ONLY,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_PAGES,
  type SourceScan,
} from './types.ts';

/**
 * The black box crawler.
 *
 * Reads a running target the way a reader would: request a page, follow the links it
 * contains, and record what answered. It exists so that a target with no source, or a
 * framework no adapter recognizes, still produces an Observation.
 *
 * Read-only by construction rather than by discipline. `CRAWL_METHODS` is the whole set
 * of methods this file can issue, forms are never submitted, and a link off origin is
 * dropped rather than followed. Invariant I7 and the module's Do Not.
 *
 * What it records is what it observed, which is narrower than what exists:
 *
 * - A path that answered 404, 405, or 410 is not recorded. A dead link is evidence
 *   against an endpoint, and recording one would invent a route the target refuses.
 * - `authRequired` stays `"unknown"`. The crawl is authenticated, so a refusal here says
 *   this actor may not have it, not that credentials are required. Only a refusal
 *   without credentials establishes that, and observing it is a check's job.
 * - No entities. A crawl sees response fields, never a model name, and naming an entity
 *   from a response would be a guess presented as a schema reading.
 *
 * Paths are recorded as observed. Turning `/api/invoices/42` into `/api/invoices/:id`
 * is endpoint identity normalization, which is M4.6 and applies to both sides.
 */

/** The only methods this crawler may issue. A test asserts nothing else is sent. */
export const CRAWL_METHODS = ['GET', 'HEAD'] as const;

/** Statuses that say the path is not there, so no endpoint is recorded for it. */
const ABSENT_STATUSES = new Set([404, 405, 410]);

const ASSET_EXTENSIONS = new Set([
  'css',
  'js',
  'mjs',
  'cjs',
  'map',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'ico',
  'webp',
  'avif',
  'woff',
  'woff2',
  'ttf',
  'eot',
  'pdf',
  'zip',
  'mp4',
  'webm',
]);

const UNFOLLOWABLE_SCHEMES = /^(?:javascript|mailto|tel|data|blob|file|ftp):/iu;

const LINK_ATTRIBUTE = /(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu;

/**
 * The crawler needs an identity that can issue a request and hand back the evidence id
 * it recorded. Narrower than the whole session on purpose: nothing here should be able
 * to reach a credential, and a narrower seam is a smaller thing to fake in tests.
 */
export interface CrawlSession {
  readonly id: string;
  request(spec: RequestSpec): Promise<{ outcome: RequestOutcome; evidenceId: string }>;
}

export interface CrawlOptions {
  readonly baseUrl: string;
  /** Where the crawl starts. Defaults to the site root. */
  readonly startPaths?: readonly string[];
  readonly maxPages?: number;
  readonly maxDepth?: number;
}

/** Links in an HTML document, as written. Attributes only, never form actions. */
export function linksIn(html: string): string[] {
  const found: string[] = [];

  for (const match of html.matchAll(LINK_ATTRIBUTE)) {
    const value = match[1] ?? match[2] ?? match[3];
    if (value !== undefined && value !== '') found.push(value);
  }

  return found;
}

/**
 * The path a candidate link points at, or undefined when it leaves the origin or is not
 * something to request. The query is dropped: `/search?q=1` and `/search?q=2` are one
 * endpoint, and keeping the query would make the crawl unbounded on a paginated list.
 */
export function sameOriginPath(candidate: string, baseUrl: string): string | undefined {
  const trimmed = candidate.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return undefined;
  if (UNFOLLOWABLE_SCHEMES.test(trimmed)) return undefined;

  let url: URL;
  let base: URL;
  try {
    base = new URL(baseUrl);
    url = new URL(trimmed, baseUrl);
  } catch {
    return undefined;
  }

  if (url.origin !== base.origin) return undefined;

  return url.pathname;
}

export function looksLikeAsset(path: string): boolean {
  const extension = /\.([a-z0-9]+)$/iu.exec(path)?.[1];
  return extension !== undefined && ASSET_EXTENSIONS.has(extension.toLowerCase());
}

function contentType(headers: Readonly<Record<string, string>>): string {
  return headers['content-type'] ?? '';
}

/** Field names a JSON body exposes, for the diff to compare against the spec. */
export function fieldsIn(body: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }

  const record = Array.isArray(parsed) ? parsed[0] : parsed;
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return [];

  return Object.keys(record).sort();
}

/** Same-origin paths named by string values in a JSON body, so an API index is followed. */
function pathsInJson(body: string, baseUrl: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }

  const found: string[] = [];

  const walk = (value: unknown, depth: number): void => {
    if (depth > 6) return;

    if (typeof value === 'string') {
      if (value.startsWith('/')) {
        const path = sameOriginPath(value, baseUrl);
        if (path !== undefined) found.push(path);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1);
      return;
    }

    if (typeof value === 'object' && value !== null) {
      for (const entry of Object.values(value)) walk(entry, depth + 1);
    }
  };

  walk(parsed, 0);
  return found;
}

interface Pending {
  readonly path: string;
  readonly depth: number;
}

/**
 * Crawls the target as one actor and reports what answered.
 *
 * Breadth first, so a shallow budget describes the application's front door rather than
 * one arbitrary branch of it. Exhausting the budget produces a note: an Observation that
 * stopped early and does not say so reads as an application that has nothing more in it.
 */
export async function crawl(session: CrawlSession, options: CrawlOptions): Promise<SourceScan> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

  const seeds = options.startPaths === undefined ? ['/'] : [...options.startPaths];
  const queue: Pending[] = [];
  const queued = new Set<string>();

  for (const seed of seeds) {
    const path = sameOriginPath(seed, options.baseUrl);
    if (path === undefined || queued.has(path)) continue;
    queued.add(path);
    queue.push({ path, depth: 0 });
  }

  const endpoints: ObservedEndpoint[] = [];
  const notes: ObservationNote[] = [];
  let requests = 0;

  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) break;

    if (requests >= maxPages) {
      notes.push({
        level: 'warn',
        message: `The crawl stopped at its ceiling of ${maxPages} requests with ${queue.length + 1} paths still to visit, so this Observation is partial.`,
        refs: [],
      });
      break;
    }

    const method = looksLikeAsset(next.path) ? 'HEAD' : 'GET';
    requests += 1;

    const { outcome, evidenceId } = await session.request({ method, path: next.path });

    if (outcome.kind === 'transport-error') {
      notes.push({
        level: 'warn',
        message: `${method} ${next.path} could not be reached: ${outcome.message}`,
        refs: [evidenceId],
      });
      continue;
    }

    const { response } = outcome;
    if (ABSENT_STATUSES.has(response.status)) continue;

    const type = contentType(response.headers);
    const fields = type.includes('json') ? fieldsIn(response.body) : [];

    endpoints.push({
      id: `${method} ${next.path}`,
      method,
      path: next.path,
      origin: 'blackbox',
      confidence: CONFIDENCE_BLACKBOX_ONLY,
      authRequired: 'unknown',
      ...(fields.length === 0 ? {} : { responseShape: { fields } }),
      // Left empty even though this actor plainly saw the page. The contract reserves
      // actorVisibility for checks, and a probe-only run reports every actor untested.
      actorVisibility: {},
      evidence: [evidenceId],
    });

    if (method !== 'GET' || next.depth >= maxDepth) continue;

    const discovered = type.includes('html')
      ? linksIn(response.body).flatMap((link) => {
          const path = sameOriginPath(link, options.baseUrl);
          return path === undefined ? [] : [path];
        })
      : type.includes('json')
        ? pathsInJson(response.body, options.baseUrl)
        : [];

    for (const path of discovered) {
      if (queued.has(path)) continue;
      queued.add(path);
      queue.push({ path, depth: next.depth + 1 });
    }
  }

  endpoints.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  const scan: SourceScan = { endpoints, entities: [], notes };
  return scan;
}
