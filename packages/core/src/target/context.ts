import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Spec } from '../contracts/index.ts';
import { rulesFor, type RedactionRules } from '../evidence/redact.ts';
import { compilePatterns } from '../evidence/redact.ts';
import { createEvidenceWriter, type EvidenceWriter } from '../evidence/capture.ts';
import type { TargetConfig } from './config.ts';
import { describeMissing, resolveCredentials, type MissingVariable } from './credentials.ts';
import type { Deps } from './deps.ts';
import { checkDisposability } from './fixtures.ts';
import { createHttpClient, type HttpClient } from './request.ts';
import {
  accessChecksArePossible,
  createActorSessions,
  MINIMUM_ACTORS_FOR_ACCESS_CHECKS,
  type ActorSession,
} from './session.ts';

/**
 * The resolved target, and the report said out loud before a run starts.
 *
 * The report exists because of one failure mode: a run that checks almost nothing and
 * exits zero. A user reading "no findings" cannot tell that from a clean bill of
 * health unless the tool says which capabilities it had. So every gap is stated
 * plainly here, at the start, in terms of what will not be checked.
 */

export interface CapabilityReport {
  readonly baseUrl?: string;
  readonly sourceRoot?: string;
  readonly sourcePresent: boolean;
  readonly actorIds: readonly string[];
  readonly missingCredentials: readonly MissingVariable[];
  readonly accessChecksPossible: boolean;
  readonly fixturesAvailable: boolean;
  readonly fixturesRefusalReason?: string;
  readonly invalidRedactionPatterns: readonly string[];
  /** Lines a surface prints verbatim. Core produces data, not output, per rule R5. */
  readonly warnings: readonly string[];
}

export interface TargetContext {
  readonly config: TargetConfig;
  readonly sessions: ReadonlyMap<string, ActorSession>;
  readonly rules: RedactionRules;
  readonly client: HttpClient;
  readonly writer: EvidenceWriter;
  readonly capabilities: CapabilityReport;
}

export interface TargetContextOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly deps: Deps;
  readonly cwd?: string;
  readonly client?: HttpClient;
  readonly writer?: EvidenceWriter;
}

function buildWarnings(report: Omit<CapabilityReport, 'warnings'>): string[] {
  const warnings: string[] = [];

  if (report.missingCredentials.length > 0) {
    warnings.push(describeMissing(report.missingCredentials));
  }

  if (!report.accessChecksPossible) {
    warnings.push(
      `${report.actorIds.length} actor(s) resolved, and access checking compares one identity against another, so it needs ${MINIMUM_ACTORS_FOR_ACCESS_CHECKS}. Access checks will not run and every requirement that depends on one will be reported unverified with reason actor-unavailable.`,
    );
  }

  if (report.baseUrl === undefined) {
    warnings.push(
      'target.baseUrl is not configured, so nothing can be requested. Only source based checks can run.',
    );
  }

  if (!report.sourcePresent && report.sourceRoot !== undefined) {
    warnings.push(
      `target.sourceRoot "${report.sourceRoot}" does not exist, so findings will carry a request reference rather than a file reference.`,
    );
  }

  if (!report.fixturesAvailable && report.fixturesRefusalReason !== undefined) {
    warnings.push(report.fixturesRefusalReason);
  }

  for (const pattern of report.invalidRedactionPatterns) {
    warnings.push(
      `redaction.extraPatterns entry "${pattern}" is not a valid expression and was ignored. Anything it was meant to hide is not being hidden.`,
    );
  }

  return warnings;
}

/**
 * Builds the context. Reads the filesystem only to answer whether the configured
 * source root exists, and never reads the environment: it arrives as an argument.
 */
export function createTargetContext(
  config: TargetConfig,
  spec: Spec,
  options: TargetContextOptions,
): TargetContext {
  const cwd = options.cwd ?? process.cwd();

  const { actors, missing } = resolveCredentials(config.actors, options.env);
  const { invalid } = compilePatterns(config.redaction.extraPatterns);
  const rules = rulesFor(spec, config.redaction.extraPatterns);

  const client =
    options.client ??
    createHttpClient(config.target.baseUrl === undefined ? {} : { baseUrl: config.target.baseUrl });

  const writer = options.writer ?? createEvidenceWriter({ cwd });

  const sessions = createActorSessions(actors, { client, rules, deps: options.deps });

  const refusal = checkDisposability(config);
  const sourcePresent =
    config.target.sourceRoot !== undefined && existsSync(resolve(cwd, config.target.sourceRoot));

  const base: Omit<CapabilityReport, 'warnings'> = {
    ...(config.target.baseUrl === undefined ? {} : { baseUrl: config.target.baseUrl }),
    ...(config.target.sourceRoot === undefined ? {} : { sourceRoot: config.target.sourceRoot }),
    sourcePresent,
    actorIds: actors.map((actor) => actor.id),
    missingCredentials: missing,
    accessChecksPossible: accessChecksArePossible(sessions),
    fixturesAvailable: refusal === undefined,
    ...(refusal === undefined ? {} : { fixturesRefusalReason: refusal.message }),
    invalidRedactionPatterns: invalid,
  };

  return {
    config,
    sessions,
    rules,
    client,
    writer,
    capabilities: { ...base, warnings: buildWarnings(base) },
  };
}

/** Renders the report as lines. A surface prints these; core never does. */
export function describeCapabilities(report: CapabilityReport): string[] {
  const lines: string[] = [
    `target        ${report.baseUrl ?? 'not configured'}`,
    `source        ${report.sourcePresent ? (report.sourceRoot ?? '.') : 'not present'}`,
    `actors        ${report.actorIds.length > 0 ? report.actorIds.join(', ') : 'none resolved'}`,
    `access checks ${report.accessChecksPossible ? 'available' : 'unavailable'}`,
    `fixtures      ${report.fixturesAvailable ? 'available' : 'unavailable'}`,
  ];

  for (const warning of report.warnings) {
    lines.push(`warning: ${warning}`);
  }

  return lines;
}
