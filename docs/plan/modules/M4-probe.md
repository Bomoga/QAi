# M4: Probe and Structural Diff

**Status:** complete, except M4.4, which is blocked on the dependency decision in Open questions
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

For Prisma, prefer `@prisma/internals` to parse the schema properly rather than reading it with regex.

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
4. **M4.4** Implement the Prisma schema adapter producing entities and fields with `origin: "schema"`.
5. **M4.5** Implement the black box crawler, read-only, with a page and depth budget.
6. **M4.6** Implement endpoint identity normalization, with tests for collision and stability.
7. **M4.7** Implement source and black box merge with confidence and disagreement notes.
8. **M4.8** Implement `diffSpecObservation` and the severity rules above.
9. **M4.9** Integration test against `fixtures/ledger` covering defects D5 and D6.

## Definition of Done

```
pnpm --filter @qai/core test -- probe diff
pnpm --filter @qai/cli exec qai probe --config fixtures/ledger/qai.config.yaml --json
```

- Every entity and endpoint in `fixtures/ledger` appears in the Observation with correct `origin`.
- D5, the undeclared debug endpoint, appears in `observedNotSpecified` at medium severity.
- D6, the unimplemented audit entity, appears in `specifiedNotObserved` at low severity.
- Removing `sourceRoot` from config degrades to black box mode and still finds every endpoint the crawler can reach, with `origin: "inferred"` and reduced confidence.
- No request issued by the probe uses a method other than GET or HEAD.

## Do Not

- Do not let the probe write to the target, submit forms, or follow links off-origin.
- Do not default `authRequired` to `true`. Unknown is a valid and honest value.
- Do not report an inferred entity as though it came from a schema.
- Do not add framework adapters beyond Q1's list without approval; breadth here is a time sink that does not serve the demo.

## Open questions

- Q1: adapter list at MVP. Proposal above.
- M4.4 is blocked on a dependency decision. The implementation notes say to prefer `@prisma/internals` to parse `schema.prisma` rather than reading it with regex, but `@prisma/internals` is not in the approved runtime dependency list in `04-CONVENTIONS.md` and is not installed. Adding it needs human approval, per that file's rule that no dependency is added without one. Three ways out, in the order they seem worth taking:
  1. Approve `@prisma/internals` as a runtime dependency of `@qai/core`. It is what the module asks for and it parses the real grammar, but it is a large transitive tree for one adapter, and it is a runtime dependency of a tool whose whole value is being cheap to run in CI.
  2. Approve it as an optional dependency, imported lazily the way `playwright` is in M5, so a repository with no Prisma schema never loads it. Falls back to a note when it is absent.
  3. Correct the plan to read `schema.prisma` textually, the same posture as the Next.js and Express adapters. The block grammar is regular: `model X { ... }` with one field per line. This adds no dependency and matches what M4.2 and M4.3 already do, at the cost of not resolving attributes and type aliases properly.
  Nothing else in M4 depends on M4.4, so M4.5 onward can proceed once a decision is made.
