/**
 * Behavioral checks: verifying acceptance criteria. Owned by M5.
 *
 * Deterministic criteria assert over HTTP responses and persisted state, and are the
 * bulk of the value. Fuzzy criteria drive a browser and are model assisted, bounded by
 * invariant I1 so that a model can never produce a `fail`.
 *
 * Nothing here may import from `llm/`, enforced by lint. The `Judge` interface arrives
 * as an argument.
 *
 * Present: the assertion vocabulary, its validation warnings, the plan shape, and the
 * deterministic runner.
 * Pending: persisted state assertions, the Judge, the Playwright fuzzy runner, the
 * verdict mapping, and graceful degradation.
 */
export * from './assertions.ts';
export * from './deterministic.ts';
export * from './types.ts';
