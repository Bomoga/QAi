/**
 * What a mutation is, and how a before and an after are judged against it.
 *
 * Everything here is pure. `corpus/mutate.ts` starts applications and runs the tool; this
 * decides what the two sets of finding ids mean, which is the part worth testing without
 * paying for a process. The split is the same one `02-ARCHITECTURE.md` draws between core
 * and the CLI, for the same reason.
 */

export interface Mutation {
  readonly id: string;
  readonly app: string;
  /** What the edit does, in the terms the application's NOTES.md uses. */
  readonly description: string;
  /**
   * `repair` fixes a planted defect, so the listed findings must stop.
   * `break` introduces one into a correct application, so they must start.
   */
  readonly intent: 'repair' | 'break';
  /** Relative to the application directory. */
  readonly file: string;
  /** Matched exactly and once. A find that matches zero or many times is an error. */
  readonly find: string;
  readonly replace: string;
  /** Finding ids, keyed as `findingsOf` keys them, that must flip. */
  readonly expect: readonly string[];
}

export interface Judgement {
  /** Everything that went wrong, one sentence each. Empty means the table held. */
  readonly problems: readonly string[];
  /** Findings that moved and were not listed in `expect`. */
  readonly collateral: readonly string[];
}

/**
 * Apply the edit, exactly once.
 *
 * A `find` that matches zero times means the application moved under the table and the
 * mutation is stale. A `find` that matches more than once means the edit is ambiguous and
 * would change something the author never looked at. Both are errors rather than a best
 * effort, for the reason M1 refuses a condition it cannot parse: a mutation that quietly
 * edited the wrong line would produce a result about something nobody chose to measure.
 */
export function applyEdit(original: string, mutation: Mutation): string {
  const first = original.indexOf(mutation.find);
  if (first === -1) {
    throw new Error(`the find text is not in ${mutation.file}, so this mutation is stale`);
  }
  if (original.indexOf(mutation.find, first + 1) !== -1) {
    throw new Error(`the find text appears more than once in ${mutation.file}`);
  }
  return original.replace(mutation.find, mutation.replace);
}

/**
 * Did the listed findings flip, and did anything else move with them?
 *
 * The baseline is checked as well as the result. A repair whose finding was already absent
 * would otherwise pass without the tool having done anything, which is the same shape as a
 * test that asserts on a condition it never established.
 */
export function judge(
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
  mutation: Mutation,
): Judgement {
  const problems: string[] = [];
  const repairing = mutation.intent === 'repair';

  for (const id of mutation.expect) {
    if (repairing && !before.has(id)) {
      problems.push(`${id} is not produced before the repair, so the table is stale`);
    }
    if (!repairing && before.has(id)) {
      problems.push(`${id} is already produced before the break, so the table is stale`);
    }
  }

  for (const id of mutation.expect) {
    if (repairing && after.has(id)) {
      problems.push(`${id} survived the repair of the defect it names`);
    }
    if (!repairing && !after.has(id)) {
      problems.push(`${id} was not produced after the break that should cause it`);
    }
  }

  const expected = new Set(mutation.expect);
  const collateral = [
    ...[...before].filter((id) => !after.has(id) && !expected.has(id)),
    ...[...after].filter((id) => !before.has(id) && !expected.has(id)),
  ].sort();

  return { problems, collateral };
}
