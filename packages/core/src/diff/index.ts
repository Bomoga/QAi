/**
 * Structural diff: what the spec asked for against what the probe observed. Owned by M4.
 *
 * The comparison lives here rather than in the probe, because a probe that knew what it
 * was looking for would find it. Both sides are fixed by the time anything here runs.
 *
 * Present: `diffSpecObservation` and the severity rules, and `diffRuns` from M6.
 * Pending: the structural half of the run delta, and comparability across spec hashes.
 */
export * from './run-run.ts';
export * from './spec-observation.ts';
