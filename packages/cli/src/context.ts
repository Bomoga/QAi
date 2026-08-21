import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { isConfigFailure, loadConfig, type ConfigError, type TargetConfig } from '@qai/core';

import {
  formatSettings,
  isSettingsError,
  resolveConfigPath,
  resolveSettings,
  type Flags,
  type Setting,
  type Settings,
  type SettingsError,
} from './settings.ts';

/**
 * Everything a command needs before it starts: where the config is, what it said, and
 * what the four layers of precedence resolved to.
 *
 * **A missing config file is not an error here.** `loadConfig` reports an unreadable file
 * and an absent one identically, both as "could not read", which is right for a command
 * that needs a target and wrong for resolving settings. Before `qai init` has ever run
 * there is no file, and `qai --verbose` should still be able to say what it resolved.
 * Whether a command can proceed without one is that command's question; this one only
 * answers what the configuration is.
 *
 * A file that exists and will not load is a different fact and is returned as an error.
 * Silently treating a malformed config as an absent one would run a check against
 * built-in defaults and report on the wrong target.
 */

export interface ContextInput {
  readonly flags: Flags;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
}

export interface Context {
  readonly settings: Settings;
  readonly configPath: Setting<string>;
  /** Absent when no config file exists yet, which is a normal state before `qai init`. */
  readonly config?: TargetConfig;
  /** True when the resolved path names a file that is not there. */
  readonly configMissing: boolean;
}

export type ContextError = SettingsError | (ConfigError & { readonly suggestion?: string });

export function isContextError(value: Context | ContextError): value is ContextError {
  // Names the union member by its discriminant. A structural check is what cost two
  // typecheck failures at M5.1 and M5.9 while the suite stayed green.
  return 'kind' in value && value.kind === 'error';
}

export function resolveContext(input: ContextInput): Context | ContextError {
  const configPath = resolveConfigPath(input.flags, input.env);
  const absolute = isAbsolute(configPath.value)
    ? configPath.value
    : resolve(input.cwd, configPath.value);

  const configMissing = !existsSync(absolute);

  let config: TargetConfig | undefined;
  if (!configMissing) {
    const loaded = loadConfig(configPath.value, input.cwd);
    if (isConfigFailure(loaded)) return loaded.error;
    config = loaded.config;
  }

  const settings = resolveSettings({
    flags: input.flags,
    env: input.env,
    defaults: config?.defaults ?? {},
  });
  if (isSettingsError(settings)) return settings;

  return {
    settings,
    configPath,
    ...(config === undefined ? {} : { config }),
    configMissing,
  };
}

/**
 * The `--verbose` block, for stderr.
 *
 * It says when the config file is absent rather than leaving the reader to infer it from
 * a set of values that all happen to say `default`. That inference is exactly the
 * confusion the flag exists to end.
 */
export function describeContext(context: Context): string {
  const settings = formatSettings(context.settings, context.configPath);
  if (!context.configMissing) return settings;

  return `${settings}  No config file at ${context.configPath.value}, so nothing was read from one.\n`;
}
