import { z } from 'zod';

import { EvidenceIdSchema, InstantSchema } from './evidence.ts';
import { AuthRequiredSchema, ObservationNoteSchema, ProbeModeSchema } from './observation.ts';
import { AccessRuleIdSchema, AcceptanceCriterionIdSchema, RequirementIdSchema } from './spec.ts';

/**
 * RunResult, section 3 of 03-CONTRACTS.md. The public interface.
 *
 * Every emitter and every future surface is a projection of this. Nothing downstream of
 * assembly may re-derive a fact by re-reading the target or the store, which is why this
 * shape carries verdicts, severities, and evidence ids rather than references to live
 * state. Decision D7: verdicts live here, never on the Spec.
 */

export const CheckIdSchema = z
  .string()
  .regex(/^CHK-[A-Za-z0-9]+$/, 'check id must look like CHK-a91f2c');

export const RunIdSchema = z
  .string()
  .regex(/^RUN-[A-Za-z0-9-]+$/, 'run id must look like RUN-20260814-0931');

/** Requirement level. Invariant I4: `unverified` is a verdict, never a collapsed pass. */
export const RequirementVerdictSchema = z.enum(['verified', 'failed', 'unverified']);

/** Check level. Invariant I2: when in doubt the answer is `inconclusive`, not a guess. */
export const CheckVerdictSchema = z.enum(['pass', 'fail', 'inconclusive']);

export const SeveritySchema = z.enum(['high', 'medium', 'low', 'info']);

export const CheckTypeSchema = z.enum(['access', 'behavioral', 'structural']);

/**
 * Closed set, from 03-CONTRACTS.md. `capability-unavailable` covers an optional
 * dependency being absent, for example Playwright not installed, and is deliberately
 * distinct from `model-inconclusive`, which means the model ran and was uncertain.
 * Collapsing the two would hide whether a gap is fixable by installing something.
 */
export const UnverifiedReasonSchema = z.enum([
  'no-checks-defined',
  'actor-unavailable',
  'target-unreachable',
  'probe-incomplete',
  'check-error',
  /**
   * The checks ran and none of them reached a verdict. Q7, decided 2026-08-22.
   *
   * Distinct from `check-error`, which means something threw. A requirement whose every
   * check came back inconclusive is the tool declining to guess, which invariant I2 asks
   * for, and reporting it as an error described correct behaviour as a failure. Seen five
   * times before the set gained a member for it. `detail` carries the specifics, so the
   * cases stay distinguishable without a second member.
   */
  'no-verdict-reached',
  'unsupported-condition',
  'model-inconclusive',
  'capability-unavailable',
]);

export const SpecRefSchema = z
  .object({
    hash: z.string().min(1),
    specVersion: z.string().min(1),
    files: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const TargetRefSchema = z
  .object({
    baseUrl: z.string().min(1).optional(),
    sourceRoot: z.string().min(1).optional(),
    commit: z.string().min(1).optional(),
  })
  .strict();

/**
 * A count of one collection by origin and by confidence.
 *
 * Origins differ between entities and endpoints, `schema` and `inferred` against `source`
 * and `blackbox`, so the two are counted under their own keys rather than through a shared
 * shape that would carry two zeroes for whichever pair does not apply.
 */
export const ObservationCountsSchema = z
  .object({
    entities: z
      .object({
        schema: z.number().int().nonnegative(),
        inferred: z.number().int().nonnegative(),
        high: z.number().int().nonnegative(),
        medium: z.number().int().nonnegative(),
        low: z.number().int().nonnegative(),
      })
      .strict(),
    endpoints: z
      .object({
        source: z.number().int().nonnegative(),
        blackbox: z.number().int().nonnegative(),
        high: z.number().int().nonnegative(),
        medium: z.number().int().nonnegative(),
        low: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

/**
 * An endpoint as a run remembers it: its identity and whether credentials are required.
 *
 * Deliberately not the whole `ObservedEndpoint`. No response shapes, no evidence ids, no
 * `actorVisibility`. A RunResult is already the largest document this tool writes and both
 * goldens are committed, so this carries only what the three consumers named in Q6 need:
 * the identity, and `authRequired`, because that is the field the access loosening rule in
 * M6.5 turns on.
 */
export const ObservationEndpointSummarySchema = z
  .object({
    id: z.string().min(1),
    method: z.string().min(1),
    path: z.string().min(1),
    authRequired: AuthRequiredSchema,
  })
  .strict();

/**
 * What a run remembers about its own Observation. Q6, decided 2026-08-22.
 *
 * `ref` alone was the whole of this until then, and three separate consumers needed what
 * was behind it: `renderText` section 2, which had to take the Observation as a caller
 * option and stop being a pure projection of a RunResult; `qai report`, which has only a
 * stored run and printed the reference instead of counts; and the half of M6.5's access
 * loosening rule that fires when an endpoint's `authRequired` moves away from `true`,
 * which was never built.
 *
 * Every field but `ref` is optional, so a run assembled without an Observation is still a
 * valid RunResult and says nothing about the application rather than reporting zeroes,
 * which would be a claim.
 *
 * **`mode` and `notes` widen the shape Q6 proposed, and the widening is deliberate.** The
 * brief said counts and endpoint identities, and with only those the text report still
 * could not render its own section from a RunResult: it prints the probe mode, and it
 * prints the probe's notes, which are the probe saying what it could not reach. Dropping
 * the notes would make a stored run overstate its own coverage, which is the thing
 * invariant I4 exists to prevent. Both are small, and the endpoint list is what the brief
 * was guarding against on size.
 */
export const ObservationRefSchema = z
  .object({
    ref: z.string().min(1),
    mode: ProbeModeSchema.optional(),
    counts: ObservationCountsSchema.optional(),
    endpoints: z.array(ObservationEndpointSummarySchema).optional(),
    notes: z.array(ObservationNoteSchema).optional(),
  })
  .strict();

export const RequirementResultSchema = z
  .object({
    requirementId: RequirementIdSchema,
    verdict: RequirementVerdictSchema,
    reason: z.string().min(1).optional(),
    checkIds: z.array(CheckIdSchema).default([]),
  })
  .strict();

export const CheckResultSchema = z
  .object({
    checkId: CheckIdSchema,
    type: CheckTypeSchema,
    requirementId: RequirementIdSchema.optional(),
    ruleId: z.union([AccessRuleIdSchema, AcceptanceCriterionIdSchema]).optional(),
    verdict: CheckVerdictSchema,
    /**
     * False only for a criterion marked `mode: fuzzy`, the single exception in
     * invariant I1. It drives `modelAssistedCheckCount` and the model assisted label
     * in the report, so it is required rather than defaulted.
     */
    deterministic: z.boolean(),
    severity: SeveritySchema,
    title: z.string().min(1),
    detail: z.string().min(1).optional(),
    locationRef: z.string().min(1).optional(),
    evidence: z.array(EvidenceIdSchema).default([]),
  })
  .strict();

export const StructuralEntryKindSchema = z.enum(['entity', 'endpoint', 'field']);

export const SpecifiedNotObservedSchema = z
  .object({
    kind: StructuralEntryKindSchema,
    name: z.string().min(1),
    requirementIds: z.array(RequirementIdSchema).default([]),
  })
  .strict();

export const ObservedNotSpecifiedSchema = z
  .object({
    kind: StructuralEntryKindSchema,
    id: z.string().min(1),
    severity: SeveritySchema,
  })
  .strict();

export const FieldMismatchSchema = z
  .object({
    entity: z.string().min(1),
    specifiedNotObserved: z.array(z.string().min(1)).default([]),
    observedNotSpecified: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const StructuralFindingsSchema = z
  .object({
    specifiedNotObserved: z.array(SpecifiedNotObservedSchema).default([]),
    observedNotSpecified: z.array(ObservedNotSpecifiedSchema).default([]),
    fieldMismatches: z.array(FieldMismatchSchema).default([]),
  })
  .strict();

export const RequirementTallySchema = z
  .object({
    total: z.int().min(0),
    verified: z.int().min(0),
    failed: z.int().min(0),
    unverified: z.int().min(0),
  })
  .strict();

export const CheckTallySchema = z
  .object({
    total: z.int().min(0),
    pass: z.int().min(0),
    fail: z.int().min(0),
    inconclusive: z.int().min(0),
  })
  .strict();

export const SummarySchema = z
  .object({
    requirements: RequirementTallySchema,
    checks: CheckTallySchema,
    /**
     * Requirements with at least one non-inconclusive check, divided by total
     * requirements. It is not a pass rate and must never be labeled as one.
     */
    coverage: z.number().min(0).max(1),
    findingsBySeverity: z
      .object({
        high: z.int().min(0),
        medium: z.int().min(0),
        low: z.int().min(0),
        info: z.int().min(0),
      })
      .strict(),
    /** Always displayed, including when zero, so the report states plainly how much
     * of the run was not deterministic. */
    modelAssistedCheckCount: z.int().min(0),
  })
  .strict();

export const UnverifiedReasonEntrySchema = z
  .object({
    requirementId: RequirementIdSchema,
    reason: UnverifiedReasonSchema,
    detail: z.string().min(1).optional(),
  })
  .strict();

export const RunResultSchema = z
  .object({
    resultVersion: z.string().min(1),
    runId: RunIdSchema,
    toolVersion: z.string().min(1),
    startedAt: InstantSchema,
    finishedAt: InstantSchema,
    spec: SpecRefSchema,
    target: TargetRefSchema,
    observation: ObservationRefSchema.optional(),
    requirements: z.array(RequirementResultSchema).default([]),
    checks: z.array(CheckResultSchema).default([]),
    structural: StructuralFindingsSchema.default({
      specifiedNotObserved: [],
      observedNotSpecified: [],
      fieldMismatches: [],
    }),
    summary: SummarySchema,
    unverifiedReasons: z.array(UnverifiedReasonEntrySchema).default([]),
  })
  .strict();

export type RequirementVerdict = z.infer<typeof RequirementVerdictSchema>;
export type CheckVerdict = z.infer<typeof CheckVerdictSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type CheckType = z.infer<typeof CheckTypeSchema>;
export type UnverifiedReason = z.infer<typeof UnverifiedReasonSchema>;
export type RequirementResult = z.infer<typeof RequirementResultSchema>;
export type CheckResultRecord = z.infer<typeof CheckResultSchema>;
export type StructuralFindings = z.infer<typeof StructuralFindingsSchema>;
export type Summary = z.infer<typeof SummarySchema>;
export type ObservationCounts = z.infer<typeof ObservationCountsSchema>;
export type ObservationEndpointSummary = z.infer<typeof ObservationEndpointSummarySchema>;
export type RunResult = z.infer<typeof RunResultSchema>;
