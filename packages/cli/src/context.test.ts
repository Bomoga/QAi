import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { describeContext, isContextError, resolveContext } from './context.ts';

/**
 * Resolution against a real config file on disk, in a temp directory.
 *
 * A hand-built config object would only prove the resolver agrees with something the
 * test invented. What is worth asserting is that a file a user would actually write turns
 * into the settings they expect, including the `defaults` section that M8.2 added to the
 * schema.
 */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qai-context-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const MINIMAL_TARGET = `target:
  baseUrl: http://127.0.0.1:3000
`;

function writeConfig(body: string, name = 'qai.config.yaml'): void {
  writeFileSync(join(dir, name), body, 'utf8');
}

function resolved(flags = {}, env: Record<string, string | undefined> = {}) {
  const result = resolveContext({ flags, env, cwd: dir });
  expect(isContextError(result), 'expected the context to resolve').toBe(false);
  if (isContextError(result)) throw new Error('unreachable');
  return result;
}

describe('resolving the run context', () => {
  it('reads the defaults section a project wrote down', () => {
    writeConfig(`${MINIMAL_TARGET}defaults:
  format: sarif
  failOn: low
  concurrency: 4
`);

    const context = resolved();
    expect(context.settings.format.value).toBe('sarif');
    expect(context.settings.format.source).toBe('config');
    expect(context.settings.failOn.value).toBe('low');
    expect(context.settings.concurrency.value).toBe(4);
  });

  it('lets a flag override what the file said', () => {
    writeConfig(`${MINIMAL_TARGET}defaults:
  format: sarif
`);

    expect(resolved({ format: 'junit' }).settings.format.value).toBe('junit');
  });

  it('treats a missing config file as no config layer rather than as an error', () => {
    // Before `qai init` has run there is no file, and the CLI should still be able to
    // say what it resolved.
    const context = resolved();

    expect(context.configMissing).toBe(true);
    expect(context.config).toBe(undefined);
    expect(context.settings.format.value).toBe('text');
    expect(context.settings.format.source).toBe('default');
  });

  it('reports a config file that exists and will not load', () => {
    // Different fact from an absent one. Reading a malformed config as absent would run
    // against built-in defaults and report on the wrong target.
    writeConfig('target: [this is not a target section]\n');

    const result = resolveContext({ flags: {}, env: {}, cwd: dir });
    expect(isContextError(result)).toBe(true);
  });

  it('refuses an unknown key in the defaults section rather than dropping it', () => {
    // The schema is strict for the reason M1.2 recorded: a misspelled key that is
    // silently ignored is a user believing they configured something they did not.
    writeConfig(`${MINIMAL_TARGET}defaults:
  formats: sarif
`);

    expect(isContextError(resolveContext({ flags: {}, env: {}, cwd: dir }))).toBe(true);
  });

  it('follows the config path a flag names', () => {
    writeConfig(
      `${MINIMAL_TARGET}defaults:
  format: junit
`,
      'other.yaml',
    );

    const context = resolved({ config: 'other.yaml' });
    expect(context.configPath.value).toBe('other.yaml');
    expect(context.configPath.source).toBe('flag');
    expect(context.settings.format.value).toBe('junit');
  });

  it('follows the config path an environment variable names', () => {
    writeConfig(
      `${MINIMAL_TARGET}defaults:
  format: json
`,
      'from-env.yaml',
    );

    const context = resolved({}, { QAI_CONFIG: 'from-env.yaml' });
    expect(context.configPath.source).toBe('environment');
    expect(context.settings.format.value).toBe('json');
  });

  it('reports a config path that was named and is not there', () => {
    // Naming a file that does not exist is a mistake worth surfacing, unlike relying on
    // the default path before one has been created.
    const context = resolved({ config: 'nowhere.yaml' });

    expect(context.configMissing).toBe(true);
    expect(describeContext(context)).toContain('nowhere.yaml');
  });
});

describe('the verbose configuration block', () => {
  it('names each value and the layer it came from', () => {
    writeConfig(`${MINIMAL_TARGET}defaults:
  concurrency: 4
`);

    const printed = describeContext(resolved({ format: 'sarif' }, { QAI_FAIL_ON: 'medium' }));

    expect(printed).toContain('Resolved configuration');
    expect(printed).toContain('sarif');
    expect(printed).toContain('flag');
    expect(printed).toContain('QAI_FAIL_ON');
    expect(printed).toContain('config');
  });

  it('says plainly when there is no config file, rather than leaving it to be inferred', () => {
    const printed = describeContext(resolved());

    expect(printed).toContain('No config file at');
    expect(printed).toContain('qai.config.yaml');
  });

  it('contains no em dash', () => {
    expect(describeContext(resolved())).not.toContain('—');
  });
});
