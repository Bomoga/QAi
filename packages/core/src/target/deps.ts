/**
 * Injected clock and identifier generation, per rule R6.
 *
 * Nothing under `checks/` may read the wall clock or generate a random value, because
 * a golden file that changes on every run cannot be reviewed, and a check whose result
 * depends on when it ran cannot be reproduced from a bug report. Both capabilities
 * arrive here as arguments so a test can supply a fixed sequence.
 */

export interface Deps {
  /** ISO 8601 instant with an offset, matching the contracts' timestamp format. */
  now(): string;
  /** Content free unique suffix. Evidence ids are `EV-` plus this. */
  nextId(): string;
}

/** The real clock and a counter. The only place a run reaches for either. */
export function systemDeps(startCounter = 0): Deps {
  let counter = startCounter;
  return {
    now: () => new Date().toISOString(),
    nextId: () => {
      counter += 1;
      return counter.toString(16).padStart(6, '0');
    },
  };
}

/**
 * A fixed clock and a counting id source. Exported rather than kept in a test helper
 * because every module that takes `Deps` needs the same one, and three slightly
 * different fakes is how golden files start disagreeing with each other.
 */
export function fixedDeps(startedAt = '2026-01-01T00:00:00.000Z', startCounter = 0): Deps {
  let counter = startCounter;
  return {
    now: () => startedAt,
    nextId: () => {
      counter += 1;
      return counter.toString(16).padStart(6, '0');
    },
  };
}
