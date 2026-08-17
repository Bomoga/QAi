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
  planBehavioralChecks,
  resolveCredentials,
  rulesFor,
  runBehavioralChecks,
  validateAcceptanceCriteria,
  type BehavioralPlan,
  type CheckResult,
} from '../src/index.ts';

/**
 * The S5 exit criterion, run end to end: acceptance criteria from the fixture spec,
 * checked against a running `fixtures/ledger`, passing and failing as the defect
 * switches are turned.
 *
 * This is `qai check` in everything but name for the behavioral half. The command
 * belongs to M8 and lands in S6, so the exit code policy here follows 03-CONTRACTS.md
 * rather than inventing one: 0 for no findings at or above the threshold, 1 for
 * findings, 2 for a spec or configuration error. Inconclusive checks never move it,
 * which is what makes a missing Playwright unable to change the outcome of a run.
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
  const mark =
    result.verdict === 'fail' ? 'FAIL' : result.verdict === 'pass' ? 'pass' : 'unverified';
  const assisted = result.deterministic ? '' : '  [model assisted]';
  return `  ${mark.padEnd(12)}${(result.ruleId ?? '').padEnd(12)}${result.title}${assisted}`;
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

  const { plans, unplannable } = planBehavioralChecks(spec.spec, null, {
    actorIds: new Set(actors.map((actor) => actor.id)),
    resources: config.config.resources,
  });

  // The browser target is configured even though nothing here can open a page, which is
  // the point: the run should report a missing Playwright rather than a missing setup,
  // and the reader should see the line telling them how to enable it.
  const { results, unverified } = await runBehavioralChecks(plans as BehavioralPlan[], {
    sessions,
    /**
     * Who persisted state is read as, named here because `qai.config.yaml` has no field
     * for it. Two assertion forms now need it, the record count and the before and after
     * comparison, so M2 or M8 should give it one rather than every caller choosing.
     *
     * It cannot be the acting actor. The criterion that most needs this comparison acts
     * as `anonymous`, who cannot read the invoice at all, and reading state as the actor
     * under test would report a scoping rule as a state fact.
     */
    stateActorId: 'owner',
    ...(config.config.target.baseUrl === undefined
      ? {}
      : { browser: { baseUrl: config.config.target.baseUrl } }),
    ...(mutatingChecksAllowed(config.config)
      ? { mutation: { allowed: true } }
      : { mutation: { allowed: false, reason: 'the target is not marked disposable' } }),
  });

  process.stdout.write(`${spec.spec.name}\n`);
  process.stdout.write(
    `  ${plans.length} criteria planned, ${unplannable.length} not, ${results.filter((r) => !r.deterministic).length} model assisted\n\n`,
  );

  for (const result of results) process.stdout.write(`${line(result)}\n`);

  const failures = results.filter((result) => result.verdict === 'fail');
  const inconclusive = results.filter((result) => result.verdict === 'inconclusive');

  process.stdout.write(
    `\n${results.length} check(s): ${results.length - failures.length - inconclusive.length} pass, ${failures.length} fail, ${inconclusive.length} unverified\n`,
  );

  for (const failure of failures) {
    process.stdout.write(`\n[${failure.severity}] ${failure.title}\n  ${failure.detail ?? ''}\n`);
  }

  if (unverified.length > 0 || unplannable.length > 0) {
    process.stdout.write(`\nunverified, with reasons\n`);
    for (const entry of unverified) {
      process.stdout.write(
        `  ${entry.criterionId.padEnd(12)}${entry.reason}\n    ${entry.detail}\n`,
      );
    }
    for (const entry of unplannable) {
      process.stdout.write(
        `  ${entry.criterionId.padEnd(12)}${entry.reason}\n    ${entry.detail}\n`,
      );
    }
  }

  const warnings = validateAcceptanceCriteria(spec.spec, 'fixtures/ledger/spec/ledger.spec.yaml');
  process.stdout.write(`\n${warnings.length} authoring warning(s)\n`);

  const threshold = FAIL_ON['medium'] ?? 2;
  const atOrAbove = failures.filter((failure) => (FAIL_ON[failure.severity] ?? 0) >= threshold);

  // The pool is closed before exiting and the code is set rather than forced, for the
  // reason recorded at M3.9: process.exit with undici's keep-alive sockets open trips a
  // libuv assertion on Windows and reports a crash instead of the code the run reached.
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
