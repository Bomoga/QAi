import type { CheckResultRecord, CheckType, Severity } from '../contracts/index.ts';

/**
 * Shared check shapes. `CheckResult` is the contract type from 03-CONTRACTS.md, not a
 * second definition of it: the shared runtime types table names M3 as its owner, and
 * owning a type does not mean redeclaring one that is already serialized.
 */
export type CheckResult = CheckResultRecord;

/**
 * A check resolved to a concrete action, before execution.
 *
 * The identity fields are what make a check the same check across runs. They are
 * separated from the execution details deliberately: M6 compares runs by check id, so
 * anything that changes identity renames the check and breaks the comparison, while
 * anything that only changes how it is carried out must not.
 */
export interface CheckIdentity {
  readonly type: CheckType;
  readonly requirementId?: string;
  readonly ruleId?: string;
  /** The actor the check acts as. Two actors against one rule are two checks. */
  readonly actorId?: string;
  /** Stable description of the action, for example `GET /api/invoices/:id`. */
  readonly action?: string;
}

export interface CheckPlan {
  readonly identity: CheckIdentity;
  /**
   * Declared by the plan, honoured by the runner. A mutating check runs last, serially,
   * inside the fixture boundary, and only when the disposability gate permits.
   */
  readonly mutates: boolean;
  /** Assigned when the check fails. A passing check carries no severity of interest. */
  readonly severityOnFail: Severity;
}

export type CheckRunner<TPlan extends CheckPlan, TContext> = (
  plan: TPlan,
  context: TContext,
) => Promise<CheckResult>;
