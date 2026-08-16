import { z } from 'zod';

/**
 * Evidence, from 03-CONTRACTS.md. The recorded artifact proving a check's verdict.
 *
 * Invariant I3: a finding without one of these is not a finding. Rule R7: the artifact
 * is captured before the verdict is decided, so an evidence id always exists by the time
 * anything has an opinion.
 *
 * `redactions` names every path that was altered. That list is the point: a reader has
 * to be able to see that redaction happened rather than mistake an absence for a fact.
 * Redaction is applied at capture time, before any write, per rule R8, so this schema
 * describes something already safe to hold.
 */

export const EvidenceIdSchema = z
  .string()
  .regex(/^EV-[A-Za-z0-9]+$/, 'evidence id must look like EV-7d10b3');

export const EvidenceKindSchema = z.enum(['http', 'screenshot', 'file', 'log']);

/** ISO 8601 instant. Supplied by the injected clock, per rule R6, never read here. */
export const InstantSchema = z.iso.datetime({ offset: true });

export const EvidenceRequestSchema = z
  .object({
    method: z.string().min(1),
    url: z.string().min(1),
    headers: z.record(z.string(), z.string()).default({}),
  })
  .strict();

export const EvidenceResponseSchema = z
  .object({
    status: z.int().min(100).max(599),
    headers: z.record(z.string(), z.string()).default({}),
    /** Path to the stored body. The body itself never lives inline in a RunResult. */
    bodyRef: z.string().min(1).optional(),
    truncated: z.boolean().default(false),
  })
  .strict();

export const EvidenceSchema = z
  .object({
    id: EvidenceIdSchema,
    kind: EvidenceKindSchema,
    capturedAt: InstantSchema,
    actorId: z.string().min(1).optional(),
    request: EvidenceRequestSchema.optional(),
    response: EvidenceResponseSchema.optional(),
    redactions: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;
export type EvidenceRequest = z.infer<typeof EvidenceRequestSchema>;
export type EvidenceResponse = z.infer<typeof EvidenceResponseSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
