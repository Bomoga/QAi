import { z } from 'zod';

import { EvidenceIdSchema, InstantSchema } from './evidence.ts';

/**
 * Observation, section 2 of 03-CONTRACTS.md. Describes what exists, never what should
 * exist. The output of a probe, which is read-only by construction.
 *
 * `origin` and `confidence` are mandatory on every entity and endpoint because a report
 * may not present a low-confidence inference as fact. They have no defaults for the same
 * reason: a missing confidence should be a load error, not an assumed `high`.
 */

export const ProbeModeSchema = z.enum(['source', 'blackbox', 'hybrid']);
export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);

export const EntityOriginSchema = z.enum(['schema', 'inferred']);
export const EndpointOriginSchema = z.enum(['source', 'blackbox']);
export const FieldOriginSchema = z.enum(['schema', 'inferred']);

/**
 * `"unknown"` unless positively determined. Never defaulted to `true`: assuming an
 * endpoint is protected is exactly the assumption this tool exists to stop people making.
 */
export const AuthRequiredSchema = z.union([z.boolean(), z.literal('unknown')]);

/** Filled by checks, not by the probe. A probe-only run leaves every actor `untested`. */
export const ActorVisibilitySchema = z.enum(['untested', 'visible', 'refused', 'error']);

export const ObservedTargetSchema = z
  .object({
    baseUrl: z.string().min(1).optional(),
    sourceRoot: z.string().min(1).optional(),
  })
  .strict();

export const ObservedFieldSchema = z
  .object({
    name: z.string().min(1),
    type: z.string().min(1).optional(),
    origin: FieldOriginSchema,
  })
  .strict();

export const ObservedEntitySchema = z
  .object({
    name: z.string().min(1),
    origin: EntityOriginSchema,
    confidence: ConfidenceSchema,
    fields: z.array(ObservedFieldSchema).default([]),
    evidence: z.array(EvidenceIdSchema).default([]),
  })
  .strict();

export const ResponseShapeSchema = z
  .object({
    entity: z.string().min(1).optional(),
    fields: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const ObservedEndpointSchema = z
  .object({
    /** Stable identity, for example `GET /api/invoices/:id`. M6 compares runs on this. */
    id: z.string().min(1),
    method: z.string().min(1),
    path: z.string().min(1),
    origin: EndpointOriginSchema,
    confidence: ConfidenceSchema,
    handlerRef: z.string().min(1).optional(),
    authRequired: AuthRequiredSchema,
    responseShape: ResponseShapeSchema.optional(),
    actorVisibility: z.record(z.string(), ActorVisibilitySchema).default({}),
    evidence: z.array(EvidenceIdSchema).default([]),
  })
  .strict();

/**
 * A probe that fails partially produces a partial Observation with reduced confidence
 * and a stated reason. These notes carry that reason, so the report can say what was
 * not seen rather than presenting a gap as an absence.
 */
export const ObservationNoteSchema = z
  .object({
    level: z.enum(['info', 'warn', 'error']),
    message: z.string().min(1),
    refs: z.array(EvidenceIdSchema).default([]),
  })
  .strict();

export const ObservationSchema = z
  .object({
    observationVersion: z.string().min(1),
    observedAt: InstantSchema,
    mode: ProbeModeSchema,
    target: ObservedTargetSchema,
    entities: z.array(ObservedEntitySchema).default([]),
    endpoints: z.array(ObservedEndpointSchema).default([]),
    notes: z.array(ObservationNoteSchema).default([]),
  })
  .strict();

export type ProbeMode = z.infer<typeof ProbeModeSchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;
export type AuthRequired = z.infer<typeof AuthRequiredSchema>;
export type ActorVisibility = z.infer<typeof ActorVisibilitySchema>;
export type ObservedField = z.infer<typeof ObservedFieldSchema>;
export type ObservedEntity = z.infer<typeof ObservedEntitySchema>;
export type ObservedEndpoint = z.infer<typeof ObservedEndpointSchema>;
export type ObservationNote = z.infer<typeof ObservationNoteSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
