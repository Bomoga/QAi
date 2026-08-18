import { createProgram } from './program.ts';

/**
 * Public API of @qai/cli, which is its command surface.
 *
 * Present: the program, its global flags, and the reporter `core` is given.
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
export async function main(argv: readonly string[]): Promise<number> {
  const program = createProgram();

  try {
    await program.parseAsync([...argv]);
  } catch (error) {
    if (isCommanderError(error) && BENIGN_COMMANDER_CODES.has(error.code ?? '')) return 0;
    if (isCommanderError(error)) return 2;
    throw error;
  }

  return 0;
}

export type { Reporter } from '@qai/core';
