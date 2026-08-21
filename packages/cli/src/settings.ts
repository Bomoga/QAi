import { DEFAULT_CONFIG_PATH, type DefaultsSection } from '@qai/core';

import { FAIL_ON_SEVERITIES, FORMATS } from './program.ts';

/**
 * Configuration precedence, highest first: command line flag, environment variable,
 * config file, built-in default.
 *
 * **Every setting carries where it came from.** The module asks for the resolved
 * configuration under `--verbose` so a confused user can see what was actually used, and
 * the value alone does not answer that. A user staring at `format: sarif` they did not
 * ask for needs to know it came from `QAI_FORMAT` in their shell profile; the value on
 * its own sends them to the wrong file.
 *
 * **The environment is validated, not trusted.** Rule R2 says every value entering from
 * outside passes a check, and a bad `QAI_FORMAT` that silently fell back to text would
 * hand somebody a report in a shape their pipeline cannot read, with nothing anywhere
 * saying why. It is an error instead.
 *
 * Nothing here reads `process.env`. The environment arrives as an argument, the same way
 * `resolveCredentials` takes it, so a test states a case rather than mutating the
 * process.
 */

export type SettingSource = 'flag' | 'environment' | 'config' | 'default';

export interface Setting<T> {
  readonly value: T;
  readonly source: SettingSource;
  /** The variable that supplied it, when the source was the environment. */
  readonly via?: string;
}

export type Format = (typeof FORMATS)[number];
export type FailOn = (typeof FAIL_ON_SEVERITIES)[number];

export interface Settings {
  readonly format: Setting<Format>;
  readonly out: Setting<string | undefined>;
  readonly failOn: Setting<FailOn>;
  readonly failOnUnverified: Setting<boolean>;
  readonly concurrency: Setting<number>;
}

/** Every variable name derives from the `qai` token, per 00-INDEX.md. */
export const ENV_NAMES = {
  config: 'QAI_CONFIG',
  format: 'QAI_FORMAT',
  out: 'QAI_OUT',
  failOn: 'QAI_FAIL_ON',
  failOnUnverified: 'QAI_FAIL_ON_UNVERIFIED',
  concurrency: 'QAI_CONCURRENCY',
} as const;

/** The built-in layer, which is what a project with no config and no flags gets. */
export const BUILT_IN_DEFAULTS = {
  format: 'text',
  failOn: 'high',
  failOnUnverified: false,
  concurrency: 1,
} as const;

/** Whatever Commander parsed. Every field is optional because every flag is. */
export interface Flags {
  readonly config?: string;
  readonly format?: string;
  readonly out?: string;
  readonly failOn?: string;
  readonly failOnUnverified?: boolean;
  readonly concurrency?: string;
  /** Global flags that are not settings, but that every command reads. */
  readonly verbose?: boolean;
  readonly color?: boolean;
}

export interface SettingsInput {
  readonly flags: Flags;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly defaults: DefaultsSection;
}

/**
 * A refused value, returned rather than thrown.
 *
 * The caller turns this into exit code 2 with a message naming the variable, the value,
 * and one suggested fix, which is what M8.7 formalizes for every error path.
 */
export interface SettingsError {
  readonly kind: 'error';
  readonly message: string;
  readonly suggestion: string;
}

export function isSettingsError(value: Settings | SettingsError): value is SettingsError {
  // Names a member of the union by its discriminant rather than a shape that resembles
  // one. Writing this as a structural check is what cost two typecheck failures at M5.1
  // and M5.9 while the whole suite stayed green.
  return 'kind' in value && value.kind === 'error';
}

/** An empty variable is how a shell spells unset by accident, so it counts as unset. */
function fromEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const raw = env[name];
  return raw === undefined || raw.trim() === '' ? undefined : raw.trim();
}

function refuse(name: string, value: string, allowed: readonly string[]): SettingsError {
  return {
    kind: 'error',
    message: `${name} is set to "${value}", which is not one of ${allowed.join(', ')}.`,
    suggestion: `Set ${name} to one of ${allowed.join(', ')}, or unset it to fall back to the config file.`,
  };
}

/**
 * `QAI_X=0` plainly means off and `QAI_X=` means nothing was set. Reading either as on is
 * the surprise that costs somebody a red build they cannot explain.
 */
function booleanFromEnv(raw: string): boolean {
  return !['0', 'false', 'no', 'off'].includes(raw.toLowerCase());
}

/**
 * The config path, which has only three layers.
 *
 * A file cannot name its own path, so there is no config layer here. Separate from
 * `resolveSettings` because it has to be answered before the file it points at can be
 * read.
 */
export function resolveConfigPath(
  flags: Flags,
  env: Readonly<Record<string, string | undefined>>,
): Setting<string> {
  if (flags.config !== undefined) return { value: flags.config, source: 'flag' };

  const fromEnvironment = fromEnv(env, ENV_NAMES.config);
  if (fromEnvironment !== undefined) {
    return { value: fromEnvironment, source: 'environment', via: ENV_NAMES.config };
  }

  return { value: DEFAULT_CONFIG_PATH, source: 'default' };
}

export function resolveSettings(input: SettingsInput): Settings | SettingsError {
  const { flags, env, defaults } = input;

  const envFormat = fromEnv(env, ENV_NAMES.format);
  if (envFormat !== undefined && !FORMATS.some((known) => known === envFormat)) {
    return refuse(ENV_NAMES.format, envFormat, FORMATS);
  }

  const envFailOn = fromEnv(env, ENV_NAMES.failOn);
  if (envFailOn !== undefined && !FAIL_ON_SEVERITIES.some((known) => known === envFailOn)) {
    return refuse(ENV_NAMES.failOn, envFailOn, FAIL_ON_SEVERITIES);
  }

  const envConcurrency = fromEnv(env, ENV_NAMES.concurrency);
  if (envConcurrency !== undefined && !/^[1-9]\d*$/.test(envConcurrency)) {
    return {
      kind: 'error',
      message: `${ENV_NAMES.concurrency} is set to "${envConcurrency}", which is not a positive whole number.`,
      suggestion: `Set ${ENV_NAMES.concurrency} to a positive whole number, for example 4, or unset it.`,
    };
  }

  const envFailOnUnverified = fromEnv(env, ENV_NAMES.failOnUnverified);
  const envOut = fromEnv(env, ENV_NAMES.out);

  return {
    format: pick<Format>({
      flag: flags.format as Format | undefined,
      env: envFormat as Format | undefined,
      envName: ENV_NAMES.format,
      config: defaults.format,
      fallback: BUILT_IN_DEFAULTS.format,
    }),
    out: pick<string | undefined>({
      flag: flags.out,
      env: envOut,
      envName: ENV_NAMES.out,
      config: defaults.out,
      fallback: undefined,
    }),
    failOn: pick<FailOn>({
      flag: flags.failOn as FailOn | undefined,
      env: envFailOn as FailOn | undefined,
      envName: ENV_NAMES.failOn,
      config: defaults.failOn,
      fallback: BUILT_IN_DEFAULTS.failOn,
    }),
    failOnUnverified: pick<boolean>({
      // Commander leaves an absent switch undefined. Reading that as an explicit false
      // would make the flag layer always win and silence the two layers below it.
      flag: flags.failOnUnverified,
      env: envFailOnUnverified === undefined ? undefined : booleanFromEnv(envFailOnUnverified),
      envName: ENV_NAMES.failOnUnverified,
      config: defaults.failOnUnverified,
      fallback: BUILT_IN_DEFAULTS.failOnUnverified,
    }),
    concurrency: pick<number>({
      flag: flags.concurrency === undefined ? undefined : Number.parseInt(flags.concurrency, 10),
      env: envConcurrency === undefined ? undefined : Number.parseInt(envConcurrency, 10),
      envName: ENV_NAMES.concurrency,
      config: defaults.concurrency,
      fallback: BUILT_IN_DEFAULTS.concurrency,
    }),
  };
}

/** The precedence itself, in one place, so no setting can be wired to a different order. */
function pick<T>(layers: {
  flag: T | undefined;
  env: T | undefined;
  envName: string;
  config: T | undefined;
  fallback: T;
}): Setting<T> {
  if (layers.flag !== undefined) return { value: layers.flag, source: 'flag' };
  if (layers.env !== undefined) {
    return { value: layers.env, source: 'environment', via: layers.envName };
  }
  if (layers.config !== undefined) return { value: layers.config, source: 'config' };
  return { value: layers.fallback, source: 'default' };
}

function describe<T>(name: string, setting: Setting<T>): string {
  // A setting that fell through is shown rather than omitted. Somebody reading this is
  // asking why something happened, and a missing line makes them guess whether the
  // setting exists at all.
  const value = setting.value === undefined ? 'not set' : String(setting.value);
  const from = setting.via === undefined ? setting.source : `${setting.source} ${setting.via}`;
  // Wide enough for the longest name plus a space. `fail-on-unverified` is exactly
  // eighteen characters, so a column of eighteen ran its name into its value.
  return `  ${name.padEnd(21)}${value.padEnd(24)}${from}`;
}

/**
 * The resolved configuration, for `--verbose`. Written to stderr by the caller, since
 * stdout carries the report.
 */
export function formatSettings(settings: Settings, configPath: Setting<string>): string {
  return [
    'Resolved configuration',
    describe('config', configPath),
    describe('format', settings.format),
    describe('out', settings.out),
    describe('fail-on', settings.failOn),
    describe('fail-on-unverified', settings.failOnUnverified),
    describe('concurrency', settings.concurrency),
    '',
  ].join('\n');
}
