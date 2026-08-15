# M1: Spec Schema and Loader

**Status:** not started
**Owns:** `packages/core/src/contracts/`, `packages/core/src/spec/`
**Depends on:** nothing
**Depended on by:** M2, M3, M4, M5, M6, M7, M8, M9
**Read alongside:** `03-CONTRACTS.md`

## Purpose

Define the three contracts once, and turn one or more YAML spec files into a validated, hashed, in-memory Spec with every identifier assigned and every condition parsed into an AST. Everything downstream is typed by this module, so it is built first and changed reluctantly.

## Inputs

- One or more YAML files, default glob `spec/*.spec.yaml`, path overridable.
- No network, no environment, no target access.

## Outputs

- `Spec` object matching `03-CONTRACTS.md` section 1, with derived identifiers populated.
- The spec hash, a sha256 over the canonicalized spec, serialized as `spec.hash` in the RunResult and used by M6 to tell whether two runs are comparable.
- `LoadDiagnostic[]`, each with severity, file, YAML path, and message.
- Generated JSON Schema written to `schema/spec.schema.json` for editor autocomplete.

## Public API

```ts
export function loadSpec(paths: string[], opts?: LoadOptions):
  { spec: Spec; hash: string; diagnostics: LoadDiagnostic[] } | { error: SpecError };

export function parseCondition(input: string): ConditionAst | ConditionParseError;

export const SpecSchema: z.ZodType<Spec>;
export const ObservationSchema: z.ZodType<Observation>;
export const RunResultSchema: z.ZodType<RunResult>;
export const EvidenceSchema: z.ZodType<Evidence>;
```

## Implementation notes

**Contracts first.** Write all four Zod schemas before the loader. Derive types with `z.infer`. There is no hand-written interface duplicating a schema anywhere in the repository.

**Condition grammar.** Conditions are parsed, never evaluated as code. Never construct a `Function` and never call `eval`. The supported subset, pending Q4:

```
condition   := comparison (("and" | "&&") comparison)*
comparison  := operand op operand
op          := "==" | "!=" | "in" | "not in"
operand     := actorRef | entityRef | literal
actorRef    := "actor." IDENT
entityRef   := IDENT "." IDENT
literal     := STRING | NUMBER | "null" | "[" literal ("," literal)* "]"
```

Anything outside the grammar is a load-level error naming the file, the requirement id, and the offending substring. It is never silently ignored, because a silently skipped access rule is a false sense of coverage, which is worse than no coverage.

**Identifier derivation.** Absent `AR-` and `AC-` identifiers are assigned as `<REQ-ID>-<two digit ordinal>`. Assignment is stable given the same file content. A hand-written identifier is never renumbered.

**Canonicalization for hashing.** Sort keys, normalize whitespace in statements, drop comments, exclude derived identifiers. Two specs that differ only in formatting must hash identically.

**Merging multiple files.** Requirement ids must be globally unique across files; a collision is an error naming both files. Actors and entities merge by name, and a conflicting redefinition is an error rather than a last-write-wins.

**Diagnostics that are warnings, not errors:** an actor referenced by no rule, an entity referenced by no requirement, a requirement with no checks (which becomes `unverified` with reason `no-checks-defined` at run time, per contract).

## Tasks

1. **M1.1** Scaffold `packages/core` with tsup, vitest, strict tsconfig, and the `contracts/` directory.
2. **M1.2** Write `SpecSchema` and its sub-schemas, with the exact field names in `03-CONTRACTS.md`. Include enum closure for `action`, `effect`, `mode`.
3. **M1.3** Write `ObservationSchema`, `RunResultSchema`, `EvidenceSchema`. They are not used yet; defining them now prevents divergence later.
4. **M1.4** Implement the condition tokenizer and parser producing `ConditionAst`. Table-driven tests over valid and invalid inputs, including every rejection case.
5. **M1.5** Implement YAML loading, multi-file merge, identifier derivation, and diagnostics.
6. **M1.6** Implement canonicalization and hashing. Test that formatting differences hash identically and that a semantic change does not.
7. **M1.7** Generate `schema/spec.schema.json` from the Zod schema via a build script, and assert in a test that the committed file matches the generated one.
8. **M1.8** Author `fixtures/ledger/spec/ledger.spec.yaml`, roughly fifteen requirements, covering every defect and both negative controls in `06-TESTING.md`.

## Definition of Done

```
pnpm --filter @qai/core test
pnpm --filter @qai/core exec tsx scripts/validate-fixture-spec.ts
```

- Loading `fixtures/ledger/spec/ledger.spec.yaml` produces zero errors and the expected requirement count.
- Every rejection case in the grammar has a test asserting the error message names file, requirement id, and offending text.
- A spec with a duplicate requirement id across two files produces an error naming both files.

## Do Not

- Do not evaluate conditions here. Parsing only; evaluation belongs to M3 and M5.
- Do not add verdict, status, or evidence fields to the Spec contract. See decision D7.
- Do not read the target, the filesystem outside the given spec paths, or any environment variable.
- Do not introduce a YAML anchor or extension feature without approval; specs must stay readable and diffable.

## Open questions

- Q4 from `07-DECISIONS.md`: the exact condition subset. Proposal above; implement it and flag anything the fixture spec cannot express.
