import type { Command } from 'commander';

import type { Stream } from '../reporter.ts';
import { resolveConfigPath, type Flags } from '../settings.ts';
import { runInit } from './init.ts';
import { runValidate } from './validate.ts';

/**
 * Where the command surface is wired to its implementations.
 *
 * **Commands return codes; they do not exit.** Commander's action handlers return
 * nothing useful, so each one records its result in the outcome object and `main` reads
 * it afterwards. That keeps the single place that ends the process in the binary, for
 * the same reason `core` computes an exit code and never applies one: a function that
 * ends the process cannot be tested.
 *
 * Everything a command talks to arrives in `CommandIo`. Nothing here reaches
 * `process.env`, `process.cwd`, or the real streams, so a test states a case instead of
 * mutating the process it is running in.
 */

export interface CommandIo {
  readonly stdout: Stream;
  readonly stderr: Stream;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
}

/** Filled in by whichever command ran, and left empty when none did. */
export interface CommandOutcome {
  code?: number;
}

export function registerCommands(
  program: Command,
  io: CommandIo,
  outcome: CommandOutcome,
): Command {
  program
    .command('init')
    .description('write a starter config, a starter spec, and a .gitignore entry')
    .action(async () => {
      const flags = program.opts<Flags>();
      outcome.code = await runInit({
        cwd: io.cwd,
        // Resolved through the same precedence as everywhere else, so `--config` and
        // QAI_CONFIG decide where the file lands rather than only where it is read from.
        configPath: resolveConfigPath(flags, io.env).value,
        stdout: io.stdout,
        stderr: io.stderr,
      });
    });

  program
    .command('validate')
    .argument('[paths...]', 'spec files or globs, defaulting to spec/*.spec.yaml')
    .description('load the specs and report what they contain and what is wrong with them')
    .action(async (paths: string[]) => {
      const flags = program.opts<Flags>();
      outcome.code = await runValidate({
        cwd: io.cwd,
        paths,
        stdout: io.stdout,
        stderr: io.stderr,
        ...(flags.format === undefined ? {} : { format: flags.format }),
      });
    });

  return program;
}

export { runInit, SPEC_PATH, GITIGNORE_ENTRY, CONFIG_TEMPLATE, SPEC_TEMPLATE } from './init.ts';
export { runValidate, DEFAULT_SPEC_GLOB } from './validate.ts';
