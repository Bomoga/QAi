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
 * Present: both vocabularies, planning, the deterministic runner with persisted state
 * reads, the judge boundary, page capture, and the fuzzy verdict mapping.
 * Pending: graceful degradation end to end, and the integration test.
 */
export * from './assertions.ts';
export * from './browser.ts';
export * from './deterministic.ts';
export * from './fuzzy.ts';
export * from './judge.ts';
export * from './plan.ts';
export * from './types.ts';
export * from './when.ts';
