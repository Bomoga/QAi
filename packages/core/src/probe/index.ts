/**
 * Probing: discovering what the target actually contains. Owned by M4.
 *
 * The probe is read-only by construction. It reads files and issues GET and HEAD, and
 * nothing here writes to a target, submits a form, or follows a link off origin.
 *
 * It is also not given the spec. Matching happens later, in the diff, because a probe
 * that knew what it was looking for would find it, and an Observation shaped by the
 * spec cannot support a finding that the two disagree.
 *
 * Present: probe interfaces and adapter registration.
 * Pending: the Next.js, Express, and Prisma adapters, the black box crawler, endpoint
 * identity normalization, the merge, and the structural diff.
 */
export * from './registry.ts';
export * from './types.ts';
