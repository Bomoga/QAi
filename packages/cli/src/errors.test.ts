import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, afterEach, beforeEach } from 'vitest';

import { main } from './index.ts';
import { fromDiagnostic, present, presentAll, unexpected } from './errors.ts';
import type { Stream } from './reporter.ts';

/**
 * The Definition of Done says a malformed spec exits 2 with a message naming file, path,
 * reason, and a suggested fix, and no stack trace. That sentence is four assertions and
 * a negative, so it is tested as five.
 */
function capture(): { stream: Stream; text: () => string } {
  const chunks: string[] = [];
  return {
    stream: { write: (chunk: string) => void chunks.push(chunk) },
    text: () => chunks.join(''),
  };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qai-errors-'));
  mkdirSync(join(dir, 'spec'), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  const out = capture();
  const err = capture();
  const code = await main(['node', 'qai', ...argv], {
    stdout: out.stream,
    stderr: err.stream,
    env: {},
    cwd: dir,
  });
  return { code, out: out.text(), err: err.text() };
}

describe('presenting one error', () => {
  it('leads with the summary and indents everything under it', () => {
    const err = capture();
    present(
      {
        code: 2,
        summary: 'the target has no base URL',
        where: 'qai.config.yaml, at target.baseUrl',
        reason: 'A check issues requests.',
        suggestion: 'Set target.baseUrl.',
      },
      { stderr: err.stream },
    );

    const lines = err.text().trimEnd().split('\n');
    expect(lines[0]).toBe('error: the target has no base URL');
    expect(lines[1]).toBe('  at qai.config.yaml, at target.baseUrl');
    expect(lines[2]).toBe('  A check issues requests.');
    expect(lines[3]).toBe('  Suggestion: Set target.baseUrl.');
  });

  it('returns the code it carries, so a caller cannot pair the wrong one with a message', () => {
    const err = capture();

    expect(present({ code: 2, summary: 'a' }, { stderr: err.stream })).toBe(2);
    expect(present({ code: 3, summary: 'b' }, { stderr: err.stream })).toBe(3);
  });

  it('omits the parts an error does not carry rather than printing empty labels', () => {
    const err = capture();
    present({ code: 2, summary: 'just this' }, { stderr: err.stream });

    expect(err.text()).toBe('error: just this\n');
  });

  it('hides the stack trace by default and shows it under verbose', () => {
    // A trace through this tool's internals tells a user nothing about their spec, and
    // printing one by default trains people to skip error output entirely.
    const cause = new Error('the underlying thing');
    const quiet = capture();
    const loud = capture();

    present({ code: 3, summary: 'broken', cause }, { stderr: quiet.stream });
    present({ code: 3, summary: 'broken', cause }, { stderr: loud.stream, verbose: true });

    expect(quiet.text()).not.toContain('at ');
    expect(quiet.text()).not.toContain('errors.test');
    expect(loud.text()).toContain('Error: the underlying thing');
  });

  it('turns a diagnostic into a file, a path, a reason, and a fix', () => {
    const err = capture();
    present(
      fromDiagnostic(
        {
          severity: 'error',
          file: 'spec/app.spec.yaml',
          path: 'requirements[0].accessRules[1].effect',
          message: 'expected one of allow, deny',
        },
        '1 problem in the spec',
      ),
      { stderr: err.stream },
    );

    const text = err.text();
    expect(text).toContain('spec/app.spec.yaml');
    expect(text).toContain('requirements[0].accessRules[1].effect');
    expect(text).toContain('expected one of allow, deny');
    expect(text).toContain('Suggestion:');
  });

  it('does not name a path in the suggestion when the diagnostic has none', () => {
    const err = capture();
    present(
      fromDiagnostic(
        { severity: 'error', file: 'spec/app.spec.yaml', path: '', message: 'the file is empty' },
        'could not load',
      ),
      { stderr: err.stream },
    );

    expect(err.text()).toContain('Correct spec/app.spec.yaml');
  });

  it('reports every problem rather than only the first', () => {
    // A spec with four mistakes should cost one run, not four.
    const err = capture();
    const code = presentAll(
      [
        { code: 2, summary: 'one' },
        { code: 2, summary: 'two' },
      ],
      { stderr: err.stream },
    );

    expect(code).toBe(2);
    expect(err.text()).toContain('one');
    expect(err.text()).toContain('two');
  });

  it('gives an unexpected throw code 3 and a way to get the detail', () => {
    // 03-CONTRACTS.md gives 3 to a fatal runtime error with the run aborted, and an
    // exception reaching the top is exactly that.
    const error = unexpected(new Error('boom'));

    expect(error.code).toBe(3);
    expect(error.reason).toBe('boom');
    expect(error.suggestion).toContain('--verbose');
  });
});

describe('a malformed spec, end to end', () => {
  const MALFORMED = ["specVersion: '0.1'", "name: 'Broken'", 'requirements: not-a-list', ''].join(
    '\n',
  );

  it('exits 2 naming the file, the path, the reason, and a fix, with no stack trace', async () => {
    writeFileSync(join(dir, 'spec', 'app.spec.yaml'), MALFORMED, 'utf8');

    const { code, err, out } = await run(['validate']);

    expect(code).toBe(2);
    expect(err).toContain('spec/app.spec.yaml');
    expect(err).toContain('requirements');
    expect(err).toContain('Suggestion:');
    // The negative half of the Definition of Done sentence.
    expect(err).not.toContain('    at ');
    expect(err).not.toContain('node:internal');
    expect(out).toBe('');
  });

  it('shows the same error under verbose without changing the exit code', async () => {
    writeFileSync(join(dir, 'spec', 'app.spec.yaml'), MALFORMED, 'utf8');

    const { code, err } = await run(['validate', '--verbose']);

    expect(code).toBe(2);
    expect(err).toContain('Suggestion:');
  });

  it('says where it looked when no spec matched at all', async () => {
    const { code, err } = await run(['validate']);

    expect(code).toBe(2);
    expect(err).toContain('spec/*.spec.yaml');
    expect(err).toContain('Suggestion:');
  });

  it('contains no em dash', async () => {
    writeFileSync(join(dir, 'spec', 'app.spec.yaml'), MALFORMED, 'utf8');

    expect((await run(['validate'])).err).not.toContain('—');
  });
});
