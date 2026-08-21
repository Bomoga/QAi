import { describe, expect, it } from 'vitest';

import { main } from './index.ts';

/**
 * What `main` returns, which is the whole of its job.
 *
 * It returns a code rather than applying one, for the reason `core` computes one and
 * never exits: a function that ends the process cannot be called twice, and cannot be
 * tested at all. The binary is the single place that turns the number into an exit.
 *
 * Commander writes its help and its usage errors to the real streams while these run, so
 * the suite is noisy here. Routing that through injected streams belongs with M8.2 and
 * M8.7, which own configuration resolution and error presentation.
 */
function run(...argv: readonly string[]): Promise<number> {
  return main(['node', 'qai', ...argv]);
}

describe('the qai entry point', () => {
  it('exits 0 for a run that asked for nothing', async () => {
    await expect(run()).resolves.toBe(0);
  });

  it('exits 0 after printing help, rather than throwing at the user', async () => {
    // `exitOverride` makes Commander throw for `--help` too, and the throw arrives after
    // the help has already printed. Without handling it, `qai --help` ends in a stack
    // trace, which is what the first run of the built binary actually did.
    await expect(run('--help')).resolves.toBe(0);
  });

  it('exits 0 after printing the version', async () => {
    await expect(run('--version')).resolves.toBe(0);
  });

  it('exits 2 on a bad invocation, never 1', async () => {
    // 1 is spoken for: 03-CONTRACTS.md gives it to a run that completed and found
    // something at or above the threshold. Commander's own default for a usage error is
    // 1, so a misspelled flag would tell CI the application has findings, which is the
    // worst lie available here. 2 is the configuration error code and a bad invocation
    // is one.
    await expect(run('--bogus')).resolves.toBe(2);
    await expect(run('--format', 'xml')).resolves.toBe(2);
    await expect(run('--fail-on', 'info')).resolves.toBe(2);
    await expect(run('--concurrency', 'four')).resolves.toBe(2);
  });

  it('exits 0 for every flag the surface accepts', async () => {
    await expect(
      run(
        '--config',
        'qai.config.yaml',
        '--format',
        'json',
        '--out',
        'out.json',
        '--fail-on',
        'high',
        '--fail-on-unverified',
        '--concurrency',
        '4',
        '--no-color',
        '--verbose',
      ),
    ).resolves.toBe(0);
  });
});
