import {
  isLoadFailure,
  loadSpec,
  validateAcceptanceCriteria,
  type LoadDiagnostic,
  type Spec,
} from '@qai/core';

import { fromDiagnostic, present, presentAll } from '../errors.ts';
import type { Stream } from '../reporter.ts';

/**
 * `qai validate`: load the specs, say what they contain, and say what is wrong with them.
 *
 * **An error exits 2 and a warning does not.** The two are different things and
 * `diagnostics.ts` says so: an error means no Spec could be produced and no run should
 * proceed, while a warning means the spec loaded and something about it is worth saying
 * out loud, usually a coverage fact like an actor nothing references. Failing the command
 * over a warning would teach people to stop reading warnings, which costs more than the
 * warning was worth.
 *
 * **Nothing to validate is a failure.** A clean summary over zero files is the vacuous
 * green this project has been bitten by before. If the glob matched nothing, that is a
 * configuration problem and the exit code says so.
 */

/** The default in 00-INDEX.md. `loadSpec` expands it, so it is passed through as written. */
export const DEFAULT_SPEC_GLOB = 'spec/*.spec.yaml';

export interface ValidateOptions {
  readonly cwd: string;
  /** Paths or globs from the command line. Empty means the default glob. */
  readonly paths: readonly string[];
  readonly stdout: Stream;
  readonly stderr: Stream;
  /** The resolved `--format`, only so an inapplicable one can be reported. */
  readonly format?: string;
  /** Adds a stack trace to any error this prints. */
  readonly verbose?: boolean;
}

/** `1 requirement`, `2 requirements`. Counting is the point of this command's output. */
function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function describeDiagnostic(diagnostic: LoadDiagnostic): string {
  const where = diagnostic.path === '' ? diagnostic.file : `${diagnostic.file}:${diagnostic.path}`;
  return `  ${diagnostic.severity}  ${where}\n    ${diagnostic.message}`;
}

function summarise(
  spec: Spec,
  hash: string,
  conditionCount: number,
  files: readonly string[],
): string[] {
  const accessRules = spec.requirements.reduce(
    (total, requirement) => total + requirement.accessRules.length,
    0,
  );
  const criteria = spec.requirements.reduce(
    (total, requirement) => total + requirement.acceptanceCriteria.length,
    0,
  );
  const fuzzy = spec.requirements.reduce(
    (total, requirement) =>
      total + requirement.acceptanceCriteria.filter((one) => one.mode === 'fuzzy').length,
    0,
  );

  return [
    `${spec.name} (specVersion ${spec.specVersion})`,
    `  ${hash}`,
    '',
    // Named rather than counted. A user whose glob matched the wrong directory sees a
    // clean summary either way, and only the file list tells them which.
    `  ${count(files.length, 'file')} read`,
    ...files.map((file) => `    ${file}`),
    '',
    `  ${count(spec.actors.length, 'actor')}`,
    `  ${count(spec.entities.length, 'entity', 'entities')}`,
    `  ${count(spec.requirements.length, 'requirement')}`,
    `  ${count(accessRules, 'access rule')}`,
    `  ${count(criteria, 'acceptance criterion', 'acceptance criteria')}, ${count(fuzzy, 'model assisted')}`,
    `  ${count(conditionCount, 'parsed condition')}`,
  ];
}

export function runValidate(options: ValidateOptions): Promise<number> {
  const { cwd, paths, stdout, stderr } = options;

  // The emitters project a RunResult and a spec summary is not one, so the flag has
  // nothing to act on here. Said rather than ignored.
  if (options.format !== undefined && options.format !== 'text') {
    stderr.write(
      `note: --format applies to run reports, and validate prints a summary. Ignoring --format ${options.format}.\n`,
    );
  }

  const requested = paths.length > 0 ? paths : [DEFAULT_SPEC_GLOB];
  const loaded = loadSpec(requested, { cwd });

  const presentTo = { stderr, ...(options.verbose === true ? { verbose: true } : {}) };

  if (isLoadFailure(loaded)) {
    // Exit 2: the spec is invalid and no run was performed, per 03-CONTRACTS.md.
    if (loaded.error.diagnostics.length === 0) {
      return Promise.resolve(
        present(
          {
            code: 2,
            summary: loaded.error.message,
            where: `${requested.join(', ')} under ${cwd}`,
            suggestion:
              'Pass the spec path explicitly, or run "qai init" to write a starter spec at spec/app.spec.yaml.',
          },
          presentTo,
        ),
      );
    }

    return Promise.resolve(
      presentAll(
        loaded.error.diagnostics.map((diagnostic) =>
          fromDiagnostic(diagnostic, loaded.error.message),
        ),
        presentTo,
      ),
    );
  }

  // Authoring warnings live in M5, since M1 does not depend on it and having the loader
  // emit M5's diagnostics would invert that dependency for the sake of the word.
  const authoring =
    loaded.spec.requirements.length === 0
      ? []
      : validateAcceptanceCriteria(loaded.spec, loaded.files.join(', '));
  const diagnostics = [...loaded.diagnostics, ...authoring];
  const errors = diagnostics.filter((one) => one.severity === 'error');
  const warnings = diagnostics.filter((one) => one.severity === 'warning');

  if (errors.length > 0) {
    // A Spec came back, but it came back with errors, and it is still one no run should
    // proceed on.
    const summary = `${count(errors.length, 'problem')} in the spec`;
    return Promise.resolve(
      presentAll(
        errors.map((diagnostic) => fromDiagnostic(diagnostic, summary)),
        presentTo,
      ),
    );
  }

  const lines = summarise(loaded.spec, loaded.hash, loaded.conditions.size, loaded.files);
  lines.push('', `  ${count(warnings.length, 'warning')}`);
  for (const diagnostic of warnings) lines.push(describeDiagnostic(diagnostic));

  stdout.write(`${lines.join('\n')}\n`);
  return Promise.resolve(0);
}
