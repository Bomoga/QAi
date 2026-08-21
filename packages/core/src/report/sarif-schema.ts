import { z } from 'zod';

/**
 * A transcription of the parts of the SARIF 2.1.0 schema this tool's output touches.
 *
 * **This is a transcription, not the published schema.** Validating against the real
 * document means running a JSON Schema validator, and no validator is on the approved
 * dependency list in 04-CONVENTIONS.md, while rule R9 forbids a test fetching one at
 * run time. Recorded in the M7 Open questions rather than resolved locally, since
 * adding a dependency is a decision for a human.
 *
 * Source: `sarif-schema-2.1.0.json`, OASIS SARIF v2.1.0 errata01, at
 * `https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/`.
 *
 * What is transcribed, and what it is worth: the required property lists, the closed
 * enumerations, and the types of every property this emitter writes. What is not
 * transcribed is every property this emitter never writes. A conforming document that
 * this schema rejects would be a bug in the transcription; a non-conforming document
 * that it accepts is possible only in a corner the emitter does not reach.
 *
 * SARIF objects carry property bags and permit extension, so nothing here is `.strict()`
 * except where the specification closes the set.
 */

/** `result.level`, a closed enumeration in the specification. */
export const SarifLevelSchema = z.enum(['none', 'note', 'warning', 'error']);

/** `result.kind`, a closed enumeration in the specification. */
export const SarifResultKindSchema = z.enum([
  'notApplicable',
  'pass',
  'fail',
  'review',
  'open',
  'informational',
]);

export const SarifMessageSchema = z.object({
  text: z.string().optional(),
  markdown: z.string().optional(),
  id: z.string().optional(),
});

export const SarifArtifactLocationSchema = z.object({
  uri: z.string().optional(),
  uriBaseId: z.string().optional(),
  index: z.int().min(-1).optional(),
});

export const SarifRegionSchema = z.object({
  startLine: z.int().min(1).optional(),
  startColumn: z.int().min(1).optional(),
  endLine: z.int().min(1).optional(),
  endColumn: z.int().min(1).optional(),
});

export const SarifPhysicalLocationSchema = z.object({
  artifactLocation: SarifArtifactLocationSchema.optional(),
  region: SarifRegionSchema.optional(),
});

export const SarifLogicalLocationSchema = z.object({
  name: z.string().optional(),
  fullyQualifiedName: z.string().optional(),
  kind: z.string().optional(),
  index: z.int().min(-1).optional(),
});

export const SarifLocationSchema = z.object({
  id: z.int().min(-1).optional(),
  physicalLocation: SarifPhysicalLocationSchema.optional(),
  logicalLocations: z.array(SarifLogicalLocationSchema).optional(),
  message: SarifMessageSchema.optional(),
});

/** `reportingDescriptor`, which requires `id` and nothing else. */
export const SarifReportingDescriptorSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  shortDescription: SarifMessageSchema.optional(),
  fullDescription: SarifMessageSchema.optional(),
  helpUri: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

/** `result`, which requires `message` and nothing else. */
export const SarifResultSchema = z.object({
  ruleId: z.string().optional(),
  ruleIndex: z.int().min(-1).optional(),
  kind: SarifResultKindSchema.optional(),
  level: SarifLevelSchema.optional(),
  message: SarifMessageSchema,
  locations: z.array(SarifLocationSchema).optional(),
  partialFingerprints: z.record(z.string(), z.string()).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

/** `toolComponent`, which requires `name`. */
export const SarifToolComponentSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  semanticVersion: z.string().optional(),
  informationUri: z.string().optional(),
  rules: z.array(SarifReportingDescriptorSchema).optional(),
});

/** `tool`, which requires `driver`. */
export const SarifToolSchema = z.object({
  driver: SarifToolComponentSchema,
});

export const SarifInvocationSchema = z.object({
  executionSuccessful: z.boolean(),
  startTimeUtc: z.string().optional(),
  endTimeUtc: z.string().optional(),
});

export const SarifAutomationDetailsSchema = z.object({
  id: z.string().optional(),
  guid: z.string().optional(),
});

/** `run`, which requires `tool`. */
export const SarifRunSchema = z.object({
  tool: SarifToolSchema,
  automationDetails: SarifAutomationDetailsSchema.optional(),
  invocations: z.array(SarifInvocationSchema).optional(),
  results: z.array(SarifResultSchema).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

/** `sarifLog`, which requires `version` and `runs`. `version` is a closed enumeration. */
export const SarifLogSchema = z.object({
  $schema: z.string().optional(),
  version: z.literal('2.1.0'),
  runs: z.array(SarifRunSchema),
});

export type SarifLog = z.infer<typeof SarifLogSchema>;
