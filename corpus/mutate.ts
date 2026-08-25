import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RunResultSchema } from '../packages/core/src/index.ts';
import { discoverCorpusApps, type CorpusApp } from './lib/apps.ts';
import { findingsOf } from './lib/ledger.ts';
import { classifyCheckExit } from './lib/outcome.ts';
import { applyEdit, judge } from './lib/mutation.ts';
import { CHECK_TIMEOUT_MS, runCommand, startAndWait, stop } from './lib/serve.ts';
import { MUTATIONS, type Mutation } from './mutations.ts';

/**
 * Does a finding track the defect it names?
 *
 * `corpus/review.ts` computes a false positive rate from classifications the author wrote.
 * This does not read those classifications at all. It repairs the defect a finding claims
 * to be about and requires the finding to stop being produced, which is a fact about the
 * tool rather than an opinion about the finding.
 *
 * That is the point. `corpus/RESULTS.md` names the review's lack of independence as the
 * largest limit on the rate, and a second reading by the same author cannot lift it. This
 * can, for the findings it covers, because the application decides the outcome.
 *
 * **Nothing here is left mutated.** Every edit is reverted in a `finally`, including when
 * the check throws or the run is interrupted, and the runner verifies the file is back to
 * its original bytes before it moves on. A corpus application silently left in a repaired
 * state would quietly change the rate the next time anybody ran `corpus/run.ts`.
 *
 * Run it with:
 *
 *   node --experimental-strip-types corpus/mutate.ts
 *
 * Add `<mutation-id>` to run one.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPS_DIR = join(ROOT, 'corpus', 'apps');
const RESULTS_DIR = join(ROOT, 'corpus', 'results');
const QAI = join(ROOT, 'packages', 'cli', 'bin', 'qai.js');

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

export interface MutationOutcome {
  readonly mutation: Mutation;
  readonly ok: boolean;
  /** Everything that went wrong, one sentence each. */
  readonly problems: readonly string[];
  /** Findings that changed and were not listed in `expect`. */
  readonly collateral: readonly string[];
}

/** Run the tool against one application and return the finding ids it produced. */
async function findingIdsFor(app: CorpusApp, out: string): Promise<Set<string>> {
  const server = await startAndWait(app);
  try {
    const { code, stderr } = await runCommand(
      process.execPath,
      [QAI, 'check', '--format', 'json', '--out', out],
      { cwd: app.dir, env: app.env, timeoutMs: CHECK_TIMEOUT_MS },
    );

    const outcome = classifyCheckExit(code, stderr);
    if (outcome.kind === 'check-failed') {
      throw new Error(`the check did not complete: ${outcome.reason}`);
    }

    const result = RunResultSchema.parse(JSON.parse(readFileSync(out, 'utf8')));
    return new Set(findingsOf(app.slug, result).map((finding) => finding.findingId));
  } finally {
    await stop(server);
  }
}

function describeSet(ids: Iterable<string>): string {
  const list = [...ids].sort();
  return list.length === 0 ? 'none' : list.join(', ');
}

async function runMutation(app: CorpusApp, mutation: Mutation): Promise<MutationOutcome> {
  log(`\n${mutation.id}`);
  log(`  ${mutation.description}`);

  const path = join(app.dir, mutation.file);
  const original = readFileSync(path, 'utf8');

  const before = await findingIdsFor(app, join(RESULTS_DIR, `${mutation.id}.before.json`));
  log(`  before: ${before.size} finding(s)`);

  let after: Set<string>;
  try {
    writeFileSync(path, applyEdit(original, mutation), 'utf8');
    after = await findingIdsFor(app, join(RESULTS_DIR, `${mutation.id}.after.json`));
  } finally {
    writeFileSync(path, original, 'utf8');
  }

  // Read back here rather than asserting inside the `finally`, because a throw from a
  // `finally` replaces whatever the `try` was already throwing. A check that failed would
  // then be reported as a failed restore, which is the wrong problem and hides the right
  // one. The restore itself stays in the `finally`, where it belongs.
  if (readFileSync(path, 'utf8') !== original) {
    throw new Error(`${path} could not be restored, and the corpus is now dirty`);
  }

  log(`  after:  ${after.size} finding(s)`);

  const { problems, collateral } = judge(before, after, mutation);

  const ok = problems.length === 0;
  log(
    `  ${ok ? 'ok' : 'FAILED'}: ${describeSet(mutation.expect)} ${mutation.intent === 'repair' ? 'stopped' : 'started'}`,
  );
  for (const problem of problems) log(`    ${problem}`);
  if (collateral.length > 0) log(`  collateral: ${describeSet(collateral)}`);

  return { mutation, ok, problems, collateral };
}

export async function runMutations(only?: string): Promise<number> {
  const { apps } = discoverCorpusApps(APPS_DIR);
  const byslug = new Map(apps.map((app) => [app.slug, app]));

  const selected = only === undefined ? MUTATIONS : MUTATIONS.filter((one) => one.id === only);
  if (selected.length === 0) {
    log(only === undefined ? 'No mutations are defined.' : `No mutation is called ${only}.`);
    return 2;
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  log(`${selected.length} mutation(s), each run twice against a real application.`);

  const outcomes: MutationOutcome[] = [];
  for (const mutation of selected) {
    const app = byslug.get(mutation.app);
    if (app === undefined) {
      log(`\n${mutation.id}\n  FAILED: there is no application called ${mutation.app}`);
      outcomes.push({
        mutation,
        ok: false,
        problems: [`there is no application called ${mutation.app}`],
        collateral: [],
      });
      continue;
    }
    outcomes.push(await runMutation(app, mutation));
  }

  const failed = outcomes.filter((outcome) => !outcome.ok);
  const withCollateral = outcomes.filter((outcome) => outcome.collateral.length > 0);

  log(
    `\n${outcomes.length - failed.length} of ${outcomes.length} mutation(s) behaved as the table says.`,
  );
  for (const outcome of failed) {
    log(`  ${outcome.mutation.id}: ${outcome.problems.join('; ')}`);
  }

  // Reported and not failed. Collateral is information about coupling rather than a
  // defect on its own, and deciding it is a defect is a reading, which is the thing this
  // script exists to avoid doing.
  if (withCollateral.length > 0) {
    log(`\nCollateral, worth a look and not a failure:`);
    for (const outcome of withCollateral) {
      log(`  ${outcome.mutation.id}: ${describeSet(outcome.collateral)}`);
    }
  }

  return failed.length === 0 ? 0 : 1;
}

// The same shape run.ts uses. Comparing against a path would need the separator handled,
// which is the backslash trap this repository has been caught by before.
if (process.argv[1] !== undefined && import.meta.url.endsWith('mutate.ts')) {
  runMutations(process.argv[2])
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `mutation run failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 3;
    });
}
