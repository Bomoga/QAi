import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createNextAdapter } from '../../../packages/core/src/index.ts';
import type { ObservedEndpoint } from '../../../packages/core/src/index.ts';

/**
 * Does the Next adapter's reading of a route tree agree with Next?
 *
 * **This is the only test in the repository that can answer that.** The adapter derives a
 * URL from a directory structure: `(internal)` disappears, `[id]` becomes a parameter,
 * `[...path]` matches the rest. Its unit tests assert those derivations against synthetic
 * trees, which means they assert that the adapter agrees with what the author believed
 * about Next. The belief and the implementation came from the same place, so a wrong
 * belief passes.
 *
 * Nothing but Next can settle it, in the same way M7.4 records that the only authority on
 * what GitHub will ingest is GitHub. So this boots a real Next application, asks the
 * adapter what it thinks is there, and requests every one of those URLs.
 *
 * **It is slow and it is the reason it exists.** Next takes several seconds to start and
 * compiles a route the first time it is asked for one, so the timeouts below are generous
 * on purpose rather than by neglect. Rule R9 holds: this is a loopback port and a local
 * framework, and nothing leaves the machine.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NEXT_BIN = join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');

/** Long enough for a cold Next start, which is seconds rather than milliseconds. */
const BOOT_TIMEOUT_MS = 90_000;
const CASE_TIMEOUT_MS = 60_000;

let server: ChildProcess | undefined;
let baseUrl = '';
let endpoints: readonly ObservedEndpoint[] = [];

/** A port nothing else is on, taken by binding and releasing before Next is told to use it. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
  const address = probe.address();
  const port = address !== null && typeof address !== 'string' ? address.port : 0;
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

async function waitForReady(url: string, deadline: number): Promise<void> {
  for (;;) {
    if (Date.now() > deadline) throw new Error(`next did not answer on ${url}`);

    try {
      await fetch(url, { signal: AbortSignal.timeout(2_000) });
      return;
    } catch {
      await new Promise((done) => setTimeout(done, 250));
    }
  }
}

beforeAll(async () => {
  const scan = await createNextAdapter().scan(ROOT);
  endpoints = scan.endpoints;

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;

  server = spawn(process.execPath, [NEXT_BIN, 'dev', '--port', String(port)], {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });

  await waitForReady(`${baseUrl}/health`, Date.now() + BOOT_TIMEOUT_MS);
}, BOOT_TIMEOUT_MS);

afterAll(() => {
  server?.kill();
});

/** `/api/invoices/:id` as something Next can actually route: `/api/invoices/probe`. */
function requestable(path: string): string {
  return path
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':') && segment.endsWith('*')) return 'one/two';
      if (segment.startsWith(':')) return 'probe';
      return segment;
    })
    .join('/');
}

describe('the adapter found the tree', () => {
  it('reads every route file, and nothing that is not one', () => {
    const ids = [...endpoints.map((endpoint) => endpoint.id)].sort();

    expect(ids).toStrictEqual([
      'DELETE /api/invoices/:id',
      'GET /api/invoices',
      'GET /api/invoices/:id',
      'GET /files/:path*',
      'GET /health',
      'PATCH /api/invoices/:id',
      'POST /api/invoices',
    ]);
  });

  it('points every handler reference at a line that exports that method', () => {
    // A reference is what a finding cites, so pointing at the wrong line is worse than
    // pointing at nothing. Checked against the file rather than against the derivation.
    for (const endpoint of endpoints) {
      const reference = endpoint.handlerRef ?? '';
      const [file, line] = reference.split(/:(\d+)$/u);

      expect(file, reference).toBeTruthy();
      expect(existsSync(join(ROOT, file ?? '')), reference).toBe(true);

      const source = readFileSync(join(ROOT, file ?? ''), 'utf8').split('\n');
      const text = source[Number(line) - 1] ?? '';

      expect(text, `${reference} should export ${endpoint.method}`).toContain(endpoint.method);
    }
  });
});

describe('Next serves what the adapter says is there', () => {
  it(
    'answers every derived path, so the derivation is not merely self-consistent',
    async () => {
      const misses: string[] = [];

      for (const endpoint of endpoints) {
        const path = requestable(endpoint.path);
        const response = await fetch(`${baseUrl}${path}`, { method: endpoint.method });

        // 404 is the one answer that means the derivation was wrong: Next routed nothing
        // there. Any other status is the handler having run.
        if (response.status === 404) misses.push(`${endpoint.method} ${path}`);
      }

      expect(misses).toStrictEqual([]);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'strips a route group from the URL, which only Next can confirm',
    async () => {
      // `app/(internal)/health/route.ts` serves `/health`. If the adapter were wrong about
      // route groups it would claim `/internal/health`, and every other assertion here
      // would still pass because they all read the same directory names.
      const served = await fetch(`${baseUrl}/health`);
      const grouped = await fetch(`${baseUrl}/internal/health`);

      expect(served.status).toBe(200);
      expect(grouped.status).toBe(404);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'routes a catch-all across several segments and not across none',
    async () => {
      const two = await fetch(`${baseUrl}/files/one/two`);
      const none = await fetch(`${baseUrl}/files`);

      expect(two.status).toBe(200);
      expect(await two.json()).toStrictEqual({ path: ['one', 'two'] });
      // A catch-all matches one segment or more. An optional one would match zero, and
      // the adapter writes them the same way, so this is the difference it cannot see.
      expect(none.status).toBe(404);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'does not serve a method the file does not export',
    async () => {
      // The adapter reads exported function names. A file exporting GET and POST should
      // not answer a DELETE, or the reading says less than it appears to.
      const response = await fetch(`${baseUrl}/api/invoices`, { method: 'DELETE' });

      expect(response.status).toBe(405);
    },
    CASE_TIMEOUT_MS,
  );
});
