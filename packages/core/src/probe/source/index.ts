/**
 * Source adapters, one per framework in Q1's list.
 *
 * Each reads a repository and reports the endpoints and entities it declares. None of
 * them infers: an adapter reports what the code states, and anything it could not read
 * becomes a note rather than a guess.
 *
 * Present: Next.js App Router, Express, Prisma.
 */
export * from './express.ts';
export * from './next.ts';
export * from './prisma.ts';
