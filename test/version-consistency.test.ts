import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CLI_VERSION } from '../packages/cli/src/program.ts';

/**
 * Every place this project claims a version says the same thing.
 *
 * **There are five of them and nothing was keeping them in step.** At the v0.1.0 release
 * the root manifest said `0.1.0`, the three workspace manifests said `0.0.0`, and
 * `CLI_VERSION` said `0.1.0` because somebody had typed it there. The release went out
 * correctly, and only because the three that mattered happened to agree.
 *
 * `CLI_VERSION` is the one that reaches a user. It is what `qai --version` prints and what
 * lands in `toolVersion` on every RunResult and every SARIF document, so a report can name
 * a version no manifest in the repository agrees with, and nothing anywhere would say so.
 *
 * **A test rather than a single source.** Deriving the constant from a manifest at runtime
 * means reading a file from inside a bundle, whose location relative to that manifest
 * depends on how it was built, and it trades a loud failure at commit time for a quiet one
 * at run time. This asserts they agree and fails the moment they do not, which is what the
 * release guard also checks and what nothing checked before.
 *
 * Bump all five together, or this goes red.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MANIFESTS = [
  'package.json',
  'packages/core/package.json',
  'packages/cli/package.json',
  'packages/action/package.json',
] as const;

function versionOf(relativePath: string): string {
  const parsed: unknown = JSON.parse(readFileSync(join(ROOT, relativePath), 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || !('version' in parsed)) {
    throw new Error(`${relativePath} has no version`);
  }

  const version = (parsed as { version: unknown }).version;
  if (typeof version !== 'string') throw new Error(`${relativePath} version is not a string`);
  return version;
}

describe('every version claim agrees', () => {
  it('states the same version in all four manifests', () => {
    const claims = Object.fromEntries(MANIFESTS.map((p) => [p, versionOf(p)]));
    const root = versionOf('package.json');

    expect(claims).toStrictEqual(Object.fromEntries(MANIFESTS.map((p) => [p, root])));
  });

  it('states that version in CLI_VERSION, which is the one users see', () => {
    // `qai --version` and `toolVersion` on every report come from here. A constant that
    // drifted from the manifests would put a version in somebody's SARIF that this
    // repository never released.
    expect(CLI_VERSION).toBe(versionOf('package.json'));
  });

  it('states a version the release workflow will accept', () => {
    // The workflow tags `v${version}` and refuses an input that disagrees with the root
    // manifest, so a version it cannot parse is a release nobody can cut.
    expect(versionOf('package.json')).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
  });
});
