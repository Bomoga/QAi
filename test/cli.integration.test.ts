import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ALL_DEFECTS_OFF,
  ALL_DEFECTS_ON,
  FIXTURE_SPEC,
  runCli as run,
  startLedger,
  stopLedgers,
  workspace,
  writeConfig,
} from './support/ledger.ts';

/**
 * The end to end test the M8 Definition of Done asks for: `init`, then `validate`, then
 * `check` against the real fixture app over a real socket, in both configurations.
 *
 * The harness it runs on lives in `support/ledger.ts`, shared with the store and delta
 * integration test, so there is one description of the fixture's configuration rather
 * than two that drift.
 *
 * Both directions are pinned. Exit 1 with the defect switches on and 0 with them off, so
 * a command that always failed or always passed breaks one of them. That is the trap S3,
 * S4, and S5 each nearly fell into.
 */

afterEach(async () => {
  await stopLedgers();
});

describe('init and validate, the first two commands a user runs', () => {
  it('scaffolds a project and then validates what it scaffolded', async () => {
    // In that order and in one directory, because the starter spec failing the very next
    // command would be the tool's own fault.
    const dir = workspace();
    try {
      const init = await run(dir, ['init']);
      expect(init.code).toBe(0);
      expect(existsSync(join(dir, 'qai.config.yaml'))).toBe(true);

      const validate = await run(dir, ['validate']);
      expect(validate.code).toBe(0);
      expect(validate.out).toContain('0 warning');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('validates the fixture spec and counts what M1.8 recorded', async () => {
    const dir = workspace();
    try {
      copyFileSync(FIXTURE_SPEC, join(dir, 'spec', 'ledger.spec.yaml'));

      const { code, out } = await run(dir, ['validate']);

      expect(code).toBe(0);
      expect(out).toContain('15 requirements');
      expect(out).toContain('8 access rules');
      expect(out).toContain('16 acceptance criteria');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('check against the fixture, in both configurations', () => {
  it('exits 1 with the defects on and 0 with them off', async () => {
    // The M8 Definition of Done, and the two halves of the MVP success sequence in
    // 01-PRODUCT.md: non-zero before the fix, zero after.
    const defective = workspace();
    const fixed = workspace();

    try {
      copyFileSync(FIXTURE_SPEC, join(defective, 'spec', 'ledger.spec.yaml'));
      copyFileSync(FIXTURE_SPEC, join(fixed, 'spec', 'ledger.spec.yaml'));

      writeConfig(defective, await startLedger(ALL_DEFECTS_ON));
      writeConfig(fixed, await startLedger(ALL_DEFECTS_OFF));

      const withDefects = await run(defective, ['check', '--fail-on', 'high']);
      const withoutDefects = await run(fixed, ['check', '--fail-on', 'high']);

      expect(withDefects.code).toBe(1);
      expect(withoutDefects.code).toBe(0);
    } finally {
      rmSync(defective, { recursive: true, force: true });
      rmSync(fixed, { recursive: true, force: true });
    }
  });

  it('reports the same verdicts the golden run results pin', async () => {
    // The goldens were captured from this application by a script. Reaching them through
    // the command is what says the command and the script agree.
    const dir = workspace();
    try {
      copyFileSync(FIXTURE_SPEC, join(dir, 'spec', 'ledger.spec.yaml'));
      writeConfig(dir, await startLedger(ALL_DEFECTS_ON));

      const { out } = await run(dir, ['check']);

      expect(out).toContain('15 total, 7 verified, 6 failed, 2 unverified');
      expect(out).toContain('24 total, 13 pass, 9 fail, 2 inconclusive');
      expect(out).toContain('high 3, medium 6, low 0, info 0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('puts the report on stdout and the progress on stderr', async () => {
    // So `qai check --format json | jq` works. A progress line on stdout breaks every
    // pipe a user builds, and breaks it quietly.
    const dir = workspace();
    try {
      copyFileSync(FIXTURE_SPEC, join(dir, 'spec', 'ledger.spec.yaml'));
      writeConfig(dir, await startLedger(ALL_DEFECTS_OFF));

      const { out, err } = await run(dir, ['check', '--format', 'json']);

      expect(() => JSON.parse(out) as unknown).not.toThrow();
      expect(err).toContain('Capabilities');
      expect(err).toContain('Probing the target');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes SARIF to a file that the Action can read its outputs from', async () => {
    const dir = workspace();
    try {
      copyFileSync(FIXTURE_SPEC, join(dir, 'spec', 'ledger.spec.yaml'));
      writeConfig(dir, await startLedger(ALL_DEFECTS_ON));

      const { code } = await run(dir, ['check', '--format', 'sarif', '--out', 'qai-results.sarif']);

      expect(code).toBe(1);
      const report = JSON.parse(readFileSync(join(dir, 'qai-results.sarif'), 'utf8')) as {
        version: string;
        runs: { results: unknown[] }[];
      };
      expect(report.version).toBe('2.1.0');
      expect(report.runs[0]?.results.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lets --fail-on-unverified turn a clean run red, and nothing else does', async () => {
    // The fixture always has two unverified requirements: D6 is an entity that was never
    // built, and REQ-007 defines no checks. Off by default, they cost nothing.
    const dir = workspace();
    try {
      copyFileSync(FIXTURE_SPEC, join(dir, 'spec', 'ledger.spec.yaml'));
      writeConfig(dir, await startLedger(ALL_DEFECTS_OFF));

      expect((await run(dir, ['check'])).code).toBe(0);
      expect((await run(dir, ['check', '--fail-on-unverified'])).code).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 3 when the target is not running', async () => {
    const dir = workspace();
    try {
      copyFileSync(FIXTURE_SPEC, join(dir, 'spec', 'ledger.spec.yaml'));
      // A port nothing is listening on: a refused local connection, not the network.
      writeConfig(dir, 'http://127.0.0.1:9');

      const { code, err } = await run(dir, ['check']);

      expect(code).toBe(3);
      expect(err).toContain('could not reach the target');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('probe against the fixture', () => {
  it('sees the debug endpoint with D5 on and not with it off', async () => {
    // D5 is the endpoint nobody specified. A probe that reported it either way would be
    // describing something other than the application in front of it.
    const withD5 = workspace();
    const withoutD5 = workspace();

    try {
      writeConfig(withD5, await startLedger(ALL_DEFECTS_ON));
      writeConfig(withoutD5, await startLedger(ALL_DEFECTS_OFF));

      const on = await run(withD5, ['probe']);
      const off = await run(withoutD5, ['probe']);

      expect(on.code).toBe(0);
      expect(on.out).toContain('/api/debug/state');
      expect(off.out).not.toContain('/api/debug/state');
    } finally {
      rmSync(withD5, { recursive: true, force: true });
      rmSync(withoutD5, { recursive: true, force: true });
    }
  });
});
