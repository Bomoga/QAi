import { createColors } from 'picocolors';

import type { Reporter } from '@qai/core';

/**
 * The CLI's implementation of the `Reporter` port that `core` declares.
 *
 * **Everything goes to stderr.** Stdout carries the report and nothing else, so
 * `qai check --format json | jq` works and `--out` is not the only way to get a clean
 * document. A single progress line on stdout breaks every pipe a user builds, and it
 * breaks it quietly, because the report is still in there somewhere. The module's Do Not
 * says this outright and it is the one thing the tests here are really defending.
 *
 * **Line oriented, always.** The module says `@clack/prompts` for an interactive
 * terminal and plain lines otherwise. What CI needs is plain lines, and what a person
 * watching a run needs is to know what is happening; a spinner adds the second without
 * changing the first. Clack's spinners are for a run that holds the terminal, which the
 * command surface does not do yet, so the interactive half is color and nothing more
 * until `check` has phases worth animating. Adding a spinner later changes this file
 * only.
 */

/** Just enough of a writable stream to write a line to it, so a test can pass an array. */
export interface Stream {
  write(chunk: string): void;
}

export interface ReporterOptions {
  readonly stdout: Stream;
  readonly stderr: Stream;
  /** Whether stderr is a terminal. Passed in, never sniffed, so tests state the case. */
  readonly tty: boolean;
  /** `--no-color` sets this false and it wins over `tty`, which is the point of asking. */
  readonly color?: boolean;
}

export function createReporter(options: ReporterOptions): Reporter {
  const colors = createColors(options.color !== false && options.tty);

  // Stdout is accepted and deliberately unused. Taking it makes the contract visible at
  // the call site: this object was handed both streams and writes to exactly one.
  void options.stdout;

  const line = (text: string): void => {
    options.stderr.write(`${text}\n`);
  };

  return {
    step: (message) => line(colors.dim('> ') + message),
    info: (message) => line(`  ${message}`),
    // Labeled in the text, not only in the color, because the color is gone in CI and
    // that is exactly where somebody reads this back afterwards.
    warn: (message) => line(`${colors.yellow('warning')}: ${message}`),
    error: (message) => line(`${colors.red('error')}: ${message}`),
  };
}
