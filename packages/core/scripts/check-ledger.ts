import { resolve } from 'node:path';

import { getGlobalDispatcher } from 'undici';

import {
  createActorSessions,
  createHttpClient,
  isConfigFailure,
  isLoadFailure,
  loadConfig,
  loadSpec,
  mutatingChecksAllowed,
  planAccessChecks,
  resolveCredentials,
  runAccessChecks,
  rulesFor,
  type AccessCheckPlan,
  type CheckResult,
} from '../src/index.ts';

/**
 * The S3 exit criterion, run end to end: access checks against fixtures/ledger,
 * reporting the cross-owner leak as a high severity finding with request and response
 * evidence, and exiting 1. Fixing the fixture makes it exit 0.
 *
 * This is `qai check` in everything but name. The command itself belongs to M8 and
 * lands in S6, so the exit code policy here follows 03-CONTRACTS.md rather than
 * inventing one: 0 for no findings at or above the threshold, 1 for findings, 2 for a
 * spec or configuration error.
 *
 * Start the target first, and set the credentials the config names:
 *   PORT=3000 pnpm --filter ledger dev
 *   LEDGER_OWNER_TOKEN, LEDGER_OUTSIDER_TOKEN
 */

const FAIL_ON: Record<string, number> = { high: 3, medium: 2, low: 1, info: 0 };

function repositoryRoot(): string {
  return resolve(import.meta.dirname, '..', '..', '..');
}

function line(result: CheckResult): string {
  const mark = result.verdict === 'fail' ? 'FAIL' : result.verdict === 'pass' ? 'pass' : 'unknown';
  return `  ${mark.padEnd(8)}${(result.ruleId ?? '').padEnd(12)}${result.title}`;
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

  const { plans, unplannable } = planAccessChecks(spec.spec, spec.conditions, null, {
    actorIds: new Set(actors.map((actor) => actor.id)),
    resources: config.config.resources,
  });

  const results = await runAccessChecks(plans as AccessCheckPlan[], {
    sessions,
    mutation: { allowed: mutatingChecksAllowed(config.config) },
  });

  process.stdout.write(`${spec.spec.name}\n`);
  process.stdout.write(`  ${plans.length} access check(s) planned, ${unplannable.length} not\n\n`);

  for (const result of results) process.stdout.write(`${line(result)}\n`);

  const failures = results.filter((result) => result.verdict === 'fail');
  const inconclusive = results.filter((result) => result.verdict === 'inconclusive');

  process.stdout.write(
    `\n${results.length} check(s): ${results.length - failures.length - inconclusive.length} pass, ${failures.length} fail, ${inconclusive.length} inconclusive\n`,
  );

  for (const failure of failures) {
    process.stdout.write(`\n[${failure.severity}] ${failure.title}\n  ${failure.detail ?? ''}\n`);
  }

  const threshold = FAIL_ON['high'] ?? 3;
  const atOrAbove = failures.filter((failure) => (FAIL_ON[failure.severity] ?? 0) >= threshold);

  /**
   * The connection pool is closed before exiting, and the code is set rather than
   * forced. Calling process.exit with undici's keep-alive sockets still open trips a
   * libuv assertion on Windows and reports a crash code instead of the exit code the
   * run actually reached, which for a tool whose exit code is the product is worse
   * than the crash.
   */
  await getGlobalDispatcher().close();
  process.exitCode = atOrAbove.length > 0 ? 1 : 0;
}

function idSource(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return counter.toString(16).padStart(6, '0');
  };
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  await main();
}
