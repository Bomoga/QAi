import {
  diffRuns,
  openStore,
  renderDeltaJson,
  renderDeltaText,
  type RunResult,
  type Store,
} from '@qai/core';

import { present } from '../errors.ts';
import type { Stream } from '../reporter.ts';
import type { Settings } from '../settings.ts';
import { emit, knownRuns, noteInapplicableThreshold } from './report.ts';

/**
 * `qai diff [--last 2] [runA runB]`: what changed about the application between two runs.
 *
 * **The order is oldest first, and it is the caller's to get right.** `diffRuns(a, b)`
 * reads from `a` to `b`, so naming them the other way round turns a fix into a
 * regression. When the runs come from `--last`, this command picks the order, and it
 * picks the older one first.
 *
 * **`--last n` compares the newest run with the nth most recent**, so the default of 2
 * is the previous run and the one before this one. The module writes the flag as
 * `--last 2` and does not say what other values mean; this is the reading that makes 2
 * the common case rather than a special one.
 *
 * **It exits 0 or 2, never 1**, exactly as the command table says. A delta describes
 * change, and whether change is bad is a judgment this command does not make. `check` is
 * what returns an exit code about an application.
 */

export interface DiffOptions {
  readonly cwd: string;
  /** Run ids from the command line: none, or two. */
  readonly runs: readonly string[];
  /** How far back the older run is, when none were named. */
  readonly last?: number;
  readonly settings: Settings;
  readonly stdout: Stream;
  readonly stderr: Stream;
  /** Adds a stack trace to any error this prints. */
  readonly verbose?: boolean;
}

/** The default the module's flag is written with: this run and the one before it. */
export const DEFAULT_LAST = 2;

/** A delta is not a findings document, so two of the four formats have nothing to say. */
function documentFor(
  delta: ReturnType<typeof diffRuns>,
  settings: Settings,
  stderr: Stream,
): string {
  const format = settings.format.value;

  if (format === 'sarif' || format === 'junit') {
    // The same answer `probe` gives. An empty findings document would report a clean
    // application where the truth is a document about something else entirely.
    stderr.write(
      `note: --format ${format} describes findings, and a delta describes change. Writing the delta as JSON instead.\n`,
    );
    return renderDeltaJson(delta);
  }

  return format === 'json' ? renderDeltaJson(delta) : renderDeltaText(delta);
}

export function runDiff(options: DiffOptions): number {
  const { cwd, runs, settings, stdout, stderr } = options;
  const presentTo = { stderr, ...(options.verbose === true ? { verbose: true } : {}) };
  const last = options.last ?? DEFAULT_LAST;

  if (runs.length === 1) {
    return present(
      {
        code: 2,
        summary: 'a delta compares two runs, and one was named',
        reason: `only ${runs[0] ?? ''} was given.`,
        suggestion: 'Name both runs, oldest first, or pass no run at all to compare the last two.',
      },
      presentTo,
    );
  }

  if (last < 2) {
    return present(
      {
        code: 2,
        summary: `--last ${last} does not name two runs`,
        reason: 'A delta needs an earlier run and a later one.',
        suggestion: 'Pass --last 2 or more, or name both runs.',
      },
      presentTo,
    );
  }

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
    let older: RunResult;
    let newer: RunResult;

    if (runs.length === 2) {
      if (options.last !== undefined) {
        stderr.write('note: --last is ignored when both runs are named.\n');
      }

      const found = runs.map((id) => ({ id, run: store.getRun(id) }));
      const missing = found.filter((one) => one.run === null).map((one) => one.id);

      if (missing.length > 0) {
        const known = knownRuns(store);
        return present(
          {
            code: 2,
            summary: `no run with id ${missing.join(' or ')} is stored`,
            where: '.qai/runs.db',
            reason:
              known.length === 0
                ? 'the store holds no runs at all'
                : `the store holds ${known.join(', ')}`,
            suggestion:
              known.length === 0
                ? 'Run "qai check" to record one.'
                : 'Name two of the runs above, oldest first.',
          },
          presentTo,
        );
      }

      // The order the caller gave, because they said which run came first and the
      // command has no business second-guessing that from a timestamp.
      [older, newer] = found.map((one) => one.run) as [RunResult, RunResult];
    } else {
      const listed = store.listRuns({ limit: last });

      if (listed.length < last) {
        return present(
          {
            code: 2,
            summary: `--last ${last} needs ${last} stored runs, and ${listed.length} are stored`,
            where: '.qai/runs.db',
            reason:
              listed.length === 0
                ? 'nothing has been recorded here yet'
                : `the store holds ${listed.map((one) => one.runId).join(', ')}`,
            suggestion: 'Run "qai check" again to record another run.',
          },
          presentTo,
        );
      }

      // listRuns is newest first, so the last of the window is the older run.
      const first = listed[listed.length - 1];
      const latest = listed[0];
      if (first === undefined || latest === undefined) {
        throw new Error('the store listed runs it then could not name');
      }

      const a = store.getRun(first.runId);
      const b = store.getRun(latest.runId);
      if (a === null || b === null) throw new Error('the store listed a run it could not return');

      older = a;
      newer = b;
    }

    noteInapplicableThreshold(settings, stderr, 'diff');
    const delta = diffRuns(older, newer);
    emit(documentFor(delta, settings, stderr), settings.out.value, cwd, stdout, stderr);
    return 0;
  } finally {
    store.close();
  }
}
