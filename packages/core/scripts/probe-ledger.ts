import { resolve } from 'node:path';

import { getGlobalDispatcher } from 'undici';

import {
  createActorSessions,
  createHttpClient,
  diffSpecObservation,
  isConfigFailure,
  isLoadFailure,
  loadConfig,
  loadSpec,
  probe,
  resolveCredentials,
  rulesFor,
  SPECIFIED_NOT_OBSERVED_SEVERITY,
} from '../src/index.ts';

/**
 * The S4 exit criterion, run end to end: an Observation of fixtures/ledger naming every
 * endpoint with its origin and confidence, and a structural diff reporting an endpoint
 * that exists and appears in no requirement.
 *
 * This is `qai probe` in everything but name. The command belongs to M8 and lands in
 * S6, the same gap S1, S2 and S3 hit, so the behavior is demonstrated here instead.
 *
 * The ledger is probed black box. M4's adapters target Next.js, Express and Prisma, and
 * the ledger is a hand-written node:http server, so every endpoint carries
 * origin blackbox with reduced confidence. That was decided at the start of the stage.
 *
 * Start the target first, and set the credentials the config names:
 *   PORT=3000 pnpm --filter ledger dev
 *   LEDGER_OWNER_TOKEN, LEDGER_OUTSIDER_TOKEN, LEDGER_UNKNOWN_TOKEN
 *
 * Every configured actor must resolve or the run stops at exit code 2, so the third
 * variable is required since `impostor` was configured at M5.13. It holds a token
 * matching no seeded user.
 */

function repositoryRoot(): string {
  return resolve(import.meta.dirname, '..', '..', '..');
}

function idSource(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return counter.toString(16).padStart(6, '0');
  };
}

async function main(): Promise<void> {
  const root = repositoryRoot();

  const spec = loadSpec(['fixtures/ledger/spec/ledger.spec.yaml'], { cwd: root });
  if (isLoadFailure(spec)) {
    process.stdout.write(`${spec.error.message}\n`);
    process.exitCode = 2;
    return;
  }

  const config = loadConfig('qai.config.yaml', root);
  if (isConfigFailure(config)) {
    process.stdout.write(`${config.error.message}\n`);
    process.exitCode = 2;
    return;
  }

  const { actors, missing } = resolveCredentials(config.config.actors, process.env);
  if (missing.length > 0) {
    process.stdout.write(`missing credentials: ${missing.map((m) => m.variable).join(', ')}\n`);
    process.exitCode = 2;
    return;
  }

  const sessions = createActorSessions(actors, {
    client: createHttpClient(
      config.config.target.baseUrl === undefined ? {} : { baseUrl: config.config.target.baseUrl },
    ),
    rules: rulesFor(spec.spec, config.config.redaction.extraPatterns),
    deps: { now: () => new Date().toISOString(), nextId: idSource() },
  });

  const observation = await probe(
    { config: config.config, sessions },
    { deps: { now: () => new Date().toISOString(), nextId: idSource() }, cwd: root },
  );

  process.stdout.write(`${spec.spec.name}\n`);
  process.stdout.write(`  probe mode   ${observation.mode}\n`);
  process.stdout.write(`  observed at  ${observation.observedAt}\n\n`);

  process.stdout.write(`endpoints (${observation.endpoints.length})\n`);
  for (const endpoint of observation.endpoints) {
    process.stdout.write(
      `  ${endpoint.id.padEnd(26)}${endpoint.origin.padEnd(10)}${endpoint.confidence.padEnd(8)}auth ${String(endpoint.authRequired).padEnd(8)}${endpoint.evidence.join(', ')}\n`,
    );
  }

  process.stdout.write(`\nentities (${observation.entities.length})\n`);
  for (const entity of observation.entities) {
    process.stdout.write(`  ${entity.name.padEnd(26)}${entity.origin}\n`);
  }

  if (observation.notes.length > 0) {
    process.stdout.write(`\nnotes (${observation.notes.length})\n`);
    for (const note of observation.notes) {
      process.stdout.write(`  [${note.level}] ${note.message}\n`);
    }
  }

  const structural = diffSpecObservation(spec.spec, observation);

  process.stdout.write(
    `\nobserved and not specified (${structural.observedNotSpecified.length})\n`,
  );
  for (const entry of structural.observedNotSpecified) {
    process.stdout.write(`  [${entry.severity.padEnd(6)}] ${entry.kind} ${entry.id}\n`);
  }

  process.stdout.write(
    `\nspecified and not observed (${structural.specifiedNotObserved.length})\n`,
  );
  for (const entry of structural.specifiedNotObserved) {
    process.stdout.write(
      `  [${SPECIFIED_NOT_OBSERVED_SEVERITY.padEnd(6)}] ${entry.kind} ${entry.name}, required by ${entry.requirementIds.join(', ')}\n`,
    );
  }

  process.stdout.write(`\nfield mismatches (${structural.fieldMismatches.length})\n`);
  for (const entry of structural.fieldMismatches) {
    process.stdout.write(
      `  ${entry.entity}: observed and not specified [${entry.observedNotSpecified.join(', ')}], specified and not observed [${entry.specifiedNotObserved.join(', ')}]\n`,
    );
  }

  const undeclared = structural.observedNotSpecified.filter((entry) => entry.severity !== 'info');
  process.stdout.write(
    `\n${undeclared.length} endpoint(s) exist and appear in no requirement, above info severity\n`,
  );

  /**
   * The pool is closed and the code set rather than forced, for the reason recorded at
   * S3: process.exit with undici's keep-alive sockets open trips a libuv assertion on
   * Windows and reports a crash code instead of the exit code the run reached.
   */
  await getGlobalDispatcher().close();
  process.exitCode = undeclared.length > 0 ? 1 : 0;
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  await main();
}
