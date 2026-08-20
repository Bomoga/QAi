import type { RequirementVerdict, RunResult } from '../contracts/index.ts';

/**
 * Run to run comparison: what changed about an application between two runs.
 *
 * **This is the feature an engineer comes back for.** The first read of a generated
 * application is interesting once; the fifth regeneration is the thing that actually
 * hurts. A delta only works if the check that failed last week and the check that passes
 * today are recognisably the same check, which is why M6.3 spends its whole budget on
 * identity.
 *
 * **The buckets are exhaustive and mutually exclusive.** Every requirement in both runs
 * lands in exactly one, or in none when nothing changed. A requirement that was verified
 * and still is has no entry, because a delta that listed everything would be a report,
 * not a delta.
 *
 * **Each entry carries `from` and `to`.** That is what lets `fixed` hold both
 * `failed -> verified` and `unverified -> verified` without a fifth bucket the module's
 * shape does not have: a reader sees which it was. A coverage gap closing and a failure
 * being repaired are both improvements, and they are distinguishable on the entry.
 */

export interface RequirementTransition {
  readonly requirementId: string;
  readonly from: RequirementVerdict;
  readonly to: RequirementVerdict;
  /**
   * The checks that explain the transition: those whose verdict moved between the runs.
   *
   * Not every check on the requirement. A requirement with six checks where one broke
   * should point at the one, or the reader has to diff the two runs by hand to find it.
   */
  readonly checkIds: readonly string[];
}

export interface RequirementDelta {
  /** No longer passing. `to` is `failed`. */
  readonly regressed: readonly RequirementTransition[];
  /** Now passing, whether it was failing before or merely unknown. `to` is `verified`. */
  readonly fixed: readonly RequirementTransition[];
  /** Failed in both runs. Not new, and not gone. */
  readonly stillFailing: readonly RequirementTransition[];
  /** Nobody could check it this time, and somebody could before. */
  readonly newlyUnverified: readonly RequirementTransition[];
}

export interface FieldAdded {
  readonly entity: string;
  readonly field: string;
}

export interface AccessLoosening {
  /**
   * What loosened.
   *
   * A `CheckResultRecord` carries no endpoint, which M7.4 already ran into: the route
   * appears only inside `detail` as prose, and parsing it back out would be a guess in
   * the one place a reader is told where to look. So this holds the rule the check came
   * from when nothing better exists, and `detail` carries what the check actually saw.
   */
  readonly endpoint: string;
  readonly detail: string;
  readonly requirementId?: string;
  readonly ruleId?: string;
}

export interface StructuralDelta {
  readonly endpointsAdded: readonly string[];
  readonly endpointsRemoved: readonly string[];
  readonly fieldsAdded: readonly FieldAdded[];
  readonly accessLoosened: readonly AccessLoosening[];
}

export interface RunDelta {
  readonly from: string;
  readonly to: string;
  readonly comparable: boolean;
  readonly specChanged: boolean;
  readonly requirements: RequirementDelta;
  readonly structural: StructuralDelta;
}

/** Checks that reached a different verdict, restricted to one requirement. */
function changedChecks(older: RunResult, newer: RunResult, requirementId: string): string[] {
  const before = new Map(
    older.checks
      .filter((check) => check.requirementId === requirementId)
      .map((check) => [check.checkId, check.verdict] as const),
  );

  const moved = newer.checks
    .filter((check) => check.requirementId === requirementId)
    .filter((check) => before.get(check.checkId) !== check.verdict)
    .map((check) => check.checkId);

  // A check that ran before and not now also moved, and it is the one a reader is most
  // likely to be looking for: something stopped being checked at all.
  const nowPresent = new Set(
    newer.checks.filter((check) => check.requirementId === requirementId).map((c) => c.checkId),
  );
  const gone = [...before.keys()].filter((checkId) => !nowPresent.has(checkId));

  return [...new Set([...moved, ...gone])].sort((left, right) => left.localeCompare(right));
}

/** Checks failing in the newer run, for a requirement that failed in both. */
function failingChecks(newer: RunResult, requirementId: string): string[] {
  return newer.checks
    .filter((check) => check.requirementId === requirementId && check.verdict === 'fail')
    .map((check) => check.checkId)
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Endpoints a run knows are absent, and endpoints it knows are present.
 *
 * A RunResult carries no endpoint list, only `observation.ref`, so these two structural
 * lists are the whole of what it says about which routes exist. An endpoint the spec
 * declares and the probe did not see is known absent; one the probe saw and no
 * requirement mentions is known present. An endpoint that is both specified and observed
 * appears in neither, which is correct: nothing about it is remarkable.
 */
function endpointsKnownAbsent(run: RunResult): Set<string> {
  return new Set(
    run.structural.specifiedNotObserved
      .filter((entry) => entry.kind === 'endpoint')
      .map((entry) => entry.name),
  );
}

function endpointsKnownPresent(run: RunResult): Set<string> {
  return new Set(
    run.structural.observedNotSpecified
      .filter((entry) => entry.kind === 'endpoint')
      .map((entry) => entry.id),
  );
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function fieldsObservedNotSpecified(run: RunResult): Map<string, Set<string>> {
  const byEntity = new Map<string, Set<string>>();
  for (const mismatch of run.structural.fieldMismatches) {
    byEntity.set(mismatch.entity, new Set(mismatch.observedNotSpecified));
  }
  return byEntity;
}

/**
 * Access loosening, on its own detection path because the module insists on one.
 *
 * It is the exact silent divergence this product exists to catch: something that was
 * refused last week is reachable today. Letting it fall out of a generic verdict diff
 * would bury it among every other transition, which is the opposite of a headline.
 *
 * The rule the module gives has two halves. This is the half a RunResult can answer: a
 * deny rule check moving from pass to fail. A check does not record a rule's effect, so
 * the signal is an access check failing at high severity, which M3.2 fixes as the deny
 * class: a deny that fails means something forbidden is reachable, an allow that fails
 * means a feature is broken, and only the first is a loosening.
 *
 * The other half, an endpoint's `authRequired` moving away from `true`, needs the
 * Observation, and a RunResult carries only a reference to one. Recorded in the module's
 * open questions rather than guessed at.
 */
function accessLoosened(older: RunResult, newer: RunResult): AccessLoosening[] {
  const before = new Map(older.checks.map((check) => [check.checkId, check] as const));

  return newer.checks
    .filter((check) => check.type === 'access' && check.verdict === 'fail')
    .filter((check) => check.severity === 'high')
    .filter((check) => before.get(check.checkId)?.verdict === 'pass')
    .map((check) => ({
      endpoint: check.ruleId ?? check.requirementId ?? check.checkId,
      detail: check.detail ?? check.title,
      ...(check.requirementId === undefined ? {} : { requirementId: check.requirementId }),
      ...(check.ruleId === undefined ? {} : { ruleId: check.ruleId }),
    }));
}

function structuralDelta(older: RunResult, newer: RunResult): StructuralDelta {
  const absentBefore = endpointsKnownAbsent(older);
  const absentNow = endpointsKnownAbsent(newer);
  const presentBefore = endpointsKnownPresent(older);
  const presentNow = endpointsKnownPresent(newer);

  // Appeared: the spec asked for it and it was missing, and now it is not missing; or
  // nothing asked for it and it has turned up.
  const added = new Set([
    ...[...absentBefore].filter((id) => !absentNow.has(id)),
    ...[...presentNow].filter((id) => !presentBefore.has(id)),
  ]);

  const removed = new Set([
    ...[...absentNow].filter((id) => !absentBefore.has(id)),
    ...[...presentBefore].filter((id) => !presentNow.has(id)),
  ]);

  const fieldsBefore = fieldsObservedNotSpecified(older);
  const fieldsAdded: FieldAdded[] = [];
  for (const [entity, fields] of fieldsObservedNotSpecified(newer)) {
    const had = fieldsBefore.get(entity) ?? new Set<string>();
    for (const field of sorted(fields)) {
      if (!had.has(field)) fieldsAdded.push({ entity, field });
    }
  }

  return {
    endpointsAdded: sorted(added),
    endpointsRemoved: sorted(removed),
    fieldsAdded: fieldsAdded.sort(
      (left, right) =>
        left.entity.localeCompare(right.entity) || left.field.localeCompare(right.field),
    ),
    accessLoosened: accessLoosened(older, newer),
  };
}

/**
 * Compares two runs, oldest first.
 *
 * The argument order is `(a, b)` meaning from `a` to `b`, matching the module's public
 * API. Passing them the other way round reports fixes as regressions, which is why the
 * integration test at M6.8 runs it both ways.
 */
export function diffRuns(a: RunResult, b: RunResult): RunDelta {
  const before = new Map(a.requirements.map((one) => [one.requirementId, one] as const));

  const regressed: RequirementTransition[] = [];
  const fixed: RequirementTransition[] = [];
  const stillFailing: RequirementTransition[] = [];
  const newlyUnverified: RequirementTransition[] = [];

  // Requirement order follows the newer run, which follows the spec, so a reader
  // comparing two deltas looks down the same list both times.
  for (const current of b.requirements) {
    const previous = before.get(current.requirementId);
    // A requirement present in only one run is a spec change, and M6.6 owns saying so.
    // Reporting it as a transition here would claim the application moved.
    if (previous === undefined) continue;

    const from = previous.verdict;
    const to = current.verdict;

    const transition = (checkIds: string[]): RequirementTransition => ({
      requirementId: current.requirementId,
      from,
      to,
      checkIds,
    });

    if (from === 'failed' && to === 'failed') {
      stillFailing.push(transition(failingChecks(b, current.requirementId)));
      continue;
    }

    if (from === to) continue;

    const moved = changedChecks(a, b, current.requirementId);

    if (to === 'failed') regressed.push(transition(moved));
    else if (to === 'verified') fixed.push(transition(moved));
    else newlyUnverified.push(transition(moved));
  }

  return {
    from: a.runId,
    to: b.runId,
    // M6.6 decides what makes two runs incomparable. Until then a comparison was asked
    // for and one is given.
    comparable: true,
    specChanged: a.spec.hash !== b.spec.hash,
    requirements: { regressed, fixed, stillFailing, newlyUnverified },
    structural: structuralDelta(a, b),
  };
}
