import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isConfigFailure, isLoadFailure, loadConfig, loadSpec } from '@qai/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Stream } from '../reporter.ts';
import { GITIGNORE_ENTRY, SPEC_PATH, runInit } from './init.ts';

/**
 * `init` writes into a real directory, so these tests use a real one.
 *
 * The assertion that matters most is not that files appear. It is that the files it
 * writes load: a starter config that fails to parse or a starter spec that produces
 * authoring warnings would make a user's very first `qai validate` red, through no fault
 * of theirs. Those two tests run the real loaders over the real output.
 */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qai-init-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function capture(): { stream: Stream; text: () => string } {
  const chunks: string[] = [];
  return {
    stream: { write: (chunk: string) => void chunks.push(chunk) },
    text: () => chunks.join(''),
  };
}

async function init(configPath = 'qai.config.yaml') {
  const out = capture();
  const err = capture();
  const code = await runInit({ cwd: dir, configPath, stdout: out.stream, stderr: err.stream });
  return { code, out: out.text(), err: err.text() };
}

function read(name: string): string {
  return readFileSync(join(dir, name), 'utf8');
}

describe('qai init', () => {
  it('writes the config, the starter spec, and the gitignore entry', async () => {
    const { code } = await init();

    expect(code).toBe(0);
    expect(read('qai.config.yaml')).toContain('target:');
    expect(read(SPEC_PATH)).toContain('specVersion:');
    expect(read('.gitignore')).toContain(GITIGNORE_ENTRY);
  });

  it('writes a config the loader accepts', async () => {
    // A starter that does not load is a user's first command failing on a file they did
    // not write.
    await init();

    const loaded = loadConfig('qai.config.yaml', dir);
    expect(isConfigFailure(loaded) ? loaded.error.message : 'loaded').toBe('loaded');
  });

  it('writes a spec the loader accepts with no errors and no warnings', async () => {
    // Warnings included on purpose. An unreferenced actor or an unparseable condition
    // would make the first `qai validate` noisy about a template nobody chose.
    await init();

    const loaded = loadSpec([SPEC_PATH], { cwd: dir });
    expect(isLoadFailure(loaded)).toBe(false);
    if (isLoadFailure(loaded)) throw new Error('unreachable');

    expect(loaded.diagnostics).toStrictEqual([]);
    expect(loaded.spec.requirements.length).toBeGreaterThan(0);
  });

  it('writes a spec whose actors are all referenced by an access rule', async () => {
    // The rule that produces the load warning, asserted directly so the reason is
    // visible rather than buried in a diagnostics count.
    await init();

    const loaded = loadSpec([SPEC_PATH], { cwd: dir });
    if (isLoadFailure(loaded)) throw new Error('unreachable');

    const referenced = new Set(
      loaded.spec.requirements.flatMap((requirement) =>
        requirement.accessRules.map((rule) => rule.actor),
      ),
    );
    for (const actor of loaded.spec.actors) expect(referenced).toContain(actor.id);
  });

  it('never overwrites a config that is already there', async () => {
    // Invariant I7 in the one command that writes. Somebody running init twice in a
    // configured repository must not lose the file they spent an afternoon on.
    writeFileSync(join(dir, 'qai.config.yaml'), 'target:\n  baseUrl: http://mine:9999\n', 'utf8');

    const { code, out } = await init();

    expect(code).toBe(0);
    expect(read('qai.config.yaml')).toContain('http://mine:9999');
    expect(out).toContain('already exists');
  });

  it('never overwrites a starter spec that is already there', async () => {
    mkdirSync(join(dir, 'spec'), { recursive: true });
    writeFileSync(join(dir, SPEC_PATH), '# mine\n', 'utf8');

    await init();

    expect(read(SPEC_PATH)).toBe('# mine\n');
  });

  it('is safe to run twice and says so rather than failing', async () => {
    const first = await init();
    const second = await init();

    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(second.out).toContain('already exists');
  });

  it('appends to an existing gitignore without disturbing it', async () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\ndist/\n', 'utf8');

    await init();

    const gitignore = read('.gitignore');
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('dist/');
    expect(gitignore).toContain(GITIGNORE_ENTRY);
  });

  it('does not add the gitignore entry twice', async () => {
    writeFileSync(join(dir, '.gitignore'), `node_modules/\n${GITIGNORE_ENTRY}\n`, 'utf8');

    await init();

    const occurrences = read('.gitignore').split(GITIGNORE_ENTRY).length - 1;
    expect(occurrences).toBe(1);
  });

  it('ends an existing gitignore with a newline before appending', async () => {
    // A file whose last line has no terminator would otherwise get the entry glued onto
    // it, producing `dist/.qai/` and ignoring neither.
    writeFileSync(join(dir, '.gitignore'), 'dist/', 'utf8');

    await init();

    expect(read('.gitignore')).toContain(`dist/\n`);
    expect(read('.gitignore')).not.toContain(`dist/${GITIGNORE_ENTRY}`);
  });

  it('writes the config where --config points, not always to the default name', async () => {
    await init('config/custom.yaml');

    expect(read('config/custom.yaml')).toContain('target:');
  });

  it('reports what it created on stdout, one line each', async () => {
    const { out } = await init();

    expect(out).toContain('qai.config.yaml');
    expect(out).toContain(SPEC_PATH);
    expect(out).toContain('.gitignore');
  });

  it('names the next command a user should run', async () => {
    // The first thing somebody wants after init is to know it worked.
    expect((await init()).out).toContain('qai validate');
  });

  it('writes no em dash and no credential value', async () => {
    await init();

    const config = read('qai.config.yaml');
    expect(config).not.toContain('—');
    expect(read(SPEC_PATH)).not.toContain('—');
    // Config files name environment variables, never secrets. M2.1 rejects a literal at
    // load time, and a template that taught the habit would be worse than that check.
    expect(config).toContain('tokenEnv:');
    expect(config).not.toMatch(/token:\s*\S/);
  });
});
