/**
 * Run persistence and run to run comparison.
 *
 * The delta is the feature an engineer returns for weekly: the real pain is not the first
 * read of a generated application, it is the fifth regeneration.
 *
 * Present: the schema, its forward-only migrations, and opening a database.
 * Pending: saveRun and evidence writing, stable check identity, diffRuns, comparability
 * across differing spec hashes, and retention.
 */
export * from './schema.ts';
