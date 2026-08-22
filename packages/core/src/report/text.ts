import { createColors } from 'picocolors';

import type { CheckResultRecord, RunResult, Severity } from '../contracts/index.ts';

/**
 * The text projection of a RunResult, for a person reading a terminal.
 *
 * **The section order is the information design, not a layout preference.** The report
 * leads with the map and closes with the summary, because the demystification is the
 * product and the verification is the evidence that the map is accurate. A report that
 * opens on a number invites the reader to take the number and leave.
 *
 * ```
 * 1. Run: target, spec hash, commit
 * 2. What was built: entity and endpoint counts, by origin and confidence
 * 3. Disagreements: observed not specified, specified not observed, field mismatches
 * 4. Findings, ordered by severity then by requirement id
 * 5. Unverified, with a reason for each, as its own section
 * 6. Summary: counts, coverage, and model assisted check count, always shown
 * ```
 *
 * **Coverage is labeled coverage.** It counts requirements that reached a verdict, not
 * requirements that passed, and a reader who mistakes it for a grade has been misled by
 * the label rather than by the number. The line says what it counts for that reason.
 *
 * **Color is a parameter, never a detection.** Rule R6 keeps core out of the
 * environment and rule R5 keeps it from writing anywhere, so whether the destination is
 * a TTY is a fact the caller establishes and passes in. `createColors` is used instead
 * of picocolors' default export for the same reason: the default sniffs the process and
 * would make this function's output depend on how the suite was launched.
 */

/**
 * **The Observation option is gone, resolved as Q6 on 2026-08-22.**
 *
 * Section 2 asks for entity and endpoint counts by origin and confidence, and RunResult
 * used to carry `observation.ref` and nothing else, so those counts were not derivable
 * from the argument the module's Public API gives this function. The workaround was to
 * take the Observation the caller already held, which made this emitter something other
 * than a pure projection of a RunResult and left `qai report` unable to render the
 * section at all from a stored run. The summary is on the result now and this reads it.
 *
 * With no summary the section names the reference rather than reporting counts of zero,
 * since zero entities is a claim about the application and this is an absence of data
 * about it.
 */
export interface TextOptions {
  /** True only when the caller has established the destination is a TTY. */
  readonly color?: boolean;
}

/** Highest first. Findings are ordered by this and then by requirement id. */
const SEVERITY_ORDER: readonly Severity[] = ['high', 'medium', 'low', 'info'];

type Colors = ReturnType<typeof createColors>;

function severityRank(severity: Severity): number {
  const index = SEVERITY_ORDER.indexOf(severity);
  return index < 0 ? SEVERITY_ORDER.length : index;
}

function headerSection(result: RunResult, colors: Colors): string[] {
  const lines = [colors.bold(`Run ${result.runId}`)];

  if (result.target.baseUrl !== undefined) lines.push(`  Target: ${result.target.baseUrl}`);
  if (result.target.sourceRoot !== undefined) lines.push(`  Source: ${result.target.sourceRoot}`);
  if (result.target.commit !== undefined) lines.push(`  Commit: ${result.target.commit}`);

  lines.push(`  Spec: ${result.spec.hash} (specVersion ${result.spec.specVersion})`);
  if (result.spec.files.length > 0) lines.push(`  Spec files: ${result.spec.files.join(', ')}`);
  lines.push(`  Started ${result.startedAt}, finished ${result.finishedAt}`);
  lines.push(`  Tool ${result.toolVersion}, result format ${result.resultVersion}`);

  return lines;
}

function builtSection(result: RunResult, colors: Colors): string[] {
  const lines = [colors.bold('What was built')];
  const observed = result.observation;

  if (observed === undefined) {
    lines.push('  No probe was recorded for this run, so nothing is claimed about what exists.');
    return lines;
  }

  const counts = observed.counts;
  if (counts === undefined) {
    lines.push(
      `  Observation ${observed.ref} was recorded, and this run carries no summary of it.`,
    );
    return lines;
  }

  if (observed.mode !== undefined) lines.push(`  Probe mode: ${observed.mode}`);

  const entities = counts.entities;
  const entityTotal = entities.schema + entities.inferred;
  lines.push(`  ${entityTotal} entities`);
  if (entityTotal > 0) {
    lines.push(`    by origin: schema ${entities.schema}, inferred ${entities.inferred}`);
    lines.push(
      `    by confidence: high ${entities.high}, medium ${entities.medium}, low ${entities.low}`,
    );
  }

  const endpoints = counts.endpoints;
  const endpointTotal = endpoints.source + endpoints.blackbox;
  lines.push(`  ${endpointTotal} endpoints`);
  if (endpointTotal > 0) {
    lines.push(`    by origin: source ${endpoints.source}, blackbox ${endpoints.blackbox}`);
    lines.push(
      `    by confidence: high ${endpoints.high}, medium ${endpoints.medium}, low ${endpoints.low}`,
    );
  }

  // A probe that stopped early and does not say so reads as an application with nothing
  // more in it.
  for (const note of observed.notes ?? []) {
    lines.push(`  ${note.level}: ${note.message}`);
  }

  return lines;
}

function disagreementsSection(result: RunResult, colors: Colors): string[] {
  const lines = [colors.bold('Disagreements')];
  const { specifiedNotObserved, observedNotSpecified, fieldMismatches } = result.structural;

  if (
    specifiedNotObserved.length === 0 &&
    observedNotSpecified.length === 0 &&
    fieldMismatches.length === 0
  ) {
    lines.push('  None. The spec and the observation agree on entities, endpoints, and fields.');
    return lines;
  }

  if (specifiedNotObserved.length > 0) {
    lines.push('  Specified and not observed:');
    for (const entry of specifiedNotObserved) {
      const required =
        entry.requirementIds.length > 0 ? ` (${entry.requirementIds.join(', ')})` : '';
      lines.push(`    ${entry.kind} ${entry.name}${required}`);
    }
  }

  if (observedNotSpecified.length > 0) {
    lines.push('  Observed and not specified:');
    for (const entry of observedNotSpecified) {
      lines.push(`    ${entry.kind} ${entry.id} [${entry.severity}]`);
    }
  }

  if (fieldMismatches.length > 0) {
    lines.push('  Field mismatches:');
    for (const entry of fieldMismatches) {
      if (entry.specifiedNotObserved.length > 0) {
        lines.push(
          `    ${entry.entity}: specified and not observed ${entry.specifiedNotObserved.join(', ')}`,
        );
      }
      if (entry.observedNotSpecified.length > 0) {
        lines.push(
          `    ${entry.entity}: observed and not specified ${entry.observedNotSpecified.join(', ')}`,
        );
      }
    }
  }

  return lines;
}

function paintSeverity(severity: Severity, colors: Colors): string {
  const label = severity.toUpperCase();
  if (severity === 'high') return colors.red(label);
  if (severity === 'medium') return colors.yellow(label);
  return colors.dim(label);
}

/**
 * Findings are failures. A passing check carries `info` severity and listing it here
 * would report a clean run as having findings, which is the same mistake `tallyFindings`
 * refuses to make in the summary.
 */
function findingsSection(result: RunResult, colors: Colors): string[] {
  const lines = [colors.bold('Findings')];

  const failures = result.checks
    .filter((check) => check.verdict === 'fail')
    .sort(
      (left, right) =>
        severityRank(left.severity) - severityRank(right.severity) ||
        (left.requirementId ?? '').localeCompare(right.requirementId ?? '') ||
        left.checkId.localeCompare(right.checkId),
    );

  if (failures.length === 0) {
    lines.push('  No findings. Nothing that ran came back failed.');
    return lines;
  }

  for (const check of failures) {
    lines.push(`  [${paintSeverity(check.severity, colors)}] ${describe(check)}`);
    lines.push(`    ${check.title}`);
    if (check.detail !== undefined) lines.push(`    ${check.detail}`);
    if (check.locationRef !== undefined) lines.push(`    Source: ${check.locationRef}`);
    if (check.evidence.length > 0) lines.push(`    Evidence: ${check.evidence.join(', ')}`);
    if (!check.deterministic) lines.push('    Model assisted');
  }

  return lines;
}

/** `REQ-014 AR-014-01 (access, CHK-a91f2c)`, dropping whatever the check did not carry. */
function describe(check: CheckResultRecord): string {
  const named = [check.requirementId, check.ruleId].filter(
    (part): part is string => part !== undefined,
  );
  const prefix = named.length > 0 ? `${named.join(' ')} ` : '';
  return `${prefix}(${check.type}, ${check.checkId})`;
}

/**
 * Its own section, always, per invariant I4. A requirement nobody could check has not
 * passed and has not failed, and folding it into either is the quiet green run this
 * whole tool exists to prevent.
 */
function unverifiedSection(result: RunResult, colors: Colors): string[] {
  const lines = [colors.bold('Unverified')];

  const unverified = result.requirements.filter(
    (requirement) => requirement.verdict === 'unverified',
  );

  if (unverified.length === 0) {
    lines.push('  None. Every requirement reached a verdict.');
    return lines;
  }

  const reasons = new Map(
    result.unverifiedReasons.map((entry) => [entry.requirementId, entry] as const),
  );

  for (const requirement of unverified) {
    const recorded = reasons.get(requirement.requirementId);
    // Never blank. A requirement listed here without a reason gives the reader nothing
    // to act on, and saying the reason is missing is itself actionable.
    const reason = recorded?.reason ?? 'no reason was recorded';
    lines.push(`  ${requirement.requirementId}: ${reason}`);

    const detail = recorded?.detail ?? requirement.reason;
    if (detail !== undefined) lines.push(`    ${detail}`);
  }

  return lines;
}

function summarySection(result: RunResult, colors: Colors): string[] {
  const { requirements, checks, coverage, findingsBySeverity, modelAssistedCheckCount } =
    result.summary;

  return [
    colors.bold('Summary'),
    `  Requirements: ${requirements.total} total, ${requirements.verified} verified, ${requirements.failed} failed, ${requirements.unverified} unverified`,
    `  Checks: ${checks.total} total, ${checks.pass} pass, ${checks.fail} fail, ${checks.inconclusive} inconclusive`,
    `  Findings by severity: high ${findingsBySeverity.high}, medium ${findingsBySeverity.medium}, low ${findingsBySeverity.low}, info ${findingsBySeverity.info}`,
    // Labeled coverage, and told what it counts. It is not a pass rate and a failing
    // check still counts as coverage, since the requirement was established.
    `  Coverage: ${Math.round(coverage * 100)}% of requirements with at least one check that reached a verdict`,
    // Always shown, including at zero, per 03-CONTRACTS.md.
    `  Model assisted checks: ${modelAssistedCheckCount}`,
  ];
}

export function renderText(result: RunResult, opts: TextOptions): string {
  const colors = createColors(opts.color === true);

  const sections = [
    headerSection(result, colors),
    builtSection(result, colors),
    disagreementsSection(result, colors),
    findingsSection(result, colors),
    unverifiedSection(result, colors),
    summarySection(result, colors),
  ];

  return `${sections.map((lines) => lines.join('\n')).join('\n\n')}\n`;
}
