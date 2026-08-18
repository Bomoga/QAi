import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { main } from './index.ts';
import type { Stream } from './reporter.ts';

/**
 * `--verbose` end to end through `main`, with every stream and the environment injected.
 *
 * The rule these are really defending is the same one the reporter tests defend: the
 * resolved configuration is diagnostics, so it goes to stderr. A user running
 * `qai check --format json --verbose | jq` has to get a clean document, and a
 * configuration block on stdout breaks that quietly.
 */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qai-verbose-'));
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

async function run(
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
): Promise<{ code: number; out: string; err: string }> {
  const out = capture();
  const err = capture();
  const code = await main(['node', 'qai', ...argv], {
    stdout: out.stream,
    stderr: err.stream,
    env,
    cwd: dir,
  });
  return { code, out: out.text(), err: err.text() };
}

describe('the verbose configuration output', () => {
  it('prints nothing without the flag', async () => {
    const { code, out, err } = await run([]);

    expect(code).toBe(0);
    expect(out).toBe('');
    expect(err).toBe('');
  });

  it('prints the resolved configuration to stderr and nothing to stdout', async () => {
    const { code, out, err } = await run(['--verbose']);

    expect(code).toBe(0);
    expect(out).toBe('');
    expect(err).toContain('Resolved configuration');
  });

  it('names the layer each value came from', async () => {
    writeFileSync(
      join(dir, 'qai.config.yaml'),
      'target:\n  baseUrl: http://127.0.0.1:3000\ndefaults:\n  concurrency: 4\n',
      'utf8',
    );

    const { err } = await run(['--verbose', '--format', 'sarif'], { QAI_FAIL_ON: 'medium' });

    expect(err).toContain('sarif');
    expect(err).toContain('flag');
    expect(err).toContain('QAI_FAIL_ON');
    expect(err).toContain('config');
  });

  it('exits 2 and says why when an environment value is outside its closed set', async () => {
    // Rule R2. A silent fallback would hand somebody a report in a shape their pipeline
    // cannot read, with nothing saying why.
    const { code, err, out } = await run(['--verbose'], { QAI_FORMAT: 'xml' });

    expect(code).toBe(2);
    expect(err).toContain('QAI_FORMAT');
    expect(err).toContain('xml');
    expect(out).toBe('');
  });

  it('exits 2 when the named config file exists and will not load', async () => {
    writeFileSync(join(dir, 'qai.config.yaml'), 'target: [not a section]\n', 'utf8');

    const { code, err } = await run([]);

    expect(code).toBe(2);
    expect(err).toContain('error:');
  });

  it('exits 0 with no config file at all, since that is normal before init', async () => {
    const { code, err } = await run(['--verbose']);

    expect(code).toBe(0);
    expect(err).toContain('No config file at');
  });
});
