import type { CriterionMode } from '../../contracts/index.ts';
import type { ActorSession } from '../../target/session.ts';
import type { RequestSpec } from '../../target/request.ts';
import type { CheckPlan } from '../types.ts';
import type { Assertion } from './assertions.ts';

/**
 * A behavioral check resolved to a concrete request, before execution.
 *
 * The request is carried rather than derived. An acceptance criterion states `when` in
 * prose, and there is no vocabulary for turning that into a method and a path the way
 * an access rule's actor, action, and resource fields do. Whoever builds the plan
 * decides what to issue; this module runs what it is handed and asserts on the answer.
 * The gap is recorded in the module's Open questions.
 */
export interface BehavioralPlan extends CheckPlan {
  readonly requirementId: string;
  readonly criterionId: string;
  readonly actorId: string;
  readonly request: RequestSpec;
  readonly assertions: readonly Assertion[];
  readonly mode: CriterionMode;
  /** The criterion's `then` clause, as authored, for the finding text. */
  readonly then: string;
  /** A file reference when a probe supplied one, so a finding cites source. */
  readonly locationRef?: string;
}

/**
 * What a behavioral runner needs. Deliberately the sessions and the interlock, not the
 * whole `TargetContext`: a check reaches the target through an actor session and has no
 * business touching credentials or the evidence writer directly.
 */
export interface BehavioralContext {
  readonly sessions: ReadonlyMap<string, ActorSession>;
  /**
   * Mutation permission, decided by the M2 disposability gate and passed in. Absent
   * means refused, so the safe answer is the default rather than something a caller has
   * to remember to ask for.
   */
  readonly mutation?: { readonly allowed: boolean; readonly reason?: string };
}

/** Behavioral findings are medium by default: a broken feature, not an exposure. */
export const BEHAVIORAL_SEVERITY = 'medium' as const;
