/**
 * Check registration, dispatch, and result construction.
 *
 * Nothing under this directory may import from `llm/`, enforced by lint rather than by
 * convention. Invariant I1 is the product's trust argument, and a boundary that lives
 * only in a document is one a future refactor walks through without noticing.
 *
 * Present: the registry, result helpers, and check identity.
 * Pending: access checks from M3, behavioral checks from M5.
 */
export * from './registry.ts';
export * from './result.ts';
export * from './types.ts';
