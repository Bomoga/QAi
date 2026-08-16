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
 * Present: probe interfaces, adapter registration, the Next.js and Express adapters,
 * and the black box crawler.
 * Pending: the Prisma adapter, endpoint identity normalization, the merge, and the
 * structural diff.
 */
export * from './crawl.ts';
export * from './registry.ts';
export * from './source/index.ts';
export * from './types.ts';
