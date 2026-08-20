import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import {
  openStore,
  renderJson,
  renderJunit,
  renderSarif,
  renderText,
  type RunResult,
  type Store,
} from '@qai/core';

import { present } from '../errors.ts';
import type { Stream } from '../reporter.ts';
import type { Settings } from '../settings.ts';

/**
 * `qai report <runId>`: a stored run, rendered again in any format.
 *
 * **Nothing is recomputed.** The run is read back exactly as `check` produced it, so a
 * report rendered today and one rendered next week from the same run are the same
 * document. Re-running the checks to produce a report would be a different run wearing
 * an old run's id.
 *
 * **It exits 0 or 2, never 1.** The command table in the module says so, and the reason
 * is worth stating: 1 means a run completed and found something at or above the
 * threshold, and this command completes no run. A CI step that wants an exit code runs
 * `check`. `--fail-on` is reported as inapplicable rather than ignored, because a
 * silently ignored flag is a user believing they configured something they did not.
 *
 * **The text report's second section is thinner here.** It counts entities and endpoints
 * by origin and confidence, which comes from the Observation, and a RunResult carries
 * only a reference to one. `renderText` already says the reference rather than reporting
 * counts of zero, which is the honest difference between an absence of data and a claim
 * about the application.
 */

export interface ReportOptions {
  readonly cwd: string;
  readonly runId: string;
  readonly settings: Settings;
  readonly stdout: Stream;
  readonly stderr: Stream;
  /** Whether stdout is a terminal, so the text report can be coloured. */
  readonly color?: boolean;
  /** Adds a stack trace to any error this prints. */
  readonly verbose?: boolean;
}

/** The newest few run ids, so a mistyped id gets told what is actually there. */
export function knownRuns(store: Store, limit = 5): string[] {
  return store.listRuns({ limit }).map((one) => one.runId);
}

export function renderStoredRun(
  result: RunResult,
  format: Settings['format']['value'],
  color = false,
): string {
  if (format === 'json') return renderJson(result);
  if (format === 'sarif') return renderSarif(result);
  if (format === 'junit') return renderJunit(result);
  // No Observation, because a RunResult carries only a reference to one. renderText says
  // the reference rather than reporting counts of zero, which is the difference between
  // an absence of data and a claim about the application.
  return renderText(result, { color });
}

/**
 * Writes a rendered document where the settings say, and says so when that is a file.
 *
 * Shared with `diff` because both commands answer the same question about `--out`, and
 * two copies of it would be two chances to write a report somewhere nobody looks.
 */
export function emit(
  document: string,
  outPath: string | undefined,
  cwd: string,
  stdout: Stream,
  stderr: Stream,
): void {
  if (outPath === undefined) {
    stdout.write(document);
    return;
  }

  const absolute = isAbsolute(outPath) ? outPath : resolve(cwd, outPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, document, 'utf8');
  stderr.write(`written to ${outPath}\n`);
}

/**
 * Says a threshold flag does not apply here, rather than letting it look applied.
 *
 * Only when it was actually typed. `--fail-on` has a default, so reading the value alone
 * would warn on every invocation and teach the reader to skip the line.
 */
export function noteInapplicableThreshold(
  settings: Settings,
  stderr: Stream,
  command: string,
): void {
  const named: string[] = [];
  if (settings.failOn.source === 'flag') named.push('--fail-on');
  if (settings.failOnUnverified.source === 'flag') named.push('--fail-on-unverified');
  if (named.length === 0) return;

  stderr.write(
    `note: ${named.join(' and ')} sets the threshold a run fails at, and "qai ${command}" completes no run, so it exits 0 either way. Use "qai check" for an exit code.\n`,
  );
}

export function runReport(options: ReportOptions): number {
  const { cwd, runId, settings, stdout, stderr } = options;
  const presentTo = { stderr, ...(options.verbose === true ? { verbose: true } : {}) };

  let store: Store;
  try {
    store = openStore(cwd);
  } catch (error) {
    return present(
      {
        code: 2,
        summary: 'could not open the run store',
        where: '.qai/runs.db',
        reason: error instanceof Error ? error.message : String(error),
        suggestion: 'Run "qai check" in this directory to create it.',
        cause: error,
      },
      presentTo,
    );
  }

  try {
    const result = store.getRun(runId);

    if (result === null) {
      const known = knownRuns(store);
      return present(
        {
          code: 2,
          summary: `no run with id ${runId} is stored`,
          where: '.qai/runs.db',
          reason:
            known.length === 0
              ? 'the store holds no runs at all'
              : `the store holds ${known.join(', ')}`,
          suggestion:
            known.length === 0
              ? 'Run "qai check" to record one.'
              : 'Name one of the runs above, or run "qai check" to record another.',
        },
        presentTo,
      );
    }

    noteInapplicableThreshold(settings, stderr, 'report');
    emit(
      renderStoredRun(result, settings.format.value, options.color === true),
      settings.out.value,
      cwd,
      stdout,
      stderr,
    );
    return 0;
  } finally {
    store.close();
  }
}
