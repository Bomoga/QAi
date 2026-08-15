# M9: Spec Extraction from Prose

**Status:** deferred. Build only if stages S0 through S6 in `05-BUILD-ORDER.md` are complete by week 6. The corpus run in week 8 matters more than this module.
**Owns:** `packages/core/src/llm/`
**Depends on:** M1
**Depended on by:** nothing
**Read alongside:** `04-CONVENTIONS.md` rule R1

## Purpose

Turn a prose requirements document into a draft spec that a human then reviews and corrects. This lowers the cost of adoption. It does not lower the standard of evidence, because the human confirmation step is where intent is actually established.

## Inputs

- A markdown or plain text document, a PRD, or a pasted conversation.

## Outputs

- A draft YAML spec, written to a file, never applied silently.
- An extraction report listing what was inferred, what was ambiguous, and what was dropped.

## Public API

```ts
export function extractSpec(doc: string, deps: { model: ModelClient }): Promise<{
  draft: string;                 // YAML
  inferred: InferenceNote[];
  ambiguous: AmbiguityNote[];
  dropped: DroppedNote[];
}>;
```

## Implementation notes

**This module is the only place in the repository permitted to import a model client**, per rule R1. Every function here returns text, structure, or notes. No function here may return a value assignable to `Verdict`, and a type-level test asserts that.

**The confirmation step is not friction to be optimized away.** It is where the user decides what correct means. The CLI writes the draft to a file and tells the user to review it; it never runs checks against a draft that has not been saved by a human. A wrong requirement silently becomes a wrong check and a confidently wrong verdict, which is the worst output this tool can produce.

**Extraction is conservative.** Prefer dropping an ambiguous requirement and listing it in `ambiguous` to inventing an access rule. Every access rule the model proposes is labeled as proposed in a YAML comment on the line above it, so review has something to catch.

**Output must validate.** Run the draft through M1's loader before writing. If it fails, fix mechanically where possible, and otherwise write it anyway with the diagnostics appended as comments so the user can see exactly what needs attention.

**Model configuration.** Provider agnostic through one narrow interface. Model name, endpoint, and key come from configuration and environment, never hard-coded. The tool functions completely with no model configured; only this command becomes unavailable.

## Tasks

1. **M9.1** Define the `ModelClient` interface and the ESLint import restriction that confines it to this directory, plus a test asserting the restriction is configured.
2. **M9.2** Implement the extraction prompt, requesting strict JSON, with schema-constrained parsing and repair on malformed output.
3. **M9.3** Map extraction output into the Spec shape, labeling every proposed access rule with a comment.
4. **M9.4** Implement `ambiguous` and `dropped` reporting.
5. **M9.5** Validate the draft through M1 before writing, appending diagnostics as comments on failure.
6. **M9.6** Add `qai extract <doc> --out spec/draft.spec.yaml` to the CLI, with an explicit message that the draft requires review.
7. **M9.7** Test with three prose documents of differing quality, asserting that no invalid YAML is ever written and that ambiguity is reported rather than resolved.

## Definition of Done

```
pnpm --filter @qai/core test -- extraction
```

- A type-level test proves no exported function here can return a `Verdict`.
- The ESLint restriction fails the build when a model client is imported outside this directory.
- Every generated access rule carries a proposed-and-unreviewed marker.
- With no model configured, every other command works unchanged.

## Do Not

- Do not run checks against an unreviewed draft.
- Do not let extraction write over an existing spec file without an explicit overwrite flag.
- Do not expand this module into fix suggestion, summarization, or triage during the sprint, even though those are legitimate future uses of the same boundary.

## Open questions

- Which model and provider. Deferred until the module is scheduled.
