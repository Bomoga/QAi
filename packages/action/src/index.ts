import { appendFileSync, readFileSync } from 'node:fs';
import process from 'node:process';

import { formatOutputs, outputsFromSarif, summaryLine } from './outputs.ts';

/**
 * Public API of @qai/action.
 *
 * The Action itself is `action.yml`, a composite action, because the module asks for a
 * thin one: install, run `qai check --format sarif`, upload, set outputs. Everything a
 * composite action can express is expressed there.
 *
 * What is here is the one part with a decision in it, computing the outputs from the
 * SARIF the run produced. That lives in TypeScript because a decision in YAML is a
 * decision nobody can test.
 */
export {
  outputsFromSarif,
  formatOutputs,
  summaryLine,
  OUTPUT_NAMES,
  type ActionOutputs,
} from './outputs.ts';

/**
 * Reads a SARIF report and appends the Action's outputs to `$GITHUB_OUTPUT`.
 *
 * Invoked by `action.yml` with the report path as its argument. It writes the summary
 * line to stdout so the step log says what the run found without anyone opening the
 * security tab, and it does not decide whether the workflow fails: `qai check` already
 * computed that exit code and the Action applies it, for the same reason `core` computes
 * one and the CLI applies it.
 */
export function main(argv: readonly string[]): number {
  const reportPath = argv[2];
  if (reportPath === undefined) {
    process.stderr.write('error: no SARIF report path was given\n');
    return 2;
  }

  let outputs;
  try {
    outputs = outputsFromSarif(readFileSync(reportPath, 'utf8'));
  } catch (cause) {
    // An unreadable report means the run did not produce what it said it would. Reporting
    // zero findings from it would be the quietest possible failure.
    process.stderr.write(
      `error: ${cause instanceof Error ? cause.message : 'the SARIF report could not be read'}\n  at ${reportPath}\n`,
    );
    return 2;
  }

  const target = process.env['GITHUB_OUTPUT'];
  if (target !== undefined && target !== '') appendFileSync(target, formatOutputs(outputs), 'utf8');

  process.stdout.write(`${summaryLine(outputs)}\n`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.filename.endsWith('index.js')) {
  process.exitCode = main(process.argv);
}
