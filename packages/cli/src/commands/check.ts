import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import {
  assembleRun,
  collectCoverageGaps,
  computeExitCode,
  createEvidenceWriter,
  createTargetContext,
  diffSpecObservation,
  openStore,
  isLoadFailure,
  isTransportError,
  loadSpec,
  mutatingChecksAllowed,
  planAccessChecks,
  planBehavioralChecks,
  probe,
  renderJson,
  renderJunit,
  renderSarif,
  renderText,
  resolveBrowserCapability,
  runAccessChecks,
  runBehavioralChecks,
  systemDeps,
  type AccessCheckPlan,
  type BehavioralPlan,
  type CapabilityReport,
  type CheckResultRecord,
  type Evidence,
  type EvidenceWriter,
  type Observation,
  type Deps,
  type PruneReport,
  type Reporter,
  type RunResult,
  type SaveReport,
  type TargetConfig,
} from '@qai/core';

import type { Stream } from '../reporter.ts';
import { fromDiagnostic, present, presentAll } from '../errors.ts';
import { CLI_VERSION } from '../program.ts';
import type { Settings } from '../settings.ts';
import { DEFAULT_SPEC_GLOB } from './validate.ts';

/**
 * `qai check`: the full run, and the only command that produces a RunResult.
 *
 * **Nothing here decides a verdict.** The module says this package contains no
 * verification logic, so every judgment in this file belongs to `core`: `planAccessChecks`
 * and `planBehavioralChecks` decide what can be checked, the runners decide the verdicts,
 * `assembleRun` rolls them up, and `computeExitCode` turns the policy into a number. This
 * function moves data between them and applies the number at the end.
 *
 * **The capability report comes first, before any work.** A run that checks almost
 * nothing and exits zero is the failure mode the report exists for: a reader seeing "no
 * findings" cannot tell that from a clean bill of health unless the tool says what it
 * could not do. Printing it afterwards would be printing it too late to be believed.
 *
 * **Exit codes.** 0 and 1 come from `computeExitCode` and are applied without being
 * recomputed. 2 and 3 are this package's, because they describe conditions under which
 * no RunResult exists: an invalid spec or configuration, and a target that could not be
 * reached at all.
 *
 * **Every run is recorded.** `qai diff` and `qai report` read runs out of `.qai/runs.db`
 * and nothing else puts one there, so a check that did not store its result would leave
 * the sixth step of the success sequence in 01-PRODUCT.md unreachable. It is not behind
 * a flag: the command table in the module has no flag for it, and adding one would be a
 * change to the surface.
 *
 * **A store that will not write does not fail the run.** The report is the product and
 * it has already been produced by then; turning a completed run into an error because a
 * database file could not be written would report the wrong thing about the application.
 * It is a warning, and a loud one, because a user who never notices will wonder later
 * why `qai diff` has nothing to compare.
 */

export interface CheckOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Spec paths from the command line. Empty means the default glob. */
  readonly paths: readonly string[];
  readonly config: TargetConfig | undefined;
  readonly configPath: string;
  readonly settings: Settings;
  readonly stdout: Stream;
  readonly stderr: Stream;
  readonly reporter: Reporter;
  /** Whether stdout is a terminal, so the text report can be coloured. */
  readonly color?: boolean;
  /** Adds a stack trace to any error this prints. */
  readonly verbose?: boolean;
  /** Injected so a test can pin the clock and the identifier source, per rule R6. */
  readonly deps?: Deps;
}

/** `RUN-20260818-180338`, derived from the injected clock rather than read from one. */
export function runIdFrom(instant: string): string {
  return `RUN-${stamp(instant)}`;
}

/** The run's Observation, named off the same instant so the pair reads as one run. */
export function observationIdFrom(instant: string): string {
  return `OBS-${stamp(instant)}`;
}

/**
 * `20260818-180338` from an ISO instant: date, then hours, minutes, and seconds.
 *
 * Seconds are in it because the store keys runs by id and refuses a duplicate rather than
 * overwriting one. At minute resolution two runs a few seconds apart collided, which is
 * exactly what happens when somebody checks, fixes something, and checks again, and is
 * also what the S7 exit criterion does on purpose.
 */
function stamp(instant: string): string {
  const digits = instant.replace(/\D/g, '');
  return `${digits.slice(0, 8)}-${digits.slice(8, 14)}`;
}

/**
 * The capability report, said out loud at the start.
 *
 * `createTargetContext` already phrases every gap as what will not be checked, and the
 * contract calls those lines something a surface prints verbatim, so they are printed
 * verbatim. The available half is stated too: a reader seeing only warnings cannot tell
 * a clean setup from an unreported gap.
 */
function reportCapabilities(
  capabilities: CapabilityReport,
  browserAvailable: boolean,
  reporter: Reporter,
): void {
  reporter.step('Capabilities');
  reporter.info(`target: ${capabilities.baseUrl ?? 'not configured'}`);
  reporter.info(
    `source: ${
      capabilities.sourceRoot === undefined
        ? 'not configured'
        : `${capabilities.sourceRoot}${capabilities.sourcePresent ? '' : ' (missing)'}`
    }`,
  );
  reporter.info(
    capabilities.actorIds.length === 0
      ? 'actors: none resolved'
      : `actors: ${capabilities.actorIds.join(', ')}`,
  );
  reporter.info(`fixtures: ${capabilities.fixturesAvailable ? 'available' : 'refused'}`);
  reporter.info(`browser: ${browserAvailable ? 'available' : 'not installed'}`);

  for (const warning of capabilities.warnings) reporter.warn(warning);

  if (!browserAvailable) {
    reporter.warn(
      'Playwright is not installed, so any criterion with mode fuzzy will be reported unverified with reason capability-unavailable. Install playwright to enable it.',
    );
  }
}

/**
 * The real writer, plus a list of what it wrote.
 *
 * The Evidence records exist inside the session layer and reach a CheckResult as ids
 * only, so this is how the command gets the records themselves without changing a
 * signature owned by M3 or M5. `createTargetContext` already takes a writer, so nothing
 * new had to be invented for it.
 */
function recordingWriter(cwd: string, into: Evidence[]): EvidenceWriter {
  const real = createEvidenceWriter({ cwd });
  return {
    write(capture) {
      real.write(capture);
      into.push(capture.evidence);
    },
  };
}

/** What retention removed, or nothing at all when it removed nothing. */
function describePrune(report: PruneReport): string | undefined {
  const { runsRemoved, evidenceRemoved, bodiesDeleted } = report;
  if (runsRemoved.length === 0 && evidenceRemoved.length === 0) return undefined;

  const parts = [
    `kept the last ${report.policy.keepRuns} run(s) and the evidence for ${report.policy.keepEvidence}`,
  ];

  if (runsRemoved.length > 0) parts.push(`removed ${runsRemoved.join(', ')}`);
  if (evidenceRemoved.length > 0) {
    parts.push(
      `dropped ${evidenceRemoved.length} evidence record(s) and ${bodiesDeleted.length} body file(s)`,
    );
  }

  return `retention: ${parts.join('; ')}`;
}

/**
 * Records the run, and says what that cost. Never throws: see the note at the top.
 */
function store(
  cwd: string,
  result: RunResult,
  evidence: readonly Evidence[],
  reporter: Reporter,
): void {
  let saved: SaveReport;
  // The open is inside the guard as well as the write. A database written by a newer
  // build is refused rather than opened, and that refusal must not take a finished run
  // with it.
  let opened: ReturnType<typeof openStore> | undefined;

  try {
    opened = openStore(cwd);
    saved = opened.saveRun(result, evidence);
  } catch (error) {
    reporter.warn(
      `the run was not recorded, so "qai diff" and "qai report" will not see it: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  } finally {
    opened?.close();
  }

  reporter.info(`recorded ${saved.runId} with ${saved.evidenceRecorded} evidence record(s)`);

  if (saved.bodiesMissing.length > 0) {
    reporter.warn(
      `${saved.bodiesMissing.length} evidence record(s) name a body file that is not on disk: ${saved.bodiesMissing.join(', ')}`,
    );
  }

  // Pruning is reported rather than done silently, which is the module's rule and the
  // reason the store hands the report back with the save.
  const pruned = describePrune(saved.pruned);
  if (pruned !== undefined) reporter.info(pruned);
}

function render(
  result: RunResult,
  format: Settings['format']['value'],
  observation: Observation,
  color: boolean,
): string {
  if (format === 'json') return renderJson(result);
  if (format === 'sarif') return renderSarif(result);
  if (format === 'junit') return renderJunit(result);
  // The Observation goes in because RunResult carries only a reference to it, and the
  // text report's second section is entity and endpoint counts by origin and confidence.
  // This is the caller M7.3 added `TextOptions.observation` for.
  return renderText(result, { observation, color });
}

export async function runCheck(options: CheckOptions): Promise<number> {
  const { cwd, env, settings, stdout, stderr, reporter } = options;
  const deps = options.deps ?? systemDeps();
  const config = options.config;
  const presentTo = { stderr, ...(options.verbose === true ? { verbose: true } : {}) };

  // Everything that means no run can happen is settled first, so nothing below has to
  // ask whether it has a target.
  if (config === undefined) {
    return present(
      {
        code: 2,
        summary: 'no configuration was found',
        where: options.configPath,
        suggestion: 'Run "qai init" to write one, or pass --config with the path to yours.',
      },
      presentTo,
    );
  }

  const requested = options.paths.length > 0 ? options.paths : [DEFAULT_SPEC_GLOB];
  const loaded = loadSpec(requested, { cwd });
  if (isLoadFailure(loaded)) {
    if (loaded.error.diagnostics.length === 0) {
      return present(
        {
          code: 2,
          summary: loaded.error.message,
          where: requested.join(', '),
          suggestion: 'Run "qai validate" to see what the loader looked for.',
        },
        presentTo,
      );
    }
    return presentAll(
      loaded.error.diagnostics.map((diagnostic) =>
        fromDiagnostic(diagnostic, loaded.error.message),
      ),
      presentTo,
    );
  }

  const startedAt = deps.now();
  const evidence: Evidence[] = [];
  const target = createTargetContext(config, loaded.spec, {
    env,
    deps,
    cwd,
    writer: recordingWriter(cwd, evidence),
  });
  const browser = await resolveBrowserCapability();
  reportCapabilities(target.capabilities, browser.kind === 'available', reporter);

  const baseUrl = config.target.baseUrl;
  if (baseUrl === undefined) {
    return present(
      {
        code: 2,
        summary: 'the target has no base URL',
        where: `${options.configPath}, at target.baseUrl`,
        reason: 'A check issues requests, so it needs somewhere to send them.',
        suggestion: 'Set target.baseUrl in the config, for example http://localhost:3000.',
      },
      presentTo,
    );
  }

  // One request before anything else, so an unreachable target is reported as one rather
  // than as a report full of inconclusive checks. Exit 3 with the URL and the reason.
  reporter.step(`Reaching ${baseUrl}`);
  // Unauthenticated on purpose. Whether the root answers 200 or 401 is a fact about the
  // application; whether anything answered at all is the fact this is asking for.
  const reachability = await target.client.send({ method: 'GET', path: '/' }, { kind: 'none' });
  if (isTransportError(reachability)) {
    // Exit 3: the target is unreachable, so no run happened at all.
    return present(
      {
        code: 3,
        summary: 'could not reach the target',
        where: baseUrl,
        reason: reachability.message,
        suggestion: 'Start the application, or correct target.baseUrl in the config.',
      },
      presentTo,
    );
  }

  reporter.step('Probing the target');
  const observation = await probe(
    { config: { target: { baseUrl } }, sessions: target.sessions },
    { deps, baseUrl, cwd },
  );
  reporter.info(
    `${observation.endpoints.length} endpoint(s) and ${observation.entities.length} entity(ies) observed`,
  );

  const planning = {
    actorIds: new Set(target.sessions.keys()),
    resources: config.resources,
  };

  reporter.step('Planning checks');
  const access = planAccessChecks(loaded.spec, loaded.conditions, observation, planning);
  const behavioral = planBehavioralChecks(loaded.spec, observation, planning);
  reporter.info(
    `${access.plans.length} access check(s) and ${behavioral.plans.length} behavioral check(s) planned`,
  );

  reporter.step('Running checks');
  const accessResults = await runAccessChecks(access.plans as AccessCheckPlan[], {
    sessions: target.sessions,
    mutation: { allowed: mutatingChecksAllowed(config) },
  });

  const { results: behavioralResults, unverified } = await runBehavioralChecks(
    behavioral.plans as BehavioralPlan[],
    {
      sessions: target.sessions,
      ...(config.stateActor === undefined ? {} : { stateActorId: config.stateActor }),
      browser: { baseUrl },
      ...(mutatingChecksAllowed(config)
        ? { mutation: { allowed: true } }
        : { mutation: { allowed: false, reason: 'the target is not marked disposable' } }),
    },
  );

  const result = assembleRun({
    runId: runIdFrom(startedAt),
    toolVersion: CLI_VERSION,
    startedAt,
    finishedAt: deps.now(),
    spec: loaded.spec,
    specHash: loaded.hash,
    specFiles: loaded.files,
    observationRef: observationIdFrom(startedAt),
    target: {
      baseUrl,
      ...(config.target.sourceRoot === undefined ? {} : { sourceRoot: config.target.sourceRoot }),
    },
    checks: [...accessResults, ...behavioralResults] as CheckResultRecord[],
    structural: diffSpecObservation(loaded.spec, observation),
    // Three side channels through one collector, so a caller that remembered two cannot
    // silently drop the third.
    gaps: collectCoverageGaps({
      accessUnplannable: access.unplannable,
      behavioralUnplannable: behavioral.unplannable,
      behavioralUnverified: unverified,
    }),
  });

  reporter.step('Recording the run');
  store(cwd, result, evidence, reporter);

  const document = render(result, settings.format.value, observation, options.color === true);
  const outPath = settings.out.value;

  if (outPath === undefined) {
    stdout.write(document);
  } else {
    const absolute = isAbsolute(outPath) ? outPath : resolve(cwd, outPath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, document, 'utf8');
    reporter.info(`report written to ${outPath}`);
  }

  // Computed by core, applied here, never recomputed. The module says so and so does
  // rule R5.
  return computeExitCode(result, {
    failOn: settings.failOn.value,
    failOnUnverified: settings.failOnUnverified.value,
  });
}
