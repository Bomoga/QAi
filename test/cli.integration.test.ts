import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { createLedgerServer } from '../fixtures/ledger/src/app.ts';
import { OUTSIDER_TOKEN, OWNER_TOKEN, seedLedger } from '../fixtures/ledger/src/data.ts';
import type { DefectSwitches } from '../fixtures/ledger/src/defects.ts';
import { main } from '../packages/cli/src/index.ts';
import type { Stream } from '../packages/cli/src/reporter.ts';

/**
 * The end to end test the M8 Definition of Done asks for: `init`, then `validate`, then
 * `check` against the real fixture app over a real socket, in both configurations.
 *
 * It drives `main` rather than spawning the binary. Spawning would test that pnpm linked
 * a bin, which is true or false regardless of anything in this repository, and would make
 * every assertion about a subprocess's stdout rather than about the command. `main`
 * already takes its streams, its environment, and its working directory as arguments for
 * exactly this reason.
 *
 * Both directions are pinned. Exit 1 with the defect switches on and 0 with them off, so
 * a command that always failed or always passed breaks one of them. That is the trap S3,
 * S4, and S5 each nearly fell into.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_SPEC = join(ROOT, 'fixtures', 'ledger', 'spec', 'ledger.spec.yaml');

/** A token belonging to no seeded user, which is what the impostor actor presents. */
const UNKNOWN_TOKEN = 'ledger-unknown-token';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((done) => {
          server.close(() => {
            done();
          });
        }),
    ),
  );
});

async function startLedger(defects: Partial<DefectSwitches>): Promise<string> {
  const server = createLedgerServer({ data: seedLedger(), defects: defects as DefectSwitches });
  servers.push(server);

  await new Promise<void>((done) => {
    server.listen(0, '127.0.0.1', () => {
      done();
    });
  });

  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port was assigned');
  return `http://127.0.0.1:${address.port}`;
}

const ALL_DEFECTS_ON: DefectSwitches = {
  d1CrossOrgInvoiceRead: true,
  d2UnscopedInvoiceList: true,
  d3UnauthenticatedMutation: true,
  d4NotesInInvoiceList: true,
  d5UndeclaredDebugEndpoint: true,
};

const ALL_DEFECTS_OFF: DefectSwitches = {
  d1CrossOrgInvoiceRead: false,
  d2UnscopedInvoiceList: false,
  d3UnauthenticatedMutation: false,
  d4NotesInInvoiceList: false,
  d5UndeclaredDebugEndpoint: false,
};

/** The config a user would have, with the port this test's server happened to get. */
function writeConfig(dir: string, baseUrl: string): void {
  writeFileSync(
    join(dir, 'qai.config.yaml'),
    [
      'target:',
      `  baseUrl: ${baseUrl}`,
      '  disposable: true',
      `  resetCommand: 'node -e "process.stdout.write(1)"'`,
      'actors:',
      '  - id: owner',
      '    auth: { kind: bearer, tokenEnv: LEDGER_OWNER_TOKEN }',
      '    attributes: { org_id: org-1 }',
      '  - id: outsider',
      '    auth: { kind: bearer, tokenEnv: LEDGER_OUTSIDER_TOKEN }',
      '    attributes: { org_id: org-2 }',
      '  - id: anonymous',
      '    auth: { kind: none }',
      '    attributes: {}',
      '  - id: impostor',
      '    auth: { kind: bearer, tokenEnv: LEDGER_UNKNOWN_TOKEN }',
      '    attributes: {}',
      'stateActor: owner',
      'resources:',
      '  - name: Invoice',
      '    routes:',
      '      read: /api/invoices/{id}',
      '      list: /api/invoices',
      '      update: /api/invoices/{id}',
      '      delete: /api/invoices/{id}',
      '    instances:',
      '      - id: INV-1001',
      '        attributes: { org_id: org-1 }',
      '      - id: INV-2001',
      '        attributes: { org_id: org-2 }',
      '',
    ].join('\n'),
    'utf8',
  );
}

const ENV = {
  LEDGER_OWNER_TOKEN: OWNER_TOKEN,
  LEDGER_OUTSIDER_TOKEN: OUTSIDER_TOKEN,
  LEDGER_UNKNOWN_TOKEN: UNKNOWN_TOKEN,
};

function capture(): { stream: Stream; text: () => string } {
  const chunks: string[] = [];
  return {
    stream: { write: (chunk: string) => void chunks.push(chunk) },
    text: () => chunks.join(''),
  };
}

async function run(
  dir: string,
  argv: readonly string[],
): Promise<{ code: number; out: string; err: string }> {
  const out = capture();
  const err = capture();
  const code = await main(['node', 'qai', ...argv], {
    stdout: out.stream,
    stderr: err.stream,
    env: ENV,
    cwd: dir,
  });
  return { code, out: out.text(), err: err.text() };
}

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qai-e2e-'));
  mkdirSync(join(dir, 'spec'), { recursive: true });
  return dir;
}

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
