/**
 * Check registration, dispatch, and result construction.
 *
 * Nothing under this directory may import from `llm/`, enforced by lint rather than by
 * convention. Invariant I1 is the product's trust argument, and a boundary that lives
 * only in a document is one a future refactor walks through without noticing.
 *
 * Present: the registry, result helpers, check identity, access checks from M3, and the
 * behavioral assertion vocabulary from M5.
 * Pending: the rest of M5, the runners and the fuzzy path.
 */
export * from './registry.ts';
export * from './result.ts';
export * from './types.ts';
export * from './access/index.ts';
export * from './behavioral/index.ts';
