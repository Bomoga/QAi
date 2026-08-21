import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CORPUS_BASE_URL, CORPUS_PORT, discoverCorpusApps, type CorpusApp } from './lib/apps.ts';
import { classifyCheckExit } from './lib/outcome.ts';

/**
 * The corpus run: every application in `corpus/apps/`, checked once, everything recorded.
 *
 * **Nothing here judges anything.** It starts an application, runs `qai check` against it,
 * writes the run result down, and stops the application. What the findings mean is S8.5,
 * done by a human reading them, and a runner that pre-classified anything would be
 * deciding the answer the stage exists to measure.
 *
 * **One application at a time, on one fixed port.** Each corpus application is an ordinary
 * qai project whose config names that port, so there is no config rewriting and no race
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
const QAI = join(ROOT, 'packages', 'cli', 'bin', 'qai.js');

/** How long an application gets to answer on its port before the run gives up on it. */
const READY_TIMEOUT_MS = 20_000;
const READY_INTERVAL_MS = 200;

/** How long `qai check` gets before the run gives up on it. */
const CHECK_TIMEOUT_MS = 180_000;

export type AppOutcome =
  | { readonly kind: 'checked'; readonly slug: string; readonly exitCode: number }
  | { readonly kind: 'did-not-start'; readonly slug: string; readonly reason: string }
  | { readonly kind: 'check-failed'; readonly slug: string; readonly reason: string };

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function waitForPort(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    // An application that died is never going to answer, so say that rather than
    // spending the whole timeout on a process that is gone.
    if (child.exitCode !== null) {
      throw new Error(`the process exited with code ${child.exitCode} before it listened`);
    }

    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((done) => setTimeout(done, READY_INTERVAL_MS));
    }
  }

  throw new Error(`nothing answered on ${url} within ${READY_TIMEOUT_MS}ms`);
}

function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();

  return new Promise((done) => {
    child.once('exit', () => {
      done();
    });
    child.kill();
    // A process that ignores the signal must not hold the whole corpus run.
    setTimeout(() => {
      child.kill('SIGKILL');
      done();
    }, 5_000).unref();
  });
}

function run(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: Readonly<Record<string, string>>; timeoutMs: number },
): Promise<{ code: number; stderr: string }> {
  return new Promise((done, fail) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
    });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.stdout.resume();

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      fail(new Error(`timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    child.once('error', (error) => {
      clearTimeout(timer);
      fail(error);
    });

    child.once('close', (code) => {
      clearTimeout(timer);
      done({ code: code ?? 1, stderr });
    });
  });
}

async function checkOne(app: CorpusApp, resultsDir: string): Promise<AppOutcome> {
  log(`\n${app.slug}`);

  const server = spawn(process.execPath, ['--experimental-strip-types', app.entry], {
    cwd: app.dir,
    env: { ...process.env, ...app.env, PORT: String(CORPUS_PORT) },
    shell: false,
  });
  server.stdout.resume();
  server.stderr.resume();

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
    const { code, stderr } = await run(
      process.execPath,
      [QAI, 'check', '--format', 'json', '--out', out],
      { cwd: app.dir, env: app.env, timeoutMs: CHECK_TIMEOUT_MS },
    );

    const outcome = classifyCheckExit(code, stderr);
    if (outcome.kind === 'check-failed') {
      log(`  check failed: ${outcome.reason}`);
      return { kind: 'check-failed', slug: app.slug, reason: outcome.reason };
    }

    log(`  checked, exit ${outcome.exitCode}, recorded to ${app.slug}.run.json`);
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
