import { Command, InvalidArgumentError, Option } from 'commander';

/**
 * The command surface, which is the public API of this package.
 *
 * Nothing here verifies anything. 03-CONTRACTS.md pins the exit codes and M7 computes
 * the 0 or 1; this file parses arguments and the command implementations that follow
 * apply what `core` decided. If a behavior can be tested without a terminal it belongs
 * in `core`, and the test file next door is the check on whether that held.
 *
 * **`exitOverride` is set deliberately.** Commander's default is to print its own
 * message and call `process.exit`, which would take a test runner with it and would
 * leave M8.7 no way to present an error in this project's voice, naming the file, the
 * path within it, the reason, and one suggested fix. Throwing instead puts that decision
 * one level up where it belongs.
 */

/** The version the binary reports. Kept here so the help text and the tests agree. */
export const CLI_VERSION = '0.1.0';

/** The four the emitters in M7 can produce, and nothing else. */
export const FORMATS = ['text', 'json', 'sarif', 'junit'] as const;

/**
 * The severities `--fail-on` accepts.
 *
 * `info` is deliberately absent although `Severity` has it. The module's flag list stops
 * at low, and a threshold of `info` would be a request to fail on anything at all, which
 * is better spelled as a policy decision than as a severity.
 */
export const FAIL_ON_SEVERITIES = ['high', 'medium', 'low'] as const;

/**
 * Every global flag, as a list, so a test can assert the surface rather than checking
 * them one at a time and quietly missing one that got dropped.
 */
export const GLOBAL_FLAGS = [
  '--config',
  '--format',
  '--out',
  '--fail-on',
  '--fail-on-unverified',
  '--concurrency',
  '--no-color',
  '--verbose',
] as const;

/**
 * A positive integer, refused rather than coerced.
 *
 * `Number.parseInt` turns `"4x"` into 4 and `"x"` into `NaN`, and a concurrency of `NaN`
 * would surface much later as a run that does nothing, blamed on the target.
 */
function positiveInteger(value: string): string {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new InvalidArgumentError('expected a positive whole number, for example 4');
  }
  return value;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('qai')
    .description(
      'Checks that an application does what its spec said it would, and reports where they disagree.',
    )
    .version(CLI_VERSION)
    // Throw instead of exiting. See the note above.
    .exitOverride()
    // An unknown flag is a user believing they configured something they did not, so it
    // is an error rather than something to pass through.
    .allowUnknownOption(false)
    .allowExcessArguments(false);

  program
    .option('--config <path>', 'path to qai.config.yaml')
    .addOption(
      new Option('--format <format>', 'output format for the report').choices([...FORMATS]),
    )
    .option('--out <path>', 'write the report to a file instead of stdout')
    .addOption(
      new Option('--fail-on <severity>', 'lowest finding severity that makes the run fail').choices(
        [...FAIL_ON_SEVERITIES],
      ),
    )
    .option('--fail-on-unverified', 'treat a requirement nobody could check as a failure')
    .option('--concurrency <n>', 'how many checks to run at once', positiveInteger)
    // Commander turns `--no-color` into `color: true` by default and `false` when given,
    // which is the shape the reporter wants.
    .option('--no-color', 'never emit terminal escape codes')
    .option('--verbose', 'print the resolved configuration and full error detail');

  // An explicit no-op action on the root.
  //
  // Without it, Commander sees a program that has subcommands and no handler, decides
  // the user must have meant to name one, prints help and throws before anything else
  // runs. That preempts `qai --verbose`, whose whole job is to say what configuration
  // was resolved. What happens when no subcommand is given is decided in `main`, where
  // the resolved configuration is available to decide it with.
  program.action(() => {});

  return program;
}
