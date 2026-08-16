/**
 * Spec loading, merging, validating, and hashing. Owned by M1.
 *
 * Present: condition parsing, and `loadSpec` with multi-file merge, identifier
 * derivation, diagnostics, and the canonicalized hash.
 * Pending: the generated JSON Schema for editor support.
 */
export * from './condition.ts';
export * from './diagnostics.ts';
export * from './hash.ts';
export * from './load.ts';
