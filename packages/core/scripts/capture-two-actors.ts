import { resolve } from 'node:path';

import { isLoadFailure, loadSpec } from '../src/spec/load.ts';
import { isConfigFailure, loadConfig } from '../src/target/config.ts';
import { createTargetContext, describeCapabilities } from '../src/target/context.ts';
import { systemDeps } from '../src/target/deps.ts';

/**
 * The S2 exit criterion, run end to end: authenticate two distinct actors against
 * fixtures/ledger, issue one request as each, and write two redacted evidence records
 * to .qai/evidence/.
 *
 * Start the target first:
 *   PORT=3000 pnpm --filter ledger dev
 *
 * and set the credentials the config names:
 *   LEDGER_OWNER_TOKEN, LEDGER_OUTSIDER_TOKEN, LEDGER_UNKNOWN_TOKEN
 *
 * Every configured actor must resolve or the run stops at exit code 2, so the third
 * variable is required since `impostor` was configured at M5.13. It holds a token
 * matching no seeded user.
 */

function repositoryRoot(): string {
  return resolve(import.meta.dirname, '..', '..', '..');
}

async function main(): Promise<void> {
  const root = repositoryRoot();

  const specResult = loadSpec(['fixtures/ledger/spec/ledger.spec.yaml'], { cwd: root });
  if (isLoadFailure(specResult)) {
    process.stdout.write(`${specResult.error.message}\n`);
    process.exit(2);
  }

  const configResult = loadConfig('qai.config.yaml', root);
  if (isConfigFailure(configResult)) {
    process.stdout.write(`${configResult.error.message}\n`);
    for (const diagnostic of configResult.error.diagnostics) {
      process.stdout.write(`  ${diagnostic.path}: ${diagnostic.message}\n`);
    }
    process.exit(2);
  }

  const context = createTargetContext(configResult.config, specResult.spec, {
    env: process.env,
    deps: systemDeps(),
    cwd: root,
  });

  for (const line of describeCapabilities(context.capabilities)) {
    process.stdout.write(`${line}\n`);
  }
  process.stdout.write('\n');

  const owner = context.sessions.get('owner');
  const outsider = context.sessions.get('outsider');
  if (owner === undefined || outsider === undefined) {
    process.stdout.write('both owner and outsider must resolve for this script to mean anything\n');
    process.exit(2);
  }

  const path = '/api/invoices/INV-1001';

  for (const session of [owner, outsider]) {
    const { outcome, evidence } = await session.request({ method: 'GET', path });

    if (outcome.kind === 'transport-error') {
      process.stdout.write(`${session.id}: ${outcome.message}\n`);
      process.exit(3);
    }

    process.stdout.write(
      `${session.id.padEnd(9)} GET ${path} -> ${outcome.response.status}, evidence ${evidence.id}\n`,
    );
    process.stdout.write(`          redactions: ${evidence.redactions.join(', ') || 'none'}\n`);
    process.stdout.write(`          bodyRef:    ${evidence.response?.bodyRef ?? 'none'}\n`);
  }
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  await main();
}
