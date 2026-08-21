# Conventions for Implementation

Written for Claude Code agents. Follow these literally.

## Session start protocol

1. Read `00-INDEX.md`, `01-PRODUCT.md`, this file.
2. Read `03-CONTRACTS.md` if the task touches types or output.
3. Read the single `modules/Mx-*.md` file for the assigned task.
4. Do not read other module files. If the task appears to require another module's internals, stop and report the coupling instead of reading around it.

## Task protocol

- One module per branch, branched from `dev`. See the git section below.
- Work through the numbered `## Tasks` list in the module file in order. Each task is sized to be a single commit.
- After each task, run the module's verification commands. Do not proceed with failing checks.
- If a task's description conflicts with the code as found, trust the code about what exists and this plan about what is intended, then report the conflict.
- If a task is blocked, write the blocker into the module file's `## Open questions` section and move to the next unblocked task. Never invent a resolution to a blocker.

## Stack

- TypeScript, strict mode, `noUncheckedIndexedAccess` enabled, Node 22 or newer, ESM only.
- pnpm workspaces. `tsup` for bundling, `vitest` for tests, `eslint` with `typescript-eslint`, `prettier` for formatting.
- Runtime dependencies, deliberately few: `zod`, `commander`, `@clack/prompts`, `picocolors`, `undici`, `yaml`, `better-sqlite3`, `fast-glob`.
- Optional peer dependency: `playwright`, imported lazily, never at module top level.
- Do not add a dependency without an entry in the module's `## Open questions` and human approval. No ORM, no logging framework, no dependency injection container, no HTTP client wrapper.
- **This list governs `packages/`, not `fixtures/`.** A fixture depends on whatever framework it is a fixture of, or it cannot be one: `fixtures/ledger-express` needs `express` for the source adapters to have a route table to read, and that was approved at S9.3. A fixture dependency still needs approval, and it must not require a toolchain to install, because a clean install is part of the definition of success. It never becomes a dependency of the product.

## Hard rules

**R1. The model boundary.** Only `packages/core/src/llm/` may import an LLM client. Every other file importing one is a build failure; enforce with an ESLint `no-restricted-imports` rule scoped by path, and add a test asserting the rule is configured. Functions in `llm/` return suggestions, summaries, or extractions. No function in `llm/` may return a value assignable to `Verdict`.

**R2. Validate at boundaries.** Every value entering `core` from a file, a network response, or a CLI argument passes through a Zod parse. Never cast with `as` to satisfy the compiler at a boundary.

**R3. No `any`.** Use `unknown` and narrow. A single `any` requires an inline comment explaining why narrowing is impossible.

**R4. Errors are values at the check level.** A check returns a `CheckResult` with verdict `inconclusive` rather than throwing. Throwing is reserved for programmer error and for fatal conditions defined in `03-CONTRACTS.md` exit codes 2 and 3.

**R5. No output from `core`.** No `console.*`, no `process.stdout`, no `process.exit` in `packages/core`. Progress is reported through an injected reporter interface.

**R6. Determinism.** No wall-clock reads, random values, or environment reads inside check logic. Clock and identifier generation are injected so tests are reproducible and golden files are stable.

**R7. Evidence before verdict.** Capture the artifact first, then decide. A code path that decides a verdict without a captured evidence identifier is a bug.

**R8. Redact on capture.** Never write an unredacted request or response to disk, not even temporarily, not even in tests.

**R9. Tests do not touch the network.** Unit tests use recorded fixtures. Integration tests run against the local fixture app in `fixtures/ledger` only. A test that requires an external host is deleted, not skipped.

**R10. No em dashes in any output string, comment, document, or commit message.** Use commas, semicolons, or separate sentences.

## Output string style

User-facing strings are the product surface. They are written for an engineer.

- State the observation, not the label. Prefer "GET /api/invoices/42 as actor outsider returned 200 with Invoice fields" over "IDOR detected".
- Name the actor, the request, and the response in every access finding.
- Never claim intent. The tool reports what happened and what the spec said, not what the developer meant.
- Every finding ends with a file reference when source is available and a request reference when it is not.
- Suggested fixes are phrased as instructions the user could paste into a coding agent, and are always labeled as suggestions.

## Definition of done

A task is complete when all of the following pass from the repository root:

```
pnpm typecheck
pnpm lint
pnpm test
```

plus the module file's own `## Definition of Done` commands, plus:

- New behavior has a test that fails without the change.
- Any contract change is reflected in `03-CONTRACTS.md` in the same commit.
- No new dependency without approval.
- Golden files regenerated intentionally, never by blanket update.

## Git

**Branching.** Base every branch on `dev`, never on `main`. One branch per module, named `feat/m<n>-<short-slug>`, for example `feat/m3-access-checks`. Do not put the author name in the branch; commits are already attributed. Use `chore/` for tooling and setup work that adds no functionality, and `fix/` for corrections to already-merged work.

```
git checkout dev
git pull
git checkout -b feat/m3-access-checks
```

Never commit directly to `dev` or `main`. Never force-push a branch that has an open PR.

**Commits.** Conventional commits with a scope drawn from the code area, not the module number:

```
feat(access): add deny rule verdict table
fix(evidence): redact cookie headers before write
test(probe): cover endpoint identity collisions
docs(plan): record Q5 resolution
chore(repo): add workspace tooling
```

Scopes in use: `spec`, `target`, `evidence`, `access`, `behavioral`, `probe`, `diff`, `store`, `report`, `cli`, `action`, `fixtures`, `plan`, `repo`.

**Cadence.** One commit per plan task, and split further when a task produces a type definition and its consumer; types land first so the dependent commit is reviewable on its own and a bisect lands somewhere meaningful. The subject line is imperative and under seventy characters. The body explains why, not what, and names the task id on its own line:

```
feat(access): add deny rule verdict table

The 2xx-with-empty-body case has to be inconclusive rather than pass, since
an endpoint returning 200 with nothing may be refusing correctly or leaking
under a different shape. Guessing there is the false positive that costs a user.

Task: M3.4
```

Keep plan edits out of code commits, with one exception: `PROGRESS.md` is a state file and rides along in the task commit it describes. Module `Status` changes and any edit to plan content go in their own `docs(plan): ...` commit.

**Pull requests.** One PR per module branch, opened at the stage boundary, targeting `dev`. Rebase on `dev` first. Do not squash; the per-task commits are the reviewable unit and the bisect history.

PR description template:

```
**Branch:** `feat/m3-access-checks` -> `dev`
**Stage:** S3, access checks
**Module:** M3

## Overview
One paragraph on what this branch makes possible that was not possible before.

## What's changed
Grouped by area, not by commit. Tables where a set of things share a shape,
for example a verdict table or a command surface.

## Verification
The commands run and their actual output, including the module's Definition
of Done. Paste the real result, do not assert it.

## Stage exit criterion
The criterion from 05-BUILD-ORDER.md, and evidence that it was met.

## Contracts changed
none, or the list, with 03-CONTRACTS.md updated in this branch.

## Invariants touched
none, or which, and how compliance is preserved.

## Breaking changes
Called out explicitly with a warning callout, or "none".

## Open questions raised
none, or the list, with the module file updated.
```

## What to do when uncertain

Preference order: ask, cut scope, emit `inconclusive`, then implement a partial version behind a flag. Never guess at a verdict rule, a contract field, or a severity assignment. An unimplemented check is a known gap; a wrong check is a lost user.
