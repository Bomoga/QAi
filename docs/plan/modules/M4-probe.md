# M4: Probe and Structural Diff

**Status:** complete
**Owns:** `packages/core/src/probe/`, `packages/core/src/diff/spec-observation.ts`
**Depends on:** M1, M2
**Depended on by:** M7
**Optionally consumed by:** M3, for resource resolution
**Read alongside:** `03-CONTRACTS.md`

## Purpose

Build a picture of what the target actually contains, then diff it against what the spec says should exist. The diff produces findings before any check runs, and it is the part of the output that makes an engineer lean in, because it describes their own application back to them.

## Inputs

- `TargetContext` with base URL and optional source root.
- Spec, used only for entity name matching and for the diff. The probe must not be biased by the spec; it records what exists, and matching happens afterward.

## Outputs

- `Observation` matching `03-CONTRACTS.md` section 2.
- `structural` block of the RunResult: `specifiedNotObserved`, `observedNotSpecified`, `fieldMismatches`.

## Public API

```ts
export function probe(ctx: TargetContext, opts: ProbeOptions): Promise<Observation>;
export function diffSpecObservation(spec: Spec, obs: Observation): StructuralBlock;
```

## Implementation notes

**Source first, black box fallback, hybrid when both are available.** Set `mode` accordingly. When both agree, confidence is `high`. When they disagree, record both and set `medium`, with a note naming the disagreement. Disagreement is information, not an error to resolve silently.

**Source adapters, pending Q1.** MVP targets: Next.js App Router route handlers, Express routers, and Prisma schema. Start with regex and glob heuristics over `fast-glob`; the patterns in generated code are extremely regular. Escalate to `ts-morph` only where a specific case demands resolution, and record that escalation as a note in the module rather than adopting AST parsing wholesale.

For Prisma, read `schema.prisma` textually, the same way the route adapters read source. **Corrected 2026-08-16.** This line previously said to prefer `@prisma/internals` to parse the schema properly rather than reading it with regex. That package is not on the approved dependency list in `04-CONVENTIONS.md`, and the decision was to correct the plan rather than widen the list: the block grammar is regular, the adapter reads `model` and `view` blocks, and a schema it cannot read produces a note rather than a guess.

Every source-derived endpoint carries `handlerRef` in `path:line` form. That reference is what makes a finding actionable and what SARIF needs for inline annotation.

**Black box crawl.** Authenticated as the first configured actor, follow same-origin links, record every observed request the application makes, and infer endpoints from network traffic. Strictly read-only: GET and HEAD only, no form submission, no state mutation, per the architecture constraint.

**Endpoint identity.** Normalize concrete ids into parameters so `/api/invoices/42` and `/api/invoices/43` are one endpoint `GET /api/invoices/:id`. Identity must be stable across runs, since M6 diffs on it.

**Entity matching.** Match spec entities to observed models case-insensitively and tolerant of singular and plural. Record the match and its confidence. An unmatched spec entity becomes `specifiedNotObserved`, which is a finding, not an error.

**Severity for structural findings.** `observedNotSpecified` endpoints default to `medium`, raised to `high` if the endpoint is unauthenticated and returns fields belonging to a spec entity, lowered to `info` for obvious static asset and health check routes. `specifiedNotObserved` defaults to `low`, because a missing feature is usually known to the developer, and `fieldMismatches` for an observed-not-specified field defaults to `medium` since undeclared fields in responses are how data leaks.

**Authentication determination.** Set `authRequired: true` only after observing a refusal without credentials. Otherwise `"unknown"`. Never infer it from a path pattern like `/api/admin/`.

## Tasks

1. **M4.1** Define the probe interfaces and the adapter registration shape.
2. **M4.2** Implement the Next.js App Router adapter: enumerate route files, extract methods, resolve dynamic segments, produce `handlerRef`.
3. **M4.3** Implement the Express adapter.
4. **M4.4** Implement the Prisma schema adapter producing entities and fields with `origin: "schema"`, reading the schema textually.
5. **M4.5** Implement the black box crawler, read-only, with a page and depth budget.
6. **M4.6** Implement endpoint identity normalization, with tests for collision and stability.
7. **M4.7** Implement source and black box merge with confidence and disagreement notes.
8. **M4.8** Implement `diffSpecObservation` and the severity rules above.
9. **M4.9** Integration test against `fixtures/ledger` covering defects D5 and D6.

## Definition of Done

```
pnpm --filter @qai/core test probe diff
pnpm --filter @qai/cli exec qai probe --config fixtures/ledger/qai.config.yaml --json
```

**Corrected 2026-08-16.** The first command was written `test -- probe diff` and filtered
nothing. pnpm forwards the `--` to the script, so vitest is invoked as
`vitest run "--" "probe" "diff"` and reads everything after the `--` as passthrough
arguments rather than as filename filters. The whole core suite ran, 32 files, and a
Definition of Done that passes by running something other than what it names is the same
trap as the vitest config one at M1.2. Without the `--` it filters to 9 files and 283
tests. `pnpm --filter @qai/core exec vitest run probe diff` is the explicit equivalent and
does not depend on how the package's `test` script is defined.

- Every entity and endpoint in `fixtures/ledger` appears in the Observation with correct `origin`, which for this fixture means `origin: "blackbox"` and reduced confidence. **Corrected 2026-08-16.** The line previously implied a source reading. The adapters above target Next.js, Express, and Prisma; `fixtures/ledger` is a hand-written `node:http` server with no ORM, chosen at S0 so the fixture needed no runtime dependencies, so no adapter recognizes it and no entity in its Observation comes from a schema. The adapters are built and tested against synthetic source trees instead. Rejected: a `node:http` adapter, which is outside Q1's list and covers a framework no real user has, and rewriting the fixture on Express, which adds a runtime dependency and risks the three second boot requirement in `06-TESTING.md`.
- D5, the undeclared debug endpoint, appears in `observedNotSpecified` at medium severity.
- D6, the unimplemented audit entity, appears in `specifiedNotObserved` at low severity.
- Removing `sourceRoot` from config degrades to black box mode and still finds every endpoint the crawler can reach, with `origin: "blackbox"` and reduced confidence. **Corrected 2026-08-16.** This line said `origin: "inferred"`, which no endpoint can carry: `EndpointOrigin` in `03-CONTRACTS.md` is `source` or `blackbox`, while `inferred` is an entity and field origin, paired with `schema`.
- No request issued by the probe uses a method other than GET or HEAD.

## Do Not

- Do not let the probe write to the target, submit forms, or follow links off-origin.
- Do not default `authRequired` to `true`. Unknown is a valid and honest value.
- Do not report an inferred entity as though it came from a schema.
- Do not add framework adapters beyond Q1's list without approval; breadth here is a time sink that does not serve the demo.

## Open questions

- Q1: adapter list at MVP. Proposal above.
- **Resolved 2026-08-16, M4.4 dependency.** The implementation notes said to prefer `@prisma/internals`, which is not on the approved runtime dependency list in `04-CONVENTIONS.md`. Three options were put up: approve it as a runtime dependency, approve it as a lazily imported optional one, or correct the plan to read the schema textually. The decision was to read it textually and add nothing. The implementation note above has been corrected to match.
- Raised at M4.4, not blocking: the adapter reports `model` and `view` blocks as entities and ignores `enum` and composite `type` blocks. A composite type is embedded in a response but is not a top level entity, so a spec that declares one would see it as specified and not observed. No fixture exercises that today.
