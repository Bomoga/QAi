/**
 * The Action's outputs, computed from the SARIF the run already produced.
 *
 * **One run, not two.** A second `qai check` to get counts in another format would double
 * the traffic against the target and could disagree with the first, since a run mutates
 * whatever it is allowed to mutate. The SARIF carries what the outputs need in
 * `runs[0].properties`, which is why M7.4 put coverage, the model assisted count, and the
 * unverified count there rather than leaving them to the text report.
 *
 * **Coverage is a fraction here and a percentage in the output.** A workflow comparing
 * it against a threshold reads a percentage more naturally, and the name says what it is.
 * It is not a pass rate in either form, and nothing here calls it one.
 *
 * This is TypeScript rather than more YAML because it is the only part of the Action with
 * a decision in it, and a decision in YAML is a decision nobody can test.
 */

export interface ActionOutputs {
  /** Every SARIF result, which is every finding the run surfaced. */
  readonly findingsTotal: number;
  readonly findingsError: number;
  readonly findingsWarning: number;
  readonly findingsNote: number;
  /** Requirements with at least one check that reached a verdict, as a percentage. */
  readonly coveragePercent: number;
  readonly requirementsUnverified: number;
  readonly modelAssistedChecks: number;
}

/** What a SARIF log looks like from here. Only the parts the outputs read are named. */
interface SarifShape {
  runs?: {
    results?: { level?: string }[];
    properties?: {
      coverage?: number;
      requirementsUnverified?: number;
      modelAssistedCheckCount?: number;
    };
  }[];
}

function count(results: readonly { level?: string }[], level: string): number {
  return results.filter((result) => result.level === level).length;
}

/**
 * Reads the document rather than trusting it.
 *
 * A malformed SARIF here means the run did not produce what it said it would, and an
 * Action that reported zero findings from an unreadable file would be the quietest
 * possible failure. It throws, and the caller turns that into a failed step.
 */
export function outputsFromSarif(text: string): ActionOutputs {
  let document: SarifShape;
  try {
    document = JSON.parse(text) as SarifShape;
  } catch (cause) {
    throw new Error(
      `the SARIF report could not be parsed: ${cause instanceof Error ? cause.message : 'unknown'}`,
      { cause },
    );
  }

  const run = document.runs?.[0];
  if (run === undefined) {
    throw new Error('the SARIF report contains no run, so there is nothing to report on');
  }

  const results = run.results ?? [];
  const properties = run.properties ?? {};

  return {
    findingsTotal: results.length,
    findingsError: count(results, 'error'),
    findingsWarning: count(results, 'warning'),
    findingsNote: count(results, 'note'),
    // Rounded to a whole percent. A workflow comparing against a threshold does not want
    // sixteen decimal places, and the underlying fraction is in the report itself.
    coveragePercent: Math.round((properties.coverage ?? 0) * 100),
    requirementsUnverified: properties.requirementsUnverified ?? 0,
    modelAssistedChecks: properties.modelAssistedCheckCount ?? 0,
  };
}

/** The names the workflow sees. Kebab case, as every other Action output is. */
export const OUTPUT_NAMES = {
  findingsTotal: 'findings-total',
  findingsError: 'findings-error',
  findingsWarning: 'findings-warning',
  findingsNote: 'findings-note',
  coveragePercent: 'coverage-percent',
  requirementsUnverified: 'requirements-unverified',
  modelAssistedChecks: 'model-assisted-checks',
} as const;

/**
 * The `$GITHUB_OUTPUT` file format: one `name=value` line each.
 *
 * Every value here is a number, so none of them can contain a newline and none needs the
 * heredoc form. A value that could would need it, and this returns numbers only so that
 * question never arises.
 */
export function formatOutputs(outputs: ActionOutputs): string {
  const lines = (Object.keys(OUTPUT_NAMES) as (keyof typeof OUTPUT_NAMES)[]).map(
    (key) => `${OUTPUT_NAMES[key]}=${outputs[key]}`,
  );
  return `${lines.join('\n')}\n`;
}

/**
 * The one line a reader sees in the step summary.
 *
 * It states coverage as coverage and says what it counts, for the reason every other
 * surface does: a number a reader could mistake for a grade has been mislabeled.
 */
export function summaryLine(outputs: ActionOutputs): string {
  return [
    `${outputs.findingsTotal} finding(s):`,
    `${outputs.findingsError} error,`,
    `${outputs.findingsWarning} warning,`,
    `${outputs.findingsNote} note.`,
    `Coverage ${outputs.coveragePercent}% of requirements with at least one check that reached a verdict.`,
    `${outputs.requirementsUnverified} requirement(s) unverified.`,
    `${outputs.modelAssistedChecks} model assisted check(s).`,
  ].join(' ');
}
