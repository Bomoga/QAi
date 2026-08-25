import { spawn, type ChildProcess } from 'node:child_process';
import process from 'node:process';

import { CORPUS_BASE_URL, CORPUS_PORT, type CorpusApp } from './apps.ts';

/**
 * Starting a corpus application, waiting for it, running a command against it, stopping it.
 *
 * Extracted from `run.ts` at the mutation work so `mutate.ts` could reuse it rather than
 * keep a second copy. The same rule the testing strategy states about the two ledger servers
 * applies here: two copies of a process harness drift, and a harness that behaved
 * differently depending on which script started it would make every result it produced
 * unreadable.
 *
 * Nothing here judges anything. It starts a process, waits for a port, and reports what a
 * command exited with.
 */

/** Long enough for a Node process with type stripping to bind a port. */
const READY_TIMEOUT_MS = 20_000;
const READY_INTERVAL_MS = 200;

/** Long enough for a full check against one application. */
export const CHECK_TIMEOUT_MS = 180_000;

export interface CommandResult {
  readonly code: number;
  readonly stderr: string;
}

/**
 * Wait until the application answers, or until it exits without ever having answered.
 *
 * The child is watched as well as the port, so an application that crashes on boot fails
 * in about the time it takes to crash rather than after the full timeout.
 */
export async function waitForPort(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let exited: number | null = null;
  child.once('exit', (code) => (exited = code ?? 0));

  for (;;) {
    if (exited !== null) throw new Error(`exited ${exited} before answering on ${url}`);
    if (Date.now() > deadline)
      throw new Error(`did not answer on ${url} within ${READY_TIMEOUT_MS}ms`);

    try {
      await fetch(url, { signal: AbortSignal.timeout(2_000) });
      return;
    } catch {
      await new Promise((done) => setTimeout(done, READY_INTERVAL_MS));
    }
  }
}

/** Stop a started application, and do not wait forever for one that will not go. */
export function stop(child: ChildProcess): Promise<void> {
  return new Promise((done) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      done();
      return;
    }

    child.once('close', () => done());
    child.kill();

    setTimeout(() => {
      child.kill('SIGKILL');
      done();
    }, 5_000).unref();
  });
}

/** Start an application on the corpus port. The caller stops it. */
export function startApp(app: CorpusApp): ChildProcess {
  const server = spawn(process.execPath, ['--experimental-strip-types', app.entry], {
    cwd: app.dir,
    env: { ...process.env, ...app.env, PORT: String(CORPUS_PORT) },
    shell: false,
  });
  server.stdout.resume();
  server.stderr.resume();
  return server;
}

/** Start an application and wait for it, stopping it again if it never answers. */
export async function startAndWait(app: CorpusApp): Promise<ChildProcess> {
  const server = startApp(app);
  try {
    await waitForPort(`${CORPUS_BASE_URL}/`, server);
    return server;
  } catch (error) {
    await stop(server);
    throw error;
  }
}

export function runCommand(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: Readonly<Record<string, string>>; timeoutMs: number },
): Promise<CommandResult> {
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
