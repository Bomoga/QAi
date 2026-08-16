/**
 * Structural diff: what the spec asked for against what the probe observed. Owned by M4.
 *
 * The comparison lives here rather than in the probe, because a probe that knew what it
 * was looking for would find it. Both sides are fixed by the time anything here runs.
 *
 * Present: `diffSpecObservation` and the severity rules.
 * Pending: nothing.
 */
export * from './spec-observation.ts';
