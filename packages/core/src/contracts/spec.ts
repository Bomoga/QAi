import { z } from 'zod';

/**
 * Spec, section 1 of 03-CONTRACTS.md. Input only, never mutated by a run.
 *
 * Every schema here is strict. A key the schema does not know is an error, not
 * something to drop quietly: a misspelled `acceptanceCriteria` that parses cleanly
 * would remove every check on a requirement and report the result as coverage.
 * That failure is invisible in the output, which makes it the worst kind.
 *
 * Derived identifiers on access rules and acceptance criteria are optional here.
 * M1.5 assigns them at load time from the parent requirement and ordinal position.
 */

/** 03-CONTRACTS.md, identifier conventions. Hand-authored and stable. */
export const RequirementIdSchema = z
  .string()
  .regex(/^REQ-[A-Za-z0-9_-]+$/, 'requirement id must look like REQ-014');

export const AccessRuleIdSchema = z
  .string()
  .regex(/^AR-[A-Za-z0-9_-]+$/, 'access rule id must look like AR-014-01');

export const AcceptanceCriterionIdSchema = z
  .string()
  .regex(/^AC-[A-Za-z0-9_-]+$/, 'acceptance criterion id must look like AC-014-01');

/**
 * Closed enums. An unrecognized action or effect is a load error rather than a
 * skipped rule, because a skipped access rule reads as coverage that does not exist.
 */
export const AccessActionSchema = z.enum(['read', 'create', 'update', 'delete', 'list']);

/**
 * A deny rule is verified by attempting the action and requiring refusal; an allow
 * rule by attempting it and requiring success. Deny rules are the higher severity class.
 */
export const AccessEffectSchema = z.enum(['allow', 'deny']);

/** Fuzzy criteria are model assisted and constrained by invariant I1. */
export const CriterionModeSchema = z.enum(['deterministic', 'fuzzy']);

export const ActorSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1).optional(),
  })
  .strict();

export const EntityFieldSchema = z
  .object({
    name: z.string().min(1),
    type: z.string().min(1),
    /** Marks a field that must never appear in evidence output. Redaction reads this. */
    sensitive: z.boolean().optional(),
  })
  .strict();

export const EntitySchema = z
  .object({
    name: z.string().min(1),
    ownedBy: z.string().min(1).optional(),
    fields: z.array(EntityFieldSchema).default([]),
  })
  .strict();

export const AccessRuleSchema = z
  .object({
    id: AccessRuleIdSchema.optional(),
    actor: z.string().min(1),
    action: AccessActionSchema,
    resource: z.string().min(1),
    /**
     * A restricted expression over `actor.*` and `<Entity>.*`. Held as a string here
     * and parsed into an AST by M1.4 at load time. It is never evaluated as JavaScript
     * and never passed to `eval`.
     */
    condition: z.string().min(1).optional(),
    effect: AccessEffectSchema,
  })
  .strict();

export const AcceptanceCriterionSchema = z
  .object({
    id: AcceptanceCriterionIdSchema.optional(),
    mode: CriterionModeSchema,
    given: z.string().min(1),
    when: z.string().min(1),
    then: z.string().min(1),
  })
  .strict();

/**
 * A requirement with neither access rules nor acceptance criteria is valid and is
 * reported as `unverified` with reason `no-checks-defined`. That is deliberate: it
 * makes a coverage gap visible instead of hiding it.
 */
export const RequirementSchema = z
  .object({
    id: RequirementIdSchema,
    statement: z.string().min(1),
    entities: z.array(z.string().min(1)).default([]),
    fields: z.array(z.string().min(1)).default([]),
    tags: z.array(z.string().min(1)).default([]),
    accessRules: z.array(AccessRuleSchema).default([]),
    acceptanceCriteria: z.array(AcceptanceCriterionSchema).default([]),
  })
  .strict();

export const SpecSchema = z
  .object({
    specVersion: z.string().min(1),
    name: z.string().min(1),
    actors: z.array(ActorSchema).default([]),
    entities: z.array(EntitySchema).default([]),
    requirements: z.array(RequirementSchema).default([]),
  })
  .strict();

export type AccessAction = z.infer<typeof AccessActionSchema>;
export type AccessEffect = z.infer<typeof AccessEffectSchema>;
export type CriterionMode = z.infer<typeof CriterionModeSchema>;
export type Actor = z.infer<typeof ActorSchema>;
export type EntityField = z.infer<typeof EntityFieldSchema>;
export type Entity = z.infer<typeof EntitySchema>;
export type AccessRule = z.infer<typeof AccessRuleSchema>;
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;
export type Requirement = z.infer<typeof RequirementSchema>;
export type Spec = z.infer<typeof SpecSchema>;
