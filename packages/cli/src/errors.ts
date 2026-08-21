import type { LoadDiagnostic } from '@qai/core';

import type { Stream } from './reporter.ts';

/**
 * How this tool says something went wrong.
 *
 * **One shape, in one place.** Before this there were nine sites each writing their own,
 * and a user learns the shape of a tool's errors the way they learn its output: by
 * seeing the same thing twice. The module asks for the file, the path within it, the
 * reason, and one suggested fix, and the only way that holds across nine sites is if
 * none of them formats its own.
 *
 * **A stack trace only under `--verbose`.** A trace through this tool's internals tells
 * a user nothing about their spec, and printing one by default trains people to skip
 * error output entirely. Under `--verbose` it is the fastest thing to paste into a bug
 * report, so it is there when asked for.
 *
 * **The code is part of the error, not the caller's afterthought.** 2 is a spec or
 * configuration problem with no run performed and 3 is a target that could not be
 * reached or a run that aborted, per 03-CONTRACTS.md. Carrying it here is what stops a
 * new error path picking 1, which belongs to a completed run with findings.
 */

export interface CliError {
  /** 2 for a spec or configuration problem, 3 for an unreachable target or a fatal. */
  readonly code: 2 | 3;
  /** One line, stating what happened rather than naming a category. */
  readonly summary: string;
  /** Where it happened: a file, a file and a path within it, or a URL. */
  readonly where?: string;
  /** Why, in the words of whatever reported it. */
  readonly reason?: string;
  /** One thing the reader could do next, phrased as an instruction. */
  readonly suggestion?: string;
  /** Kept for `--verbose`. Never printed otherwise. */
  readonly cause?: unknown;
}

export function cliError(error: CliError): CliError {
  return error;
}

/**
 * A spec diagnostic as an error a reader can act on.
 *
 * The suggestion names the path rather than guessing at the fix. A tool that guessed
 * what somebody meant by a malformed requirement would be wrong often enough to be worse
 * than saying where to look.
 */
export function fromDiagnostic(diagnostic: LoadDiagnostic, summary: string): CliError {
  return {
    code: 2,
    summary,
    where: diagnostic.path === '' ? diagnostic.file : `${diagnostic.file}, at ${diagnostic.path}`,
    reason: diagnostic.message,
    suggestion:
      diagnostic.path === ''
        ? `Correct ${diagnostic.file} and run "qai validate" again.`
        : `Correct ${diagnostic.path} in ${diagnostic.file} and run "qai validate" again.`,
  };
}

export interface PresentOptions {
  readonly stderr: Stream;
  readonly verbose?: boolean;
}

/**
 * Writes one error to stderr and returns its exit code, so a caller can `return
 * present(...)` and never hold the number separately from the message.
 */
export function present(error: CliError, options: PresentOptions): 2 | 3 {
  const lines = [`error: ${error.summary}`];

  if (error.where !== undefined) lines.push(`  at ${error.where}`);
  if (error.reason !== undefined) lines.push(`  ${error.reason}`);
  if (error.suggestion !== undefined) lines.push(`  Suggestion: ${error.suggestion}`);

  if (options.verbose === true && error.cause instanceof Error && error.cause.stack !== undefined) {
    lines.push('', error.cause.stack);
  }

  options.stderr.write(`${lines.join('\n')}\n`);
  return error.code;
}

/** Several errors at once, for a spec that failed in more than one place. */
export function presentAll(
  errors: readonly CliError[],
  options: PresentOptions,
  fallback: 2 | 3 = 2,
): 2 | 3 {
  if (errors.length === 0) return fallback;

  let code: 2 | 3 = fallback;
  for (const error of errors) code = present(error, options);
  return code;
}

/** What `resolveContext` returns when it cannot: a bad setting, or a config that will not load. */
export interface ContextErrorLike {
  readonly message: string;
  readonly suggestion?: string;
  readonly diagnostics?: readonly LoadDiagnostic[];
}

/**
 * A failure to resolve the run context, in the one shape.
 *
 * A config that will not load carries diagnostics naming a file and a path, and those
 * are worth more than the summary, so each becomes its own error. A bad setting carries
 * its own suggestion already.
 */
export function presentContextError(error: ContextErrorLike, options: PresentOptions): 2 {
  const diagnostics = error.diagnostics ?? [];

  if (diagnostics.length > 0) {
    presentAll(
      diagnostics.map((diagnostic) => fromDiagnostic(diagnostic, error.message)),
      options,
    );
    return 2;
  }

  present(
    {
      code: 2,
      summary: error.message,
      ...(error.suggestion === undefined ? {} : { suggestion: error.suggestion }),
    },
    options,
  );
  return 2;
}

/**
 * The last resort, for something nobody predicted.
 *
 * Exit 3, because 03-CONTRACTS.md gives that code to a fatal runtime error with the run
 * aborted, and an exception reaching the top is exactly that. Without this the binary
 * ends in a raw stack trace and an exit code Node chose, which for a tool whose exit code
 * is the product is worse than the crash.
 */
export function unexpected(cause: unknown): CliError {
  return {
    code: 3,
    summary: 'the run stopped on an unexpected error',
    reason: cause instanceof Error ? cause.message : String(cause),
    suggestion: 'Run again with --verbose for the full trace, and report it if it persists.',
    cause,
  };
}
