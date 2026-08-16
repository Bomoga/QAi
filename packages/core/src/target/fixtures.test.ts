import { describe, expect, it } from 'vitest';

import { TargetConfigSchema, type TargetConfig } from './config.ts';
import {
  checkDisposability,
  isRefusal,
  mutatingChecksAllowed,
  resetFixtures,
  runCommand,
  seedFixtures,
} from './fixtures.ts';

function configWith(target: Record<string, unknown>): TargetConfig {
  return TargetConfigSchema.parse({ target, actors: [] });
}

const DISPOSABLE = configWith({
  baseUrl: 'http://localhost:3000',
  disposable: true,
  resetCommand: 'node -e "process.stdout.write(\'reset done\')"',
  seedCommand: 'node -e "process.stdout.write(\'seed done\')"',
});

describe('the disposability gate', () => {
  it('refuses a target not marked disposable', () => {
    const refusal = checkDisposability(configWith({ baseUrl: 'http://localhost:3000' }));

    expect(refusal?.reason).toBe('not-disposable');
    expect(refusal?.message).toContain('target.disposable: true');
  });

  it('refuses a disposable target with no way back', () => {
    const refusal = checkDisposability(
      configWith({ baseUrl: 'http://localhost:3000', disposable: true }),
    );

    expect(refusal?.reason).toBe('no-reset-command');
    expect(refusal?.message).toContain('resetCommand');
  });

  it('allows a disposable target that can be restored', () => {
    expect(checkDisposability(DISPOSABLE)).toBeUndefined();
  });

  it('gates mutating checks on the same interlock', () => {
    expect(mutatingChecksAllowed(DISPOSABLE)).toBe(true);
    expect(mutatingChecksAllowed(configWith({ disposable: false }))).toBe(false);
    expect(mutatingChecksAllowed(configWith({ disposable: true }))).toBe(false);
  });
});

describe('seeding', () => {
  it('refuses before running anything when the target is not disposable', async () => {
    const result = await seedFixtures(
      configWith({ disposable: false, seedCommand: 'node -e "process.exit(0)"' }),
    );

    expect(isRefusal(result)).toBe(true);
    if (isRefusal(result)) expect(result.reason).toBe('not-disposable');
  });

  it('refuses with an actionable message rather than a bare failure', async () => {
    const result = await seedFixtures(configWith({ disposable: false }));

    if (!isRefusal(result)) throw new Error('expected a refusal');
    expect(result.message).toContain('qai.config.yaml');
    expect(result.message.length).toBeGreaterThan(40);
  });

  it('says so when there is nothing configured to seed', async () => {
    const result = await seedFixtures(
      configWith({ disposable: true, resetCommand: 'node -e "process.exit(0)"' }),
    );

    if (!isRefusal(result)) throw new Error('expected a refusal');
    expect(result.reason).toBe('no-seed-command');
  });

  it('runs the configured command and captures its output', async () => {
    const result = await seedFixtures(DISPOSABLE);

    if (isRefusal(result)) throw new Error('expected the command to run');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('seed done');
    expect(result.timedOut).toBe(false);
  });
});

describe('resetting', () => {
  it('runs the configured command', async () => {
    const result = await resetFixtures(DISPOSABLE);

    if (isRefusal(result)) throw new Error('expected the command to run');
    expect(result.stdout).toContain('reset done');
  });

  it('is refused by the same gate', async () => {
    const result = await resetFixtures(configWith({ disposable: false }));
    expect(isRefusal(result)).toBe(true);
  });
});

describe('running a command', () => {
  it('captures a non-zero exit code rather than throwing', async () => {
    const result = await runCommand('node -e "process.exit(3)"');
    expect(result.exitCode).toBe(3);
  });

  it('captures stderr separately from stdout', async () => {
    const result = await runCommand(
      "node -e \"process.stderr.write('to stderr'); process.stdout.write('to stdout')\"",
    );

    expect(result.stdout).toContain('to stdout');
    expect(result.stderr).toContain('to stderr');
  });

  it('stops a command that overruns and says it timed out', async () => {
    const result = await runCommand('node -e "setTimeout(() => {}, 10000)"', { timeoutMs: 300 });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  it('reports a command that could not start rather than throwing', async () => {
    const result = await runCommand('this-command-does-not-exist-anywhere');
    expect(result.exitCode).not.toBe(0);
  });

  it('names the command it ran, so a caller can report it', async () => {
    const result = await runCommand('node -e "process.exit(0)"');
    expect(result.command).toBe('node -e "process.exit(0)"');
  });
});
