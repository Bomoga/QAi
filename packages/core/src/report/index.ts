/**
 * Run assembly and the report emitters.
 *
 * RunResult is the public interface of this tool; every format is a projection of it.
 * Emitters are pure functions of that object and never re-query the target or the store.
 *
 * Present: run assembly, the verdict rollup, the JSON, text, SARIF, and JUnit
 * projections, the exit code recommendation, and the Reporter port a surface implements.
 * Pending: the golden run results for the fixture configurations.
 */
export * from './assemble.ts';
export * from './exit-code.ts';
export * from './json.ts';
export * from './junit.ts';
export * from './reporter.ts';
export * from './sarif.ts';
export * from './text.ts';
