import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLedgerServer } from '../../fixtures/ledger/src/app.ts';
import { OUTSIDER_TOKEN, OWNER_TOKEN, seedLedger } from '../../fixtures/ledger/src/data.ts';
import type { DefectSwitches } from '../../fixtures/ledger/src/defects.ts';
import { main } from '../../packages/cli/src/index.ts';
import type { Stream } from '../../packages/cli/src/reporter.ts';

/**
 * The harness every integration test that needs a live fixture shares.
 *
 * **Each test starts its own ledger on an ephemeral port.** A leftover server cost this
 * project an hour at M7.7, because a run writes and the state it left behind no longer
 * matched the seed. Starting one per test turns that hazard into a property of the tests.
 *
 * **One description of the fixture's configuration.** Two copies of this file's config
 * would drift, and the drift would show up as a test that fails for a reason unrelated
 * to what it was testing.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURE_SPEC = join(ROOT, 'fixtures', 'ledger', 'spec', 'ledger.spec.yaml');

/** A token belonging to no seeded user, which is what the impostor actor presents. */
export const UNKNOWN_TOKEN = 'ledger-unknown-token';

export const ALL_DEFECTS_ON: DefectSwitches = {
  d1CrossOrgInvoiceRead: true,
  d2UnscopedInvoiceList: true,
  d3UnauthenticatedMutation: true,
  d4NotesInInvoiceList: true,
  d5UndeclaredDebugEndpoint: true,
};

export const ALL_DEFECTS_OFF: DefectSwitches = {
  d1CrossOrgInvoiceRead: false,
  d2UnscopedInvoiceList: false,
  d3UnauthenticatedMutation: false,
  d4NotesInInvoiceList: false,
  d5UndeclaredDebugEndpoint: false,
};

const servers: Server[] = [];

export async function startLedger(defects: Partial<DefectSwitches>): Promise<string> {
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

/** Closes every ledger this file started. Call it from an afterEach or an afterAll. */
export async function stopLedgers(): Promise<void> {
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
}

/** The config a user would have, with the port this test's server happened to get. */
export function writeConfig(dir: string, baseUrl: string): void {
  writeFileSync(
    join(dir, 'qai.config.yaml'),
    [
      'target:',
      `  baseUrl: ${baseUrl}`,
      '  disposable: true',
      /**
       * A reset that exits 0 and restores nothing, which is the honest state of this
       * fixture: the ledger holds its data in memory and a restart is its only real
       * reset, so nothing outside the process can put a record back.
       *
       * It used to read `process.stdout.write(1)`, which throws, and nobody noticed
       * because no caller ever supplied a reset function to the runner. Wiring one up
       * turned two mutating checks inconclusive and that is how this was found. Worth
       * keeping in mind: a command in a fixture that nothing executes is not tested by
       * anything, however plausible it looks.
       */
      `  resetCommand: 'node -e "process.exit(0)"'`,
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

export const ENV = {
  LEDGER_OWNER_TOKEN: OWNER_TOKEN,
  LEDGER_OUTSIDER_TOKEN: OUTSIDER_TOKEN,
  LEDGER_UNKNOWN_TOKEN: UNKNOWN_TOKEN,
};

export function capture(): { stream: Stream; text: () => string } {
  const chunks: string[] = [];
  return {
    stream: { write: (chunk: string) => void chunks.push(chunk) },
    text: () => chunks.join(''),
  };
}

/**
 * Drives `main` rather than spawning the binary.
 *
 * Spawning would test that pnpm linked a bin, which is true or false regardless of
 * anything in this repository, and would make every assertion about a subprocess's
 * stdout rather than about the command.
 */
export async function runCli(
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

export function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qai-e2e-'));
  mkdirSync(join(dir, 'spec'), { recursive: true });
  return dir;
}
