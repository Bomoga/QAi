import { readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Every manifest says who wrote this, where it lives, and where to complain.
 *
 * **None of them said any of it until 2026-08-27**, which is blocker 7 of the publication
 * plan. Absent metadata costs nothing while a package is private and becomes visible the
 * moment anybody sees a package page or a repository listing, which is the point at which
 * it is least convenient to notice.
 *
 * The assertion worth having is `repository.directory`. npm uses it to point at where in a
 * monorepo a package actually lives, so a wrong one sends a reader looking at source that
 * belongs to a different package. It is a string nobody reads and everybody copies, which
 * is the kind of field that is wrong for a year.
 *
 * A test rather than a convention, for the reason the version claims got one: a new
 * package added without this would be found by whoever first followed a broken link.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY = 'https://github.com/Bomoga/specgate';

/** The root, then every workspace package by its directory. */
const MANIFESTS = [
  { path: 'package.json', directory: undefined },
  { path: 'packages/core/package.json', directory: 'packages/core' },
  { path: 'packages/cli/package.json', directory: 'packages/cli' },
  { path: 'packages/action/package.json', directory: 'packages/action' },
] as const;

interface Manifest {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly license?: unknown;
  readonly author?: unknown;
  readonly homepage?: unknown;
  readonly repository?: {
    readonly type?: unknown;
    readonly url?: unknown;
    readonly directory?: unknown;
  };
  readonly bugs?: { readonly url?: unknown };
}

function read(relativePath: string): Manifest {
  return JSON.parse(readFileSync(join(ROOT, relativePath), 'utf8')) as Manifest;
}

describe.each(MANIFESTS)('$path', ({ path, directory }) => {
  const manifest = read(path);

  it('names an author and a licence', () => {
    expect(manifest.author).toBe('Adrian Morton');
    expect(manifest.license).toBe('MIT');
  });

  it('says what it is', () => {
    expect(typeof manifest.description).toBe('string');
    expect(manifest.description).not.toBe('');
  });

  it('points at the repository, the readme, and the issue tracker', () => {
    expect(manifest.repository?.type).toBe('git');
    expect(manifest.repository?.url).toBe(`git+${REPOSITORY}.git`);
    expect(manifest.homepage).toBe(`${REPOSITORY}#readme`);
    expect(manifest.bugs?.url).toBe(`${REPOSITORY}/issues`);
  });

  it('locates itself inside the repository, or does not claim to', () => {
    // The root is the repository, so a `directory` on it would be wrong rather than
    // missing. Everything else has to name its own path, spelled the way npm expects:
    // forward slashes, relative to the repository root, no leading dot.
    if (directory === undefined) {
      expect(manifest.repository?.directory).toBeUndefined();
      return;
    }

    expect(manifest.repository?.directory).toBe(directory);
    expect(directory).toBe(posix.dirname(path));
  });
});
