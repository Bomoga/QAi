/**
 * Run assembly and the report emitters.
 *
 * RunResult is the public interface of this tool; every format is a projection of it.
 * Emitters are pure functions of that object and never re-query the target or the store.
 *
 * Present: run assembly, the verdict rollup, and the JSON and text projections.
 * Pending: the SARIF and JUnit emitters, and the exit code recommendation.
 */
export * from './assemble.ts';
export * from './json.ts';
export * from './text.ts';
