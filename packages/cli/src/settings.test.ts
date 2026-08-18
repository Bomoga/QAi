import { describe, expect, it } from 'vitest';

import {
  ENV_NAMES,
  formatSettings,
  isSettingsError,
  resolveConfigPath,
  resolveSettings,
} from './settings.ts';

/**
 * Precedence, which is the whole of this task: flag, then environment variable, then
 * config file, then built-in default.
 *
 * The tests set all four layers at once wherever they can, because a resolver that reads
 * only the layer a test supplies passes every single-layer test and still gets the order
 * wrong.
 */
const ALL_LAYERS = {
  flags: { format: 'junit' },
  env: { QAI_FORMAT: 'sarif' },
  defaults: { format: 'json' as const },
};

function resolved(input: Parameters<typeof resolveSettings>[0]) {
  const result = resolveSettings(input);
  expect(isSettingsError(result), 'expected the settings to resolve').toBe(false);
  if (isSettingsError(result)) throw new Error('unreachable');
  return result;
}

describe('resolving run settings', () => {
  it('prefers a flag over everything below it', () => {
    const settings = resolved(ALL_LAYERS);

    expect(settings.format.value).toBe('junit');
    expect(settings.format.source).toBe('flag');
  });

  it('prefers an environment variable over the config file and the default', () => {
    const settings = resolved({ flags: {}, env: ALL_LAYERS.env, defaults: ALL_LAYERS.defaults });

    expect(settings.format.value).toBe('sarif');
    expect(settings.format.source).toBe('environment');
  });

  it('prefers the config file over the built-in default', () => {
    const settings = resolved({ flags: {}, env: {}, defaults: ALL_LAYERS.defaults });

    expect(settings.format.value).toBe('json');
    expect(settings.format.source).toBe('config');
  });

  it('falls back to the built-in default when no layer says anything', () => {
    const settings = resolved({ flags: {}, env: {}, defaults: {} });

    expect(settings.format.value).toBe('text');
    expect(settings.format.source).toBe('default');
    expect(settings.failOn.value).toBe('high');
    expect(settings.failOnUnverified.value).toBe(false);
    expect(settings.concurrency.value).toBe(1);
  });

  it('resolves every setting through the same four layers', () => {
    // One assertion per setting would let a setting be wired to the wrong layer and still
    // pass, as long as the test only ever set that layer.
    const settings = resolved({
      flags: { failOn: 'low', out: 'from-flag.json' },
      env: { QAI_FAIL_ON: 'medium', QAI_OUT: 'from-env.json', QAI_CONCURRENCY: '8' },
      defaults: { failOn: 'high', out: 'from-config.json', concurrency: 2, failOnUnverified: true },
    });

    expect([settings.failOn.value, settings.failOn.source]).toStrictEqual(['low', 'flag']);
    expect([settings.out.value, settings.out.source]).toStrictEqual(['from-flag.json', 'flag']);
    expect([settings.concurrency.value, settings.concurrency.source]).toStrictEqual([
      8,
      'environment',
    ]);
    expect([settings.failOnUnverified.value, settings.failOnUnverified.source]).toStrictEqual([
      true,
      'config',
    ]);
  });

  it('treats an absent switch as unset rather than as false', () => {
    // Commander leaves a switch undefined when it is absent. Reading that as an explicit
    // false would make the flag layer always win and silence the two layers below it.
    const settings = resolved({
      flags: { failOnUnverified: undefined },
      env: {},
      defaults: { failOnUnverified: true },
    });

    expect(settings.failOnUnverified.value).toBe(true);
    expect(settings.failOnUnverified.source).toBe('config');
  });

  it('reads a switch from the environment by its truth, not its presence', () => {
    // An empty variable is how a shell spells "unset" by accident, and `QAI_X=0` plainly
    // means off. Treating either as on is the surprise that costs a user a red build.
    const on = resolved({ flags: {}, env: { QAI_FAIL_ON_UNVERIFIED: 'true' }, defaults: {} });
    const off = resolved({ flags: {}, env: { QAI_FAIL_ON_UNVERIFIED: '0' }, defaults: {} });
    const blank = resolved({ flags: {}, env: { QAI_FAIL_ON_UNVERIFIED: '' }, defaults: {} });

    expect(on.failOnUnverified.value).toBe(true);
    expect(off.failOnUnverified.value).toBe(false);
    expect(blank.failOnUnverified.source).toBe('default');
  });

  it('refuses an environment value outside the closed set rather than falling back', () => {
    // Rule R2: every value entering from the environment is validated. A silent fallback
    // would produce a report in a shape the user did not ask for and did not notice.
    const result = resolveSettings({ flags: {}, env: { QAI_FORMAT: 'xml' }, defaults: {} });

    expect(isSettingsError(result)).toBe(true);
    if (!isSettingsError(result)) throw new Error('unreachable');
    expect(result.message).toContain('QAI_FORMAT');
    expect(result.message).toContain('xml');
    expect(result.suggestion).toContain('text');
  });

  it('refuses a concurrency that is not a positive whole number', () => {
    for (const value of ['0', '-1', 'four', '2.5', '']) {
      const result = resolveSettings({ flags: {}, env: { QAI_CONCURRENCY: value }, defaults: {} });
      if (value === '') {
        // Empty is unset, not invalid.
        expect(isSettingsError(result)).toBe(false);
        continue;
      }
      expect(isSettingsError(result), `expected ${value} to be refused`).toBe(true);
    }
  });

  it('names every environment variable after the qai token', () => {
    // 00-INDEX.md says every identifier derives from that one token so a rename stays
    // mechanical.
    for (const name of Object.values(ENV_NAMES)) expect(name.startsWith('QAI_')).toBe(true);
  });

  it('resolves the config path from the flag and the environment only', () => {
    // A file cannot name its own path, so there is no config layer for this one.
    expect(resolveConfigPath({ config: 'flag.yaml' }, { QAI_CONFIG: 'env.yaml' })).toStrictEqual({
      value: 'flag.yaml',
      source: 'flag',
    });
    expect(resolveConfigPath({}, { QAI_CONFIG: 'env.yaml' })).toStrictEqual({
      value: 'env.yaml',
      source: 'environment',
      // Named, so `--verbose` can send the reader to the variable rather than to a file
      // that turns out to say nothing about it.
      via: 'QAI_CONFIG',
    });
    expect(resolveConfigPath({}, {})).toStrictEqual({
      value: 'qai.config.yaml',
      source: 'default',
    });
  });
});

describe('printing the resolved configuration', () => {
  it('names every setting, its value, and the layer it came from', () => {
    // The module asks for this so a confused user can see what was actually used, and the
    // layer is the part that ends the confusion.
    const printed = formatSettings(
      resolved({
        flags: { format: 'sarif' },
        env: { QAI_FAIL_ON: 'low' },
        defaults: { concurrency: 4 },
      }),
      { value: 'qai.config.yaml', source: 'default' },
    );

    expect(printed).toContain('format');
    expect(printed).toContain('sarif');
    expect(printed).toContain('flag');
    expect(printed).toContain('QAI_FAIL_ON');
    expect(printed).toContain('config');
    expect(printed).toContain('qai.config.yaml');
  });

  it('shows a setting that fell through to its default rather than hiding it', () => {
    // A user reading this is asking why something happened. An omitted line makes them
    // guess whether the setting exists at all.
    const printed = formatSettings(resolved({ flags: {}, env: {}, defaults: {} }), {
      value: 'qai.config.yaml',
      source: 'default',
    });

    expect(printed).toContain('out');
    expect(printed).toContain('not set');
    expect(printed).toContain('default');
  });

  it('contains no em dash', () => {
    const printed = formatSettings(resolved({ flags: {}, env: {}, defaults: {} }), {
      value: 'qai.config.yaml',
      source: 'default',
    });

    expect(printed).not.toContain('—');
  });
});
