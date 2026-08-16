/**
 * Spec loading, merging, validating, and hashing. Owned by M1.
 *
 * Present: condition parsing, and `loadSpec` with multi-file merge, identifier
 * derivation, and diagnostics.
 * Pending: the canonicalized spec hash.
 */
export * from './condition.ts';
export * from './diagnostics.ts';
export * from './load.ts';
