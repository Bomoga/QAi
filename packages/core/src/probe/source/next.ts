import { readFileSync } from 'node:fs';

import fastGlob from 'fast-glob';

import type { ObservationNote, ObservedEndpoint } from '../../contracts/index.ts';
import { CONFIDENCE_SOURCE_ONLY, type SourceAdapter, type SourceScan } from '../types.ts';

/**
 * Next.js App Router adapter.
 *
 * Route handlers follow a convention rigid enough that globbing and regex read them
 * reliably: a file named `route.ts` under `app/`, exporting a function named after the
 * HTTP method. The module says to start here and escalate to `ts-morph` only where a
 * specific case demands it, so this stays textual and records what it could not read
 * rather than guessing.
 *
 * Path derivation, all from the directory structure:
 *
 *   app/api/invoices/route.ts          -> /api/invoices
 *   app/api/invoices/[id]/route.ts     -> /api/invoices/:id
 *   app/(marketing)/about/route.ts     -> /about          route groups are not segments
 *   app/files/[...path]/route.ts       -> /files/:path*   catch-all
 *   app/opt/[[...rest]]/route.ts       -> /opt/:rest*     optional catch-all
 */

const ROUTE_GLOBS = ['app/**/route.{ts,tsx,js,jsx,mjs}', 'src/app/**/route.{ts,tsx,js,jsx,mjs}'];

const HTTP_METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type NextMethod = (typeof HTTP_METHODS)[number];

/**
 * `export async function GET(`, `export function GET(`, `export const GET =`.
 * Anchored to the line start so a mention inside a comment or a string does not count.
 */
function methodPattern(method: string): RegExp {
  return new RegExp(
    `^\\s*export\\s+(?:async\\s+)?(?:function\\s+${method}\\b|const\\s+${method}\\s*[=:])`,
    'u',
  );
}

/** Every segment of the URL a route file serves, in order. */
export function nextPathFor(routeFile: string): string {
  const withoutRoot = routeFile.replace(/^src\//u, '').replace(/^app\//u, '');
  const withoutFile = withoutRoot.replace(/\/?route\.[a-z]+$/u, '');

  if (withoutFile === '') return '/';

  const segments = withoutFile
    .split('/')
    .filter((segment) => segment !== '')
    // Route groups organize files without appearing in the URL.
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')))
    // Parallel and intercepting routes are not API routes; they are dropped, not guessed at.
    .filter((segment) => !segment.startsWith('@'))
    .map(segmentToPath);

  return `/${segments.join('/')}`;
}

function segmentToPath(segment: string): string {
  const optionalCatchAll = /^\[\[\.\.\.(.+)\]\]$/u.exec(segment);
  if (optionalCatchAll?.[1] !== undefined) return `:${optionalCatchAll[1]}*`;

  const catchAll = /^\[\.\.\.(.+)\]$/u.exec(segment);
  if (catchAll?.[1] !== undefined) return `:${catchAll[1]}*`;

  const dynamic = /^\[(.+)\]$/u.exec(segment);
  if (dynamic?.[1] !== undefined) return `:${dynamic[1]}`;

  return segment;
}

/** Methods a route file exports, with the line each is declared on. */
export function methodsIn(contents: string): { method: NextMethod; line: number }[] {
  const lines = contents.split(/\r?\n/u);
  const found: { method: NextMethod; line: number }[] = [];

  for (const method of HTTP_METHODS) {
    const pattern = methodPattern(method);
    const index = lines.findIndex((line) => pattern.test(line));
    if (index >= 0) found.push({ method, line: index + 1 });
  }

  return found;
}

export function createNextAdapter(): SourceAdapter {
  return {
    name: 'next-app-router',

    async detect(root) {
      const matches = await fastGlob(ROUTE_GLOBS, { cwd: root, onlyFiles: true, dot: false });
      return matches.length > 0;
    },

    async scan(root) {
      const files = (
        await fastGlob(ROUTE_GLOBS, { cwd: root, onlyFiles: true, dot: false })
      ).sort();

      const endpoints: ObservedEndpoint[] = [];
      const notes: ObservationNote[] = [];

      for (const file of files) {
        let contents: string;
        try {
          contents = readFileSync(`${root}/${file}`, 'utf8');
        } catch {
          notes.push({ level: 'warn', message: `${file} could not be read`, refs: [] });
          continue;
        }

        const path = nextPathFor(file);
        const methods = methodsIn(contents);

        if (methods.length === 0) {
          notes.push({
            level: 'warn',
            message: `${file} exports no recognized HTTP method, so its route was not recorded`,
            refs: [],
          });
          continue;
        }

        for (const { method, line } of methods) {
          endpoints.push({
            id: `${method} ${path}`,
            method,
            path,
            origin: 'source',
            confidence: CONFIDENCE_SOURCE_ONLY,
            handlerRef: `${file}:${line}`,
            // Never inferred from a path pattern. Only a refusal without credentials
            // establishes this, and that is a check's job, not a reader's.
            authRequired: 'unknown',
            actorVisibility: {},
            evidence: [],
          });
        }
      }

      const scan: SourceScan = { endpoints, entities: [], notes };
      return scan;
    },
  };
}
