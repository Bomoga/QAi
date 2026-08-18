import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import {
  createTargetContext,
  isLoadFailure,
  isTransportError,
  loadSpec,
  probe,
  systemDeps,
  type Deps,
  type Observation,
  type Reporter,
  type TargetConfig,
} from '@qai/core';

import type { Stream } from '../reporter.ts';
import { present } from '../errors.ts';
import type { Settings } from '../settings.ts';
import { DEFAULT_SPEC_GLOB } from './validate.ts';

/**
 * `qai probe`: what the target actually contains, and nothing about what it should.
 *
 * **No verdicts, by construction.** A probe describes; the diff and the checks judge.
 * Running this on its own is how somebody answers "what is even in here" before they
 * have written a spec worth checking against, which is the first half of what the
 * product does.
 *
 * **The spec is loaded, and the probe is still not given it.** M4 is deliberate that a
 * probe shaped by the spec cannot support a finding that the two disagree. The spec is
 * read here only for its `sensitive: true` fields, which redaction needs before any
 * response is written to disk, per rule R8. If no spec is present the probe still runs,
 * with redaction covering the always-redacted names and the configured patterns.
 *
 * **Exit codes.** 0 and 2 and 3, never 1: a probe produces no findings, so there is
 * nothing for the failure threshold to act on.
 */

export interface ProbeOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly paths: readonly string[];
  readonly config: TargetConfig | undefined;
  readonly configPath: string;
  readonly settings: Settings;
  readonly stdout: Stream;
  readonly stderr: Stream;
  readonly reporter: Reporter;
  readonly deps?: Deps;
  /** Adds a stack trace to any error this prints. */
  readonly verbose?: boolean;
}

function tally<T extends string>(items: readonly T[], keys: readonly T[]): string {
  return keys.map((key) => `${key} ${items.filter((item) => item === key).length}`).join(', ');
}

/**
 * The human readable form, which is the same shape the text report's second section
 * uses. Two views of one fact should not read differently.
 */
function describe(observation: Observation): string {
  const lines = [
    `Observed ${observation.target.baseUrl ?? 'the target'} at ${observation.observedAt}`,
    `  probe mode: ${observation.mode}`,
    '',
    `  ${observation.entities.length} entities`,
  ];

  if (observation.entities.length > 0) {
    lines.push(
      `    by origin: ${tally(
        observation.entities.map((entity) => entity.origin),
        ['schema', 'inferred'],
      )}`,
      `    by confidence: ${tally(
        observation.entities.map((entity) => entity.confidence),
        ['high', 'medium', 'low'],
      )}`,
    );
    for (const entity of observation.entities) {
      lines.push(`    ${entity.name} (${entity.origin}, ${entity.confidence})`);
    }
  }

  lines.push('', `  ${observation.endpoints.length} endpoints`);

  if (observation.endpoints.length > 0) {
    lines.push(
      `    by origin: ${tally(
        observation.endpoints.map((endpoint) => endpoint.origin),
        ['source', 'blackbox'],
      )}`,
      `    by confidence: ${tally(
        observation.endpoints.map((endpoint) => endpoint.confidence),
        ['high', 'medium', 'low'],
      )}`,
    );
    for (const endpoint of observation.endpoints) {
      const auth =
        endpoint.authRequired === 'unknown'
          ? 'auth unknown'
          : `auth ${endpoint.authRequired ? 'required' : 'not required'}`;
      lines.push(`    ${endpoint.id} (${endpoint.origin}, ${endpoint.confidence}, ${auth})`);
    }
  }

  // A probe that stopped early and does not say so reads as an application with nothing
  // more in it.
  if (observation.notes.length > 0) {
    lines.push('', `  ${observation.notes.length} note(s)`);
    for (const note of observation.notes) lines.push(`    ${note.level}: ${note.message}`);
  }

  return `${lines.join('\n')}\n`;
}

export async function runProbe(options: ProbeOptions): Promise<number> {
  const { cwd, env, settings, stdout, stderr, reporter } = options;
  const deps = options.deps ?? systemDeps();
  const config = options.config;
  const presentTo = { stderr, ...(options.verbose === true ? { verbose: true } : {}) };

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

  const baseUrl = config.target.baseUrl;
  if (baseUrl === undefined) {
    return present(
      {
        code: 2,
        summary: 'the target has no base URL',
        where: `${options.configPath}, at target.baseUrl`,
        reason: 'A probe issues requests, so it needs somewhere to send them.',
        suggestion: 'Set target.baseUrl in the config, for example http://localhost:3000.',
      },
      presentTo,
    );
  }

  if (settings.format.value === 'sarif' || settings.format.value === 'junit') {
    stderr.write(
      `note: --format ${settings.format.value} describes findings, and a probe produces none. Writing the observation as JSON instead.\n`,
    );
  }

  // Loaded for the sensitive field list only. An absent spec is not an error here: the
  // whole point of probing on its own is that there may not be one yet.
  const requested = options.paths.length > 0 ? options.paths : [DEFAULT_SPEC_GLOB];
  const loaded = loadSpec(requested, { cwd });
  const spec = isLoadFailure(loaded)
    ? { specVersion: '0.1', name: 'unspecified', actors: [], entities: [], requirements: [] }
    : loaded.spec;

  if (isLoadFailure(loaded)) {
    reporter.warn(
      `No spec was loaded from ${requested.join(', ')}, so redaction covers only credentials and the configured patterns, not fields a spec marks sensitive.`,
    );
  }

  const target = createTargetContext(config, spec, { env, deps, cwd });
  for (const warning of target.capabilities.warnings) reporter.warn(warning);

  reporter.step(`Reaching ${baseUrl}`);
  const reachability = await target.client.send({ method: 'GET', path: '/' }, { kind: 'none' });
  if (isTransportError(reachability)) {
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

  const document =
    settings.format.value === 'text'
      ? describe(observation)
      : `${JSON.stringify(observation, null, 2)}\n`;

  const outPath = settings.out.value;
  if (outPath === undefined) {
    stdout.write(document);
  } else {
    const absolute = isAbsolute(outPath) ? outPath : resolve(cwd, outPath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, document, 'utf8');
    reporter.info(`observation written to ${outPath}`);
  }

  return 0;
}
