import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RunResultSchema } from '../packages/core/src/index.ts';
import { CORPUS_BASE_URL, discoverCorpusApps, type CorpusApp } from './lib/apps.ts';
import { classifyCheckExit, describeCoverage } from './lib/outcome.ts';
import { CHECK_TIMEOUT_MS, runCommand, startApp, stop, waitForPort } from './lib/serve.ts';

/**
 * The corpus run: every application in `corpus/apps/`, checked once, everything recorded.
 *
 * **Nothing here judges anything.** It starts an application, runs `specgate check` against it,
 * writes the run result down, and stops the application. What the findings mean is S8.5,
 * done by a human reading them, and a runner that pre-classified anything would be
 * deciding the answer the stage exists to measure.
 *
 * **One application at a time, on one fixed port.** Each corpus application is an ordinary
 * specgate project whose config names that port, so there is no config rewriting and no race
 * between two applications for a socket. It is slower and it is reproducible.
 *
 * **An application that will not start or will not check is recorded as such.** The number
 * this stage produces is a fraction, and a run that dropped what it could not handle
 * would report a coverage the corpus does not have.
 *
 * **The exit code says whether the corpus run completed, never what it found.** Findings
 * are the data. A corpus run that failed because an application had findings would be
 * unable to produce the table it exists for.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPS_DIR = join(ROOT, 'corpus', 'apps');
const RESULTS_DIR = join(ROOT, 'corpus', 'results');
const SPECGATE = join(ROOT, 'packages', 'cli', 'bin', 'specgate.js');

export type AppOutcome =
  | { readonly kind: 'checked'; readonly slug: string; readonly exitCode: number }
  | { readonly kind: 'did-not-start'; readonly slug: string; readonly reason: string }
  | { readonly kind: 'check-failed'; readonly slug: string; readonly reason: string };

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * The coverage line for a result the command just wrote.
 *
 * Parsed rather than cast, since a document off disk is a boundary, rule R2. A result
 * that will not parse is said out loud rather than swallowed: the check reported success
 * and then produced something unreadable, which is worth more than a missing line.
 */
function coverageOf(out: string): string {
  try {
    return describeCoverage(RunResultSchema.parse(JSON.parse(readFileSync(out, 'utf8'))));
  } catch (error) {
    return `coverage could not be read: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function checkOne(app: CorpusApp, resultsDir: string): Promise<AppOutcome> {
  log(`\n${app.slug}`);

  const server = startApp(app);

  try {
    await waitForPort(`${CORPUS_BASE_URL}/`, server);
  } catch (error) {
    await stop(server);
    const reason = error instanceof Error ? error.message : String(error);
    log(`  did not start: ${reason}`);
    return { kind: 'did-not-start', slug: app.slug, reason };
  }

  try {
    const out = join(resultsDir, `${app.slug}.run.json`);
    const { code, stderr } = await runCommand(
      process.execPath,
      [SPECGATE, 'check', '--format', 'json', '--out', out],
      { cwd: app.dir, env: app.env, timeoutMs: CHECK_TIMEOUT_MS },
    );

    const outcome = classifyCheckExit(code, stderr);
    if (outcome.kind === 'check-failed') {
      log(`  check failed: ${outcome.reason}`);
      return { kind: 'check-failed', slug: app.slug, reason: outcome.reason };
    }

    log(`  checked, exit ${outcome.exitCode}, recorded to ${app.slug}.run.json`);
    log(`  ${coverageOf(out)}`);
    return { kind: 'checked', slug: app.slug, exitCode: outcome.exitCode };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(`  check failed: ${reason}`);
    return { kind: 'check-failed', slug: app.slug, reason };
  } finally {
    await stop(server);
  }
}

export async function runCorpus(): Promise<number> {
  const { apps, problems } = discoverCorpusApps(APPS_DIR);

  if (apps.length === 0 && problems.length === 0) {
    log(`No corpus applications under ${APPS_DIR}. See corpus/README.md for the layout.`);
    return 0;
  }

  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/\D/g, '').slice(0, 14);
  const resultsDir = join(RESULTS_DIR, stamp);
  mkdirSync(resultsDir, { recursive: true });

  log(`Corpus run ${stamp}`);
  log(`  ${apps.length} application(s) to check`);
  // Said at the start, not the end. A reader who sees the summary first has already
  // formed a view of the coverage by the time the gaps arrive.
  if (problems.length > 0) {
    log(`  ${problems.length} directory(ies) that are not runnable applications:`);
    for (const problem of problems)
      log(`    ${problem.slug}: missing ${problem.missing.join(', ')}`);
  }

  const outcomes: AppOutcome[] = [];
  for (const app of apps) outcomes.push(await checkOne(app, resultsDir));

  const manifest = {
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl: CORPUS_BASE_URL,
    applications: apps.length,
    outcomes,
    notRunnable: problems,
  };

  writeFileSync(
    join(resultsDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  const checked = outcomes.filter((one) => one.kind === 'checked').length;
  log(`\n${checked} of ${apps.length} application(s) checked. Results in ${resultsDir}`);
  for (const outcome of outcomes) {
    if (outcome.kind !== 'checked') log(`  ${outcome.slug}: ${outcome.kind}, ${outcome.reason}`);
  }

  // Zero whenever the run itself completed. What was found is in the results.
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url.endsWith('run.ts')) {
  runCorpus()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `corpus run failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 3;
    });
}
