/**
 * Load diagnostics. Every one names a file, a YAML path, and a reason, because a
 * message a reader cannot act on is a message that gets ignored.
 *
 * Errors and warnings are deliberately different things here. An error means the spec
 * could not be loaded and no run should proceed on it. A warning means the spec loaded
 * and something about it is worth saying out loud: an actor nothing references, an
 * entity no requirement mentions, a requirement with no checks. Those are coverage
 * facts, not authoring mistakes, and hiding them would defeat the point of surfacing
 * `unverified` as a first-class verdict.
 */

export type DiagnosticSeverity = 'error' | 'warning';

export interface LoadDiagnostic {
  readonly severity: DiagnosticSeverity;
  /** Path of the spec file the diagnostic came from, as given to the loader. */
  readonly file: string;
  /** Dotted YAML path, for example `requirements[0].accessRules[1].condition`. */
  readonly path: string;
  readonly message: string;
}

/**
 * Returned when loading could not produce a Spec at all. The CLI maps this to exit
 * code 2, per the exit code table in 03-CONTRACTS.md.
 */
export interface SpecError {
  readonly kind: 'error';
  readonly message: string;
  readonly diagnostics: readonly LoadDiagnostic[];
}

export function error(file: string, path: string, message: string): LoadDiagnostic {
  return { severity: 'error', file, path, message };
}

export function warning(file: string, path: string, message: string): LoadDiagnostic {
  return { severity: 'warning', file, path, message };
}

export function hasErrors(diagnostics: readonly LoadDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

/** One line per diagnostic, in the order they were produced. */
export function formatDiagnostic(diagnostic: LoadDiagnostic): string {
  return `${diagnostic.severity}: ${diagnostic.file} ${diagnostic.path}: ${diagnostic.message}`;
}
