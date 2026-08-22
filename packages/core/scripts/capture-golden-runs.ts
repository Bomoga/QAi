import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getGlobalDispatcher } from 'undici';

import {
  assembleRun,
  collectCoverageGaps,
  createActorSessions,
  createHttpClient,
  diffSpecObservation,
  fixedDeps,
  isConfigFailure,
  isLoadFailure,
  loadConfig,
  loadSpec,
  mutatingChecksAllowed,
  planAccessChecks,
  planBehavioralChecks,
  probe,
  renderJson,
  resolveCredentials,
  rulesFor,
  runAccessChecks,
  runBehavioralChecks,
  type AccessCheckPlan,
  type BehavioralPlan,
  type CheckResult,
  type CheckResultRecord,
} from '../src/index.ts';

/**
 * Captures a golden `RunResult` for one configuration of `fixtures/ledger`.
 *
 * 06-TESTING.md asks for canonical run results in both the defective and the fixed
 * configuration, and says to regenerate them only with an explicit command whose diff a
 * human reads. This is that command. Nothing in the suite calls it, and a golden that
 * changed is a question rather than a chore.
 *
 * **Everything nondeterministic is injected.** `fixedDeps` supplies the clock and the
 * identifier source, per rule R6, and the run id and the two instants are literals here.
 * Without that, every capture would differ in the timestamps and the evidence ids and
 * the file would be testing the calendar.
 *
 * Run it against a target you started yourself, once per configuration, since the defect
 * switches are the ledger's environment and a restart is its reset:
 *
 * ```
 * # defective, the switches default to on
 * PORT=3000 pnpm --filter ledger dev
 * pnpm --filter @qai/core capture:goldens defective
 *
 * # fixed
 * LEDGER_DEFECT_D1=off LEDGER_DEFECT_D2=off LEDGER_DEFECT_D3=off \
 *   LEDGER_DEFECT_D4=off LEDGER_DEFECT_D5=off PORT=3000 pnpm --filter ledger dev
 * pnpm --filter @qai/core capture:goldens fixed
 * ```
 *
 * `LEDGER_OWNER_TOKEN`, `LEDGER_OUTSIDER_TOKEN`, and `LEDGER_UNKNOWN_TOKEN` all have to
 * be set. Every configured actor must resolve or the run stops at exit code 2, which is
 * `resolveCredentials` refusing to hand out a blank credential that would come back as a
 * 401 looking like a finding.
 */

const CONFIGURATIONS = ['defective', 'fixed'] as const;
type Configuration = (typeof CONFIGURATIONS)[number];

function isConfiguration(value: string | undefined): value is Configuration {
  return CONFIGURATIONS.some((name) => name === value);
}

function repositoryRoot(): string {
  return resolve(import.meta.dirname, '..', '..', '..');
}

/**
 * Pinned rather than read from `package.json`.
 *
 * A golden carrying the real version would churn on every release and the diff a human
 * is asked to classify would be noise. What these files exist to pin is the shape of a
 * run, not which build produced it.
 */
const GOLDEN_TOOL_VERSION = '0.1.0';
const GOLDEN_STARTED_AT = '2026-01-01T00:00:00.000Z';
const GOLDEN_FINISHED_AT = '2026-01-01T00:00:30.000Z';

async function main(): Promise<void> {
  const root = repositoryRoot();
  const requested = process.argv[2];

  if (!isConfiguration(requested)) {
    process.stdout.write(
      `usage: capture-golden-runs <${CONFIGURATIONS.join('|')}>\nStart fixtures/ledger in that configuration first.\n`,
    );
    process.exitCode = 2;
    return;
  }

  const specPath = 'fixtures/ledger/spec/ledger.spec.yaml';
  const spec = loadSpec([specPath], { cwd: root });
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
    process.stdout.write(
      `missing credentials: ${missing.map((entry) => entry.variable).join(', ')}\n`,
    );
    process.exitCode = 2;
    return;
  }

  const baseUrl = config.config.target.baseUrl;
  if (baseUrl === undefined) {
    process.stdout.write('qai.config.yaml names no baseUrl, so there is nothing to capture.\n');
    process.exitCode = 2;
    return;
  }

  const sessions = createActorSessions(actors, {
    client: createHttpClient({ baseUrl }),
    rules: rulesFor(spec.spec, config.config.redaction.extraPatterns),
    deps: fixedDeps(GOLDEN_STARTED_AT),
  });

  const observation = await probe(
    { config: { target: { baseUrl } }, sessions },
    { deps: fixedDeps(GOLDEN_STARTED_AT), baseUrl },
  );

  const planning = {
    actorIds: new Set(actors.map((actor) => actor.id)),
    resources: config.config.resources,
  };

  const access = planAccessChecks(spec.spec, spec.conditions, observation, planning);
  const behavioral = planBehavioralChecks(spec.spec, observation, planning);

  const accessResults = await runAccessChecks(access.plans as AccessCheckPlan[], {
    sessions,
    mutation: { allowed: mutatingChecksAllowed(config.config) },
  });

  const { results: behavioralResults, unverified } = await runBehavioralChecks(
    behavioral.plans as BehavioralPlan[],
    {
      sessions,
      ...(config.config.stateActor === undefined ? {} : { stateActorId: config.config.stateActor }),
      browser: { baseUrl },
      ...(mutatingChecksAllowed(config.config)
        ? { mutation: { allowed: true } }
        : { mutation: { allowed: false, reason: 'the target is not marked disposable' } }),
    },
  );

  const checks: CheckResult[] = [...accessResults, ...behavioralResults];

  const result = assembleRun({
    runId: `RUN-golden-${requested}`,
    toolVersion: GOLDEN_TOOL_VERSION,
    startedAt: GOLDEN_STARTED_AT,
    finishedAt: GOLDEN_FINISHED_AT,
    spec: spec.spec,
    specHash: spec.hash,
    specFiles: [specPath],
    target: {
      baseUrl,
      ...(config.config.target.sourceRoot === undefined
        ? {}
        : { sourceRoot: config.config.target.sourceRoot }),
    },
    observationRef: `OBS-golden-${requested}`,
    observation,
    checks: checks as CheckResultRecord[],
    structural: diffSpecObservation(spec.spec, observation, config.config.resources),
    // All three side channels through one collector, so a caller that remembered two
    // cannot drop the third, which is what M5.16 exists to prevent.
    gaps: collectCoverageGaps({
      accessUnplannable: access.unplannable,
      behavioralUnplannable: behavioral.unplannable,
      behavioralUnverified: unverified,
    }),
  });

  const directory = resolve(root, 'packages', 'core', 'src', 'report', 'goldens');
  mkdirSync(directory, { recursive: true });
  const file = resolve(directory, `${requested}.run.json`);
  writeFileSync(file, renderJson(result), 'utf8');

  const { requirements, checks: tally, coverage, modelAssistedCheckCount } = result.summary;
  process.stdout.write(`wrote ${file}\n`);
  process.stdout.write(
    `  requirements: ${requirements.total} total, ${requirements.verified} verified, ${requirements.failed} failed, ${requirements.unverified} unverified\n`,
  );
  process.stdout.write(
    `  checks: ${tally.total} total, ${tally.pass} pass, ${tally.fail} fail, ${tally.inconclusive} inconclusive\n`,
  );
  process.stdout.write(
    `  coverage ${Math.round(coverage * 100)}% of requirements with at least one check that reached a verdict\n`,
  );
  process.stdout.write(`  model assisted checks: ${modelAssistedCheckCount}\n`);
  process.stdout.write(`  observed ${observation.endpoints.length} endpoint(s)\n`);

  // Closed before exiting, per M3.9: process.exit with undici's keep-alive sockets open
  // trips a libuv assertion on Windows and reports a crash instead of the code reached.
  await getGlobalDispatcher().close();
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  await main();
}
