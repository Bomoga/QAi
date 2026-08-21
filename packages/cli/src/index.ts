import process from 'node:process';

import { registerCommands, type CommandOutcome } from './commands/index.ts';
import { describeContext, isContextError, resolveContext } from './context.ts';
import { present, presentContextError, unexpected } from './errors.ts';
import { createProgram } from './program.ts';
import type { Flags } from './settings.ts';
import type { Stream } from './reporter.ts';

/**
 * Public API of @qai/cli, which is its command surface.
 *
 * Present: the program, its global flags, configuration precedence, and the reporter
 * `core` is given.
 * Pending: `init`, `validate`, `probe`, `check`, and `report`, which land at M8.3
 * through M8.6, and `diff`, which needs M6 and lands in S7.
 */
export {
  createProgram,
  CLI_VERSION,
  FORMATS,
  FAIL_ON_SEVERITIES,
  GLOBAL_FLAGS,
} from './program.ts';
export { createReporter, type Stream, type ReporterOptions } from './reporter.ts';
export {
  present,
  presentAll,
  presentContextError,
  fromDiagnostic,
  unexpected,
  cliError,
  type CliError,
} from './errors.ts';
export {
  resolveSettings,
  resolveConfigPath,
  formatSettings,
  isSettingsError,
  ENV_NAMES,
  BUILT_IN_DEFAULTS,
  type Settings,
  type Setting,
  type SettingSource,
  type SettingsError,
  type Flags,
  type Format,
  type FailOn,
} from './settings.ts';
export {
  resolveContext,
  describeContext,
  isContextError,
  type Context,
  type ContextError,
} from './context.ts';
export {
  registerCommands,
  runInit,
  runValidate,
  runCheck,
  runProbe,
  DEFAULT_SPEC_GLOB,
  SPEC_PATH,
  GITIGNORE_ENTRY,
  type CommandIo,
  type CommandOutcome,
} from './commands/index.ts';

/**
 * Commander's own terminations that are not failures.
 *
 * `exitOverride` makes Commander throw for everything, including `--help` and
 * `--version`, which have already printed what the user asked for by the time the throw
 * arrives. Without this list `qai --help` ends in a stack trace.
 */
const BENIGN_COMMANDER_CODES = new Set([
  'commander.help',
  'commander.helpDisplayed',
  'commander.version',
]);

function isCommanderError(error: unknown): error is Error & { code?: string; exitCode?: number } {
  return error instanceof Error && error.name === 'CommanderError';
}

/**
 * What `main` talks to, so a test can supply all of it.
 *
 * The environment arrives as an argument for the same reason `core` takes one: a
 * function that reads `process.env` cannot be tested twice with two different
 * environments. The defaults point at the real process, so the binary passes nothing.
 */
export interface MainOptions {
  readonly stdout?: Stream;
  readonly stderr?: Stream;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  /** Whether each stream is a terminal. The binary knows; nothing else sniffs for it. */
  readonly stderrTty?: boolean;
  readonly stdoutTty?: boolean;
}

/**
 * The entry point the binary calls.
 *
 * It takes `argv` rather than reading `process.argv` so a test can drive it, and it
 * returns the exit code rather than applying it, for the same reason `core` computes one
 * and never exits: a function that ends the process cannot be called twice. The binary
 * turns the number into an exit.
 *
 * **A usage error is 2, not 1.** Commander's own default for a bad flag is 1, and 1 is
 * already spoken for: 03-CONTRACTS.md gives it to a run that completed and found
 * something at or above the threshold. A misspelled flag exiting 1 would tell CI the
 * application has findings, which is the worst available lie. 2 is the code for a
 * configuration error and a bad invocation is one.
 *
 * Presenting that error in this project's voice, naming the file, the path, the reason,
 * and one suggested fix, is M8.7. Until then Commander's own wording reaches the user.
 */
export async function main(argv: readonly string[], options: MainOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();

  const program = createProgram();
  const outcome: CommandOutcome = {};
  registerCommands(
    program,
    {
      stdout,
      stderr,
      env,
      cwd,
      stderrTty: options.stderrTty ?? false,
      stdoutTty: options.stdoutTty ?? false,
    },
    outcome,
  );

  try {
    await program.parseAsync([...argv]);
  } catch (error) {
    if (isCommanderError(error) && BENIGN_COMMANDER_CODES.has(error.code ?? '')) return 0;
    if (isCommanderError(error)) {
      // Commander has already printed its own usage message by this point, so repeating
      // it in this project's voice would say the same thing twice.
      return 2;
    }

    // Anything else reaching here is a fatal runtime error, which 03-CONTRACTS.md gives
    // code 3. Without this the binary ends in a raw trace and whatever code Node chose,
    // and for a tool whose exit code is the product that is worse than the crash.
    return present(unexpected(error), {
      stderr,
      ...(argv.includes('--verbose') ? { verbose: true } : {}),
    });
  }

  // A command that ran owns the outcome. `init` writes files and reports on them, and
  // resolving settings afterwards would be work nobody asked for.
  if (outcome.code !== undefined) return outcome.code;

  const flags = program.opts<Flags>();
  const context = resolveContext({ flags, env, cwd });

  if (isContextError(context)) {
    return presentContextError(context, {
      stderr,
      ...(flags.verbose === true ? { verbose: true } : {}),
    });
  }

  // Written to stderr, not stdout, because stdout carries the report. A user piping a
  // report somewhere and passing --verbose should still get a clean document.
  if (flags.verbose === true) {
    stderr.write(describeContext(context));
    return 0;
  }

  // No subcommand and nothing asked for. Help is what every other tool does here, and
  // it is better than succeeding silently, which reads as though something ran.
  stdout.write(program.helpInformation());
  return 0;
}

export type { Reporter } from '@qai/core';
