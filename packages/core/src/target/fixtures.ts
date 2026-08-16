import { spawn } from 'node:child_process';

import type { TargetConfig } from './config.ts';

/**
 * Fixture seeding and reset, and the gate that stands in front of both.
 *
 * Invariant I7: the tool refuses destructive work against a target that was not
 * declared disposable. The gate is not overridable by flag, because the whole point
 * of a safety interlock is that the person in a hurry cannot reach past it.
 */

export type FixtureRefusalReason = 'not-disposable' | 'no-reset-command' | 'no-seed-command';

export interface FixtureRefusal {
  readonly kind: 'refused';
  readonly reason: FixtureRefusalReason;
  /** Written for someone who has to change something to proceed. */
  readonly message: string;
}

export interface CommandRun {
  readonly kind: 'ran';
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export type SeedResult = CommandRun | FixtureRefusal;
export type ResetResult = CommandRun | FixtureRefusal;

export function isRefusal(result: SeedResult | ResetResult): result is FixtureRefusal {
  return result.kind === 'refused';
}

export const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;

/**
 * The interlock. A reset command is required even to seed, because seeding a target
 * you cannot restore leaves someone with a dirty database and no way back.
 */
export function checkDisposability(config: TargetConfig): FixtureRefusal | undefined {
  if (!config.target.disposable) {
    return {
      kind: 'refused',
      reason: 'not-disposable',
      message:
        'target.disposable is not true, so fixtures and mutating checks will not run. Set target.disposable: true in qai.config.yaml only for a target whose data you can afford to lose.',
    };
  }

  if (config.target.resetCommand === undefined) {
    return {
      kind: 'refused',
      reason: 'no-reset-command',
      message:
        'target.resetCommand is not configured. A target that cannot be restored will not be seeded, since there would be no way back to the state it started in.',
    };
  }

  return undefined;
}

export interface RunCommandOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Runs a configured command and captures what it said. Output is captured rather than
 * streamed because core produces no output of its own, per rule R5; a caller decides
 * whether any of this reaches a terminal.
 */
export function runCommand(command: string, options: RunCommandOptions = {}): Promise<CommandRun> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;

  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd: options.cwd ?? process.cwd(),
      env: { ...options.env } as NodeJS.ProcessEnv,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const settle = (result: CommandRun): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    /**
     * With `shell: true` the child is the shell, and killing it does not necessarily
     * take the command with it. On Windows it reliably does not. So the deadline
     * resolves the promise rather than waiting for a close event that may be minutes
     * away, and the tree kill is best effort on top of that. A caller waiting on a
     * command that ignored its kill has already lost the thing it was waiting for.
     */
    const timer = setTimeout(() => {
      timedOut = true;

      if (process.platform === 'win32' && child.pid !== undefined) {
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
      } else {
        child.kill('SIGKILL');
      }

      settle({ kind: 'ran', command, exitCode: -1, stdout, stderr, timedOut: true });
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (cause: Error) => {
      clearTimeout(timer);
      settle({
        kind: 'ran',
        command,
        exitCode: -1,
        stdout,
        stderr: stderr === '' ? cause.message : `${stderr}\n${cause.message}`,
        timedOut,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      settle({ kind: 'ran', command, exitCode: code ?? -1, stdout, stderr, timedOut });
    });
  });
}

export async function seedFixtures(
  config: TargetConfig,
  options: RunCommandOptions = {},
): Promise<SeedResult> {
  const refusal = checkDisposability(config);
  if (refusal !== undefined) return refusal;

  const command = config.target.seedCommand;
  if (command === undefined) {
    return {
      kind: 'refused',
      reason: 'no-seed-command',
      message:
        'target.seedCommand is not configured, so there is nothing to seed. Configure one, or run checks against the state the target is already in.',
    };
  }

  return runCommand(command, options);
}

export async function resetFixtures(
  config: TargetConfig,
  options: RunCommandOptions = {},
): Promise<ResetResult> {
  const refusal = checkDisposability(config);
  if (refusal !== undefined) return refusal;

  // checkDisposability has already established this is present.
  const command = config.target.resetCommand ?? '';
  return runCommand(command, options);
}

/** Whether a mutating check may run at all. Same interlock, asked before execution. */
export function mutatingChecksAllowed(config: TargetConfig): boolean {
  return checkDisposability(config) === undefined;
}
