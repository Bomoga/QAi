import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Does the CLI bundle run with nothing beside it?
 *
 * **No other test in this repository can answer that**, and that is the point. Every one
 * of them runs from the workspace, where `node_modules` is a directory away and every
 * bare import resolves whether the bundle inlined it or not. The one consumer that has no
 * `node_modules` is the GitHub Action, because an action is checked out and never built,
 * and it is the consumer nothing was exercising.
 *
 * The bundle failed the first time it was tried this way. `fast-glob` is CommonJS and
 * calls `require('os')` at load; esbuild cannot see a runtime call, so it substituted a
 * stub that throws `Dynamic require of "os" is not supported`, and the CLI died on
 * startup. Every existing test still passed. A banner giving the bundle a real `require`
 * fixed it, and this test is what would catch the next dependency that does the same.
 *
 * It needs `pnpm build` to have run, which CI does before it tests.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'packages', 'cli', 'bin', 'specgate.js');
const BUNDLE = join(ROOT, 'packages', 'cli', 'dist', 'index.js');
const FIXTURE_SPEC = join(ROOT, 'fixtures', 'ledger', 'spec', 'ledger.spec.yaml');

/** Node's own modules, which a bundle is expected to import and a consumer always has. */
const BUILTINS = new Set([
  'assert',
  'buffer',
  'child_process',
  'crypto',
  'events',
  'fs',
  'http',
  'https',
  'module',
  'net',
  'os',
  'path',
  'process',
  'stream',
  'string_decoder',
  'tls',
  'tty',
  'url',
  'util',
  'zlib',
]);

/**
 * The one dependency that cannot be inlined, because it is a compiled binary rather than
 * JavaScript. It is loaded with `createRequire` when the store opens, so it never appears
 * as a static import, and its absence is a warning rather than a crash.
 */
const NATIVE = 'better-sqlite3';

let home = '';

beforeAll(() => {
  // A directory with no `node_modules` above it, anywhere. The system temp directory is
  // chosen for exactly that: putting this under the workspace would resolve every bare
  // import and the test would pass without testing anything.
  home = mkdtempSync(join(tmpdir(), 'specgate-standalone-'));
  mkdirSync(join(home, 'bin'));
  mkdirSync(join(home, 'dist'));
  cpSync(BIN, join(home, 'bin', 'specgate.js'));
  cpSync(BUNDLE, join(home, 'dist', 'index.js'));
});

afterAll(() => {
  if (home !== '') rmSync(home, { recursive: true, force: true });
});

function runStandalone(args: readonly string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [join(home, 'bin', 'specgate.js'), ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, status: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
      status: failure.status ?? 1,
    };
  }
}

describe('the CLI bundle carries its dependencies', () => {
  it('imports nothing but Node builtins', () => {
    const source = readFileSync(BUNDLE, 'utf8');
    const imported = new Set(
      [...source.matchAll(/^import\s[^;]*?from\s*["']([^"']+)["']/gmu)].map((m) => m[1] ?? ''),
    );

    const external = [...imported]
      .map((name) => name.replace(/^node:/u, ''))
      .filter((name) => name !== '' && !BUILTINS.has(name));

    expect(external, 'every dependency should be inlined').toStrictEqual([]);
  });

  it('does not import the native module statically, so a missing one is survivable', () => {
    const source = readFileSync(BUNDLE, 'utf8');
    const statically = new RegExp(`^import\\s[^;]*?from\\s*["']${NATIVE}["']`, 'mu');

    expect(statically.test(source)).toBe(false);
  });
});

describe('the CLI bundle runs with nothing beside it', () => {
  it('starts, which a dynamic require stub would prevent', () => {
    const { stdout, status } = runStandalone(['--version']);

    expect(stdout, stdout).not.toMatch(/Dynamic require of/u);
    expect(status).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/u);
  });

  it('loads and validates a spec, which exercises the globbing, YAML, and schema paths', () => {
    // `fast-glob` is the dependency that broke the first bundle, and spec loading is what
    // uses it, so this case is the one that would have caught it.
    const { stdout, status } = runStandalone(['validate', FIXTURE_SPEC]);

    expect(stdout, stdout).not.toMatch(/Dynamic require of/u);
    expect(status).toBe(0);
    expect(stdout).toMatch(/requirement/iu);
  });
});
