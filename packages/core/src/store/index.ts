/**
 * Run persistence and run to run comparison.
 *
 * The delta is the feature an engineer returns for weekly: the real pain is not the first
 * read of a generated application, it is the fifth regeneration.
 *
 * Present: the schema, its migrations, and the store itself: saveRun, getRun, listRuns.
 * Pending: stable check identity, diffRuns, comparability across differing spec hashes,
 * and retention, which adds pruneEvidence to the Store interface.
 */
export * from './schema.ts';
export * from './store.ts';
