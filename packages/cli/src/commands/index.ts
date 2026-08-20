import type { Command } from 'commander';

import { createReporter, type Stream } from '../reporter.ts';
import { describeContext, isContextError, resolveContext } from '../context.ts';
import { presentContextError } from '../errors.ts';
import { positiveInteger } from '../program.ts';
import { resolveConfigPath, type Flags } from '../settings.ts';
import { runCheck } from './check.ts';
import { runDiff } from './diff.ts';
import { runInit } from './init.ts';
import { runProbe } from './probe.ts';
import { runReport } from './report.ts';
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
  /**
   * Whether each stream is a terminal. Two answers, not one: progress goes to stderr
   * and the report goes to stdout, and piping one does not pipe the other. Passed in
   * rather than sniffed, per rule R6.
   */
  readonly stderrTty?: boolean;
  readonly stdoutTty?: boolean;
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
        ...(flags.verbose === true ? { verbose: true } : {}),
      });
    });

  program
    .command('check')
    .argument('[paths...]', 'spec files or globs, defaulting to spec/*.spec.yaml')
    .description('probe the target, run the checks, and report where it disagrees with the spec')
    .action(async (paths: string[]) => {
      const flags = program.opts<Flags>();
      const context = resolveContext({ flags, env: io.env, cwd: io.cwd });

      if (isContextError(context)) {
        outcome.code = presentContextError(context, {
          stderr: io.stderr,
          ...(flags.verbose === true ? { verbose: true } : {}),
        });
        return;
      }

      if (flags.verbose === true) io.stderr.write(describeContext(context));

      outcome.code = await runCheck({
        cwd: io.cwd,
        env: io.env,
        paths,
        ...(context.config === undefined ? { config: undefined } : { config: context.config }),
        configPath: context.configPath.value,
        settings: context.settings,
        stdout: io.stdout,
        stderr: io.stderr,
        color: flags.color !== false && io.stdoutTty === true,
        ...(flags.verbose === true ? { verbose: true } : {}),
        reporter: createReporter({
          stdout: io.stdout,
          stderr: io.stderr,
          tty: io.stderrTty === true,
          ...(flags.color === false ? { color: false } : {}),
        }),
      });
    });

  program
    .command('probe')
    .argument('[paths...]', 'spec files or globs, read only for the sensitive field list')
    .description('describe what the target actually contains, judging nothing')
    .action(async (paths: string[]) => {
      const flags = program.opts<Flags>();
      const context = resolveContext({ flags, env: io.env, cwd: io.cwd });

      if (isContextError(context)) {
        outcome.code = presentContextError(context, {
          stderr: io.stderr,
          ...(flags.verbose === true ? { verbose: true } : {}),
        });
        return;
      }

      if (flags.verbose === true) io.stderr.write(describeContext(context));

      outcome.code = await runProbe({
        cwd: io.cwd,
        env: io.env,
        paths,
        ...(context.config === undefined ? { config: undefined } : { config: context.config }),
        configPath: context.configPath.value,
        settings: context.settings,
        stdout: io.stdout,
        stderr: io.stderr,
        ...(flags.verbose === true ? { verbose: true } : {}),
        reporter: createReporter({
          stdout: io.stdout,
          stderr: io.stderr,
          tty: io.stderrTty === true,
          ...(flags.color === false ? { color: false } : {}),
        }),
      });
    });

  program
    .command('report')
    .argument('<runId>', 'a run id the store holds, for example RUN-20260820-143012')
    .description('render a stored run again, in any format')
    .action((runId: string) => {
      const flags = program.opts<Flags>();
      const context = resolveContext({ flags, env: io.env, cwd: io.cwd });

      if (isContextError(context)) {
        outcome.code = presentContextError(context, {
          stderr: io.stderr,
          ...(flags.verbose === true ? { verbose: true } : {}),
        });
        return;
      }

      if (flags.verbose === true) io.stderr.write(describeContext(context));

      outcome.code = runReport({
        cwd: io.cwd,
        runId,
        settings: context.settings,
        stdout: io.stdout,
        stderr: io.stderr,
        color: flags.color !== false && io.stdoutTty === true,
        ...(flags.verbose === true ? { verbose: true } : {}),
      });
    });

  program
    .command('diff')
    .argument('[runs...]', 'two run ids, oldest first, or none to compare the most recent two')
    .option(
      '--last <n>',
      'compare the newest run with the nth most recent, defaulting to the one before it',
      positiveInteger,
    )
    .description('report what changed about the application between two runs')
    .action((runs: string[], commandFlags: { last?: string }) => {
      const flags = program.opts<Flags>();
      const context = resolveContext({ flags, env: io.env, cwd: io.cwd });

      if (isContextError(context)) {
        outcome.code = presentContextError(context, {
          stderr: io.stderr,
          ...(flags.verbose === true ? { verbose: true } : {}),
        });
        return;
      }

      if (flags.verbose === true) io.stderr.write(describeContext(context));

      outcome.code = runDiff({
        cwd: io.cwd,
        runs,
        ...(commandFlags.last === undefined ? {} : { last: Number(commandFlags.last) }),
        settings: context.settings,
        stdout: io.stdout,
        stderr: io.stderr,
        ...(flags.verbose === true ? { verbose: true } : {}),
      });
    });

  return program;
}

export { runInit, SPEC_PATH, GITIGNORE_ENTRY, CONFIG_TEMPLATE, SPEC_TEMPLATE } from './init.ts';
export { runValidate, DEFAULT_SPEC_GLOB } from './validate.ts';
export { runCheck, type CheckOptions } from './check.ts';
export { runProbe, type ProbeOptions } from './probe.ts';
export { runReport, renderStoredRun, type ReportOptions } from './report.ts';
export { runDiff, DEFAULT_LAST, type DiffOptions } from './diff.ts';
