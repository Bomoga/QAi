/**
 * Run assembly and the report emitters.
 *
 * RunResult is the public interface of this tool; every format is a projection of it.
 * Emitters are pure functions of that object and never re-query the target or the store.
 *
 * Present: run assembly and the verdict rollup.
 * Pending: the JSON, text, SARIF, and JUnit emitters, and the exit code recommendation.
 */
export * from './assemble.ts';
