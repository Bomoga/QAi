import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import fastGlob from 'fast-glob';

import type { ObservationNote, ObservedEndpoint } from '../../contracts/index.ts';
import { CONFIDENCE_SOURCE_ONLY, type SourceAdapter, type SourceScan } from '../types.ts';

/**
 * Express adapter.
 *
 * Express has no directory convention, so the route table lives in the call sites:
 * `app.get('/api/invoices', handler)`, `router.route('/x').get(h).post(h)`, and
 * `app.use('/api', invoiceRouter)` mounting a router declared in another file. The
 * module says to start with regex and glob heuristics and escalate to a parser only
 * where a specific case demands it, so this reads text and records what it could not
 * read rather than guessing.
 *
 * Mount prefixes are resolved across files. A router file declaring `/invoices` that
 * the application mounts at `/api` serves `/api/invoices`, and recording the declared
 * path alone would put an endpoint in the Observation the target does not serve, which
 * costs two structural findings: one endpoint specified and not observed, one observed
 * and not specified. Precision over recall, invariant I2.
 *
 * A receiver counts as a router when it was assigned from `express()` or `Router()` in
 * the same file, or when its last segment is `app` or `router`, which covers the
 * `function routes(app) { app.get(...) }` form. Anything else is left alone, so an HTTP
 * client's `client.get('/api/invoices', config)` does not become an endpoint.
 */

const SOURCE_GLOBS = ['**/*.{ts,tsx,js,jsx,mjs,cjs}'];

const IGNORED_GLOBS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/coverage/**',
  '**/*.d.ts',
  '**/*.test.*',
  '**/*.spec.*',
  '**/__tests__/**',
];

const MANIFEST_GLOBS = ['**/package.json'];

const EXPRESS_IMPORT = /from\s*['"]express['"]|require\(\s*['"]express['"]\s*\)/u;

/** `const app = express()`, and the `require('express')()` spelling of the same thing. */
const APP_ASSIGNMENT =
  /(?:const|let|var)\s+([\w$]+)\s*(?::[^=\n]+)?=\s*(?:express\s*\(\s*\)|require\(\s*['"]express['"]\s*\)\s*\(\s*\))/gu;

/** `const router = express.Router()`, `const router = Router()`, `new Router()`. */
const ROUTER_ASSIGNMENT =
  /(?:const|let|var)\s+([\w$]+)\s*(?::[^=\n]+)?=\s*(?:new\s+)?(?:express\.)?Router\s*\(/gu;

/**
 * Any `<receiver>.<member>(` where the member is one this adapter cares about. The
 * leading class excludes a dot so `this.app.get` is read as one receiver rather than
 * matched twice, once at `app`. Whitespace before the dot is allowed because a fluent
 * chain conventionally breaks the line there.
 */
const CALL_PATTERN =
  /(?:^|[^\w$.])([\w$][\w$.]*)\s*\.\s*(get|post|put|patch|delete|head|options|all|use|route)\s*\(/gu;

const CHAINED_VERB = /\.(get|post|put|patch|delete|head|options|all)\s*\(/gu;

const IMPORT_DEFAULT = /import\s+([\w$]+)\s*(?:,\s*\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/gu;
const IMPORT_NAMED = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gu;
const IMPORT_NAMESPACE = /import\s*\*\s*as\s+([\w$]+)\s*from\s*['"]([^'"]+)['"]/gu;
const REQUIRE_BINDING =
  /(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/gu;

const MODULE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/** How deep a chain of mounted routers is followed before the adapter gives up. */
const MAX_MOUNT_DEPTH = 10;

export interface ExpressRoute {
  readonly method: string;
  readonly path: string;
  readonly line: number;
}

export interface ExpressMount {
  readonly prefix: string;
  readonly identifiers: readonly string[];
  readonly line: number;
}

export interface ExpressFileScan {
  readonly routes: readonly ExpressRoute[];
  readonly mounts: readonly ExpressMount[];
  /** Lines where a route was registered on a path this adapter could not read. */
  readonly dynamicLines: readonly number[];
  readonly createsApp: boolean;
  /** Local binding to module specifier, for resolving a mounted router to its file. */
  readonly imports: ReadonlyMap<string, string>;
}

function charAt(text: string, index: number): string {
  return text[index] ?? '';
}

function lineAt(contents: string, index: number): number {
  return contents.slice(0, index).split(/\r?\n/u).length;
}

function nextNonSpace(text: string, from: number): number {
  let index = from;
  while (index < text.length && /\s/u.test(charAt(text, index))) index += 1;
  return index;
}

type FirstArgument =
  { kind: 'string'; value: string; end: number } | { kind: 'dynamic'; end: number };

/** Reads the first argument of a call, given the index of its opening parenthesis. */
function readFirstArgument(contents: string, open: number): FirstArgument {
  const start = nextNonSpace(contents, open + 1);
  const quote = charAt(contents, start);

  if (quote !== "'" && quote !== '"') return { kind: 'dynamic', end: start };

  const close = contents.indexOf(quote, start + 1);
  if (close < 0) return { kind: 'dynamic', end: start };

  return { kind: 'string', value: contents.slice(start + 1, close), end: close + 1 };
}

/** Index of the parenthesis closing the call that opens at `open`. */
function endOfCall(contents: string, open: number): number {
  let depth = 0;

  for (let index = open; index < contents.length; index += 1) {
    const char = charAt(contents, index);
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return contents.length;
}

/**
 * End of a fluent chain starting at `from`. The rest of that line always belongs to it,
 * and so does every following line whose first character is a dot. Bounding the chain
 * this way keeps `.get(` from an unrelated later statement out of the route table.
 */
function endOfChain(contents: string, from: number): number {
  let lineEnd = contents.indexOf('\n', from);
  if (lineEnd < 0) return contents.length;

  let index = lineEnd + 1;

  for (;;) {
    lineEnd = contents.indexOf('\n', index);
    const line = contents.slice(index, lineEnd < 0 ? contents.length : lineEnd);
    if (!line.trim().startsWith('.')) return index;
    if (lineEnd < 0) return contents.length;
    index = lineEnd + 1;
  }
}

/** Bare identifiers in a fragment, excluding calls and member accesses. */
function identifiersIn(fragment: string): string[] {
  const found: string[] = [];

  for (const match of fragment.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)/gu)) {
    const name = match[1];
    if (name === undefined) continue;

    const after = nextNonSpace(fragment, (match.index ?? 0) + match[0].length);
    const next = charAt(fragment, after);
    if (next === '(' || next === '.') continue;

    found.push(name);
  }

  return found;
}

/** Identifiers assigned from `express()` and from `Router()`, kept apart. */
export function routerNamesIn(contents: string): { apps: Set<string>; routers: Set<string> } {
  const apps = new Set<string>();
  const routers = new Set<string>();

  for (const match of contents.matchAll(APP_ASSIGNMENT)) {
    const name = match[1];
    if (name !== undefined) apps.add(name);
  }

  for (const match of contents.matchAll(ROUTER_ASSIGNMENT)) {
    const name = match[1];
    if (name !== undefined) routers.add(name);
  }

  return { apps, routers };
}

function isRouterReceiver(name: string, declared: ReadonlySet<string>): boolean {
  if (declared.has(name)) return true;
  return /(?:^|\.)(?:app|router)$/u.test(name);
}

/** Local bindings to module specifiers, one entry per bound name. */
export function importedModulesIn(contents: string): Map<string, string> {
  const imports = new Map<string, string>();

  const addNamed = (clause: string | undefined, specifier: string): void => {
    if (clause === undefined) return;
    for (const entry of clause.split(',')) {
      const parts = entry.trim().split(/\s+as\s+/u);
      const bound = parts[parts.length - 1]?.trim();
      if (bound !== undefined && bound !== '') imports.set(bound, specifier);
    }
  };

  for (const match of contents.matchAll(IMPORT_DEFAULT)) {
    const [, name, named, specifier] = match;
    if (name === undefined || specifier === undefined) continue;
    imports.set(name, specifier);
    addNamed(named, specifier);
  }

  for (const match of contents.matchAll(IMPORT_NAMED)) {
    const [, named, specifier] = match;
    if (specifier === undefined) continue;
    addNamed(named, specifier);
  }

  for (const match of contents.matchAll(IMPORT_NAMESPACE)) {
    const [, name, specifier] = match;
    if (name === undefined || specifier === undefined) continue;
    imports.set(name, specifier);
  }

  for (const match of contents.matchAll(REQUIRE_BINDING)) {
    const [, binding, specifier] = match;
    if (binding === undefined || specifier === undefined) continue;

    if (binding.startsWith('{')) addNamed(binding.slice(1, -1), specifier);
    else imports.set(binding, specifier);
  }

  return imports;
}

/** Joins a mount prefix and a declared route path into the path the target serves. */
export function joinRoutePath(prefix: string, routePath: string): string {
  const combined = `/${prefix}/${routePath}`.replace(/\/{2,}/gu, '/');
  const trimmed = combined.replace(/\/+$/u, '');
  return trimmed === '' ? '/' : trimmed;
}

/** Route registrations, mounts, and unreadable paths declared in one file. */
export function scanExpressFile(contents: string): ExpressFileScan {
  const { apps, routers } = routerNamesIn(contents);
  const declared = new Set([...apps, ...routers]);

  const routes: ExpressRoute[] = [];
  const mounts: ExpressMount[] = [];
  const dynamicLines: number[] = [];

  for (const match of contents.matchAll(CALL_PATTERN)) {
    const receiver = match[1];
    const member = match[2];
    if (receiver === undefined || member === undefined) continue;
    if (!isRouterReceiver(receiver, declared)) continue;

    const at = match.index ?? 0;
    const open = at + match[0].length - 1;
    const line = lineAt(contents, at + match[0].indexOf(receiver));
    const argument = readFirstArgument(contents, open);

    if (member === 'use') {
      const closing = endOfCall(contents, open);
      const rest = contents.slice(argument.kind === 'string' ? argument.end : open + 1, closing);
      const identifiers = identifiersIn(rest);
      if (identifiers.length > 0) {
        mounts.push({
          prefix: argument.kind === 'string' ? argument.value : '',
          identifiers,
          line,
        });
      }
      continue;
    }

    if (member === 'route') {
      if (argument.kind !== 'string') {
        dynamicLines.push(line);
        continue;
      }

      const closing = endOfCall(contents, open);
      const chain = contents.slice(closing, endOfChain(contents, closing));

      for (const verb of chain.matchAll(CHAINED_VERB)) {
        const method = verb[1];
        if (method === undefined) continue;
        routes.push({
          method: method.toUpperCase(),
          path: argument.value,
          line: lineAt(contents, closing + (verb.index ?? 0)),
        });
      }
      continue;
    }

    if (argument.kind !== 'string') {
      dynamicLines.push(line);
      continue;
    }

    // A registration always passes a handler. Without one this is a request being made,
    // not a route being declared, which is what keeps `client.get('/api/x')` out.
    if (charAt(contents, nextNonSpace(contents, argument.end)) !== ',') continue;

    routes.push({ method: member.toUpperCase(), path: argument.value, line });
  }

  return {
    routes,
    mounts,
    dynamicLines,
    createsApp: apps.size > 0,
    imports: importedModulesIn(contents),
  };
}

function resolveSpecifier(
  fromFile: string,
  specifier: string,
  files: ReadonlySet<string>,
): string | undefined {
  if (!specifier.startsWith('.')) return undefined;

  const base = posix.join(posix.dirname(fromFile), specifier);
  const candidates = [base];

  // A TypeScript ESM import names the emitted `.js` file, not the file on disk.
  const withoutJs = base.replace(/\.[cm]?js$/u, '');
  for (const extension of MODULE_EXTENSIONS) {
    candidates.push(`${withoutJs}${extension}`);
    candidates.push(`${base}${extension}`);
    candidates.push(posix.join(base, `index${extension}`));
  }

  return candidates.find((candidate) => files.has(candidate));
}

/**
 * Mount prefixes per file, walked out from every file that creates an application. A
 * file reachable by two mounts carries both prefixes, since the target serves it at
 * both, and a cycle stops at the depth ceiling rather than hanging the probe.
 */
function prefixesByFile(
  scans: ReadonlyMap<string, ExpressFileScan>,
  files: ReadonlySet<string>,
): Map<string, Set<string>> {
  const prefixes = new Map<string, Set<string>>();

  const walk = (file: string, prefix: string, depth: number): void => {
    const known = prefixes.get(file) ?? new Set<string>();
    if (known.has(prefix)) return;
    known.add(prefix);
    prefixes.set(file, known);

    if (depth >= MAX_MOUNT_DEPTH) return;

    const scan = scans.get(file);
    if (scan === undefined) return;

    for (const mount of scan.mounts) {
      for (const identifier of mount.identifiers) {
        const specifier = scan.imports.get(identifier);
        if (specifier === undefined) continue;

        const target = resolveSpecifier(file, specifier, files);
        if (target === undefined) continue;

        walk(target, joinRoutePath(prefix, mount.prefix), depth + 1);
      }
    }
  };

  for (const [file, scan] of scans) {
    if (scan.createsApp) walk(file, '', 0);
  }

  return prefixes;
}

async function sourceFiles(root: string): Promise<string[]> {
  const files = await fastGlob(SOURCE_GLOBS, {
    cwd: root,
    onlyFiles: true,
    dot: false,
    ignore: IGNORED_GLOBS,
  });

  return files.sort();
}

function readOrUndefined(root: string, file: string): string | undefined {
  try {
    return readFileSync(join(root, file), 'utf8');
  } catch {
    return undefined;
  }
}

async function declaresExpress(root: string): Promise<boolean> {
  const manifests = await fastGlob(MANIFEST_GLOBS, {
    cwd: root,
    onlyFiles: true,
    dot: false,
    ignore: ['**/node_modules/**'],
  });

  for (const manifest of manifests) {
    const contents = readOrUndefined(root, manifest);
    if (contents === undefined) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch {
      continue;
    }

    if (typeof parsed !== 'object' || parsed === null) continue;
    const record = parsed as Record<string, unknown>;

    for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
      const section = record[key];
      if (typeof section === 'object' && section !== null && 'express' in section) return true;
    }
  }

  return false;
}

export function createExpressAdapter(): SourceAdapter {
  return {
    name: 'express',

    async detect(root) {
      if (await declaresExpress(root)) return true;

      for (const file of await sourceFiles(root)) {
        const contents = readOrUndefined(root, file);
        if (contents !== undefined && EXPRESS_IMPORT.test(contents)) return true;
      }

      return false;
    },

    async scan(root) {
      const files = await sourceFiles(root);
      const known = new Set(files);

      const scans = new Map<string, ExpressFileScan>();
      const notes: ObservationNote[] = [];

      for (const file of files) {
        const contents = readOrUndefined(root, file);
        if (contents === undefined) {
          notes.push({ level: 'warn', message: `${file} could not be read`, refs: [] });
          continue;
        }

        scans.set(file, scanExpressFile(contents));
      }

      const prefixes = prefixesByFile(scans, known);
      const endpoints: ObservedEndpoint[] = [];
      const seen = new Set<string>();

      for (const [file, scan] of scans) {
        for (const line of scan.dynamicLines) {
          notes.push({
            level: 'warn',
            message: `${file}:${line} registers a route on a path this adapter could not read, so no endpoint was recorded for it`,
            refs: [],
          });
        }

        if (scan.routes.length === 0) continue;

        const mounted = prefixes.get(file);
        if (mounted === undefined) {
          notes.push({
            level: 'info',
            message: `${file} declares routes but no express application was found mounting it, so its paths are recorded as declared and may be missing a prefix`,
            refs: [],
          });
        }

        const applicable = mounted === undefined ? [''] : [...mounted].sort();

        for (const prefix of applicable) {
          for (const route of scan.routes) {
            const path = joinRoutePath(prefix, route.path);
            const id = `${route.method} ${path}`;
            if (seen.has(id)) continue;
            seen.add(id);

            endpoints.push({
              id,
              method: route.method,
              path,
              origin: 'source',
              confidence: CONFIDENCE_SOURCE_ONLY,
              handlerRef: `${file}:${route.line}`,
              // Only a refusal without credentials establishes this, and observing that
              // is a check's job. A path pattern is not evidence.
              authRequired: 'unknown',
              actorVisibility: {},
              evidence: [],
            });
          }
        }
      }

      endpoints.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

      const scan: SourceScan = { endpoints, entities: [], notes };
      return scan;
    },
  };
}
