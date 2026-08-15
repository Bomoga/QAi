# Architecture

## Shape

A pure engine with thin surfaces. The engine takes structured input and produces one structured output. Every surface, CLI, CI, and any future UI, is a projection of that output. This boundary is the reason the CLI and CI work is not thrown away later.

```
spec/*.spec.yaml ──┐
                   ├──> [core] load ──> Spec
qai.config.yaml ───┘                     │
                                         v
target (URL and/or source) ──> [core] probe ──> Observation
                                         │
                       Spec + Observation │
                                         v
                             [core] diff ──> StructuralFinding[]
                                         │
                                         v
                       [core] check ──> CheckResult[] + Evidence[]
                                         │
                                         v
                       [core] assemble ──> RunResult (the public interface)
                                         │
                ┌────────────┬───────────┼───────────┬─────────────┐
                v            v           v           v             v
             text         json         sarif       junit      exit code
```

RunResult is the only thing that crosses from engine to surface. Nothing downstream of `assemble` may re-derive facts by re-reading the target.

## Packages

pnpm workspaces monorepo.

| Package | Path | Responsibility | May depend on |
|---|---|---|---|
| `@qai/core` | `packages/core` | Schemas, loading, probing, checking, diffing, run assembly, emitters, storage | Nothing in this repo |
| `@qai/cli` | `packages/cli` | Command parsing, config resolution, terminal output, process exit | `core` |
| `@qai/action` | `packages/action` | GitHub Action wrapper, annotation upload | `cli` |
| `fixtures/ledger` | `fixtures/ledger` | Deliberately defective target app for tests | Nothing |

Rules, enforced by lint config and checked in CI:

- `core` imports nothing from `cli` or `action`. If `core` needs to tell the user something, it returns data.
- `core` never calls `process.exit`, never writes to stdout or stderr outside a provided logger interface, and never reads `process.env` directly. Configuration arrives as arguments.
- `cli` contains no verification logic. If a behavior can be unit tested without a terminal, it belongs in `core`.
- `action` is a thin shell. It resolves inputs, invokes the CLI, and forwards outputs.

## Core internal layout

```
packages/core/src/
  contracts/        Zod schemas and derived types, one file per contract  [M1]
  spec/             Loading, merging, validating, hashing spec files      [M1]
  target/           Target config, actor sessions, fixtures, reset        [M2]
  probe/
    source/         Framework adapters reading the repository             [M4]
    blackbox/       HTTP crawl and inference                              [M4]
    merge.ts        Reconciles source and blackbox into one Observation   [M4]
  checks/
    access/         Access rule verification                              [M3]
    behavioral/     Acceptance criteria verification                      [M5]
    registry.ts     Check type registration and dispatch
  diff/             Spec against Observation, and run against run         [M4][M6]
  evidence/         Capture, redaction, storage, addressing               [M3]
  store/            SQLite persistence of runs and evidence               [M6]
  report/           Emitters: text, json, sarif, junit                    [M7]
  llm/              The only place a model may be called                  [M9]
  index.ts          Public API of the package
```

Bracketed tags name the owning module document. A directory has exactly one owning module. Cross-module edits in a single PR require a note in the PR description explaining why.

## Data flow constraints

- **Probe is read-only.** It issues GET-equivalent traffic and reads files. It never mutates target state. Anything that writes belongs in `target/` fixtures or in a check that has declared itself mutating.
- **Checks are the only mutators.** A check that writes must declare `mutates: true` and must run only after fixtures are seeded and inside the reset boundary.
- **Evidence is captured at the point of the network call**, not reconstructed afterward. Redaction happens on capture, before anything reaches disk.
- **Nothing reaches the report that did not come through RunResult.** No emitter re-queries the target or the store.

## Concurrency

Checks are independent and may run in parallel within an actor session, with a configurable concurrency limit defaulting to four. Mutating checks run serially, after all non-mutating checks, inside a fixture boundary. Probe runs to completion before any check begins.

## Failure posture

A check that throws produces `inconclusive` with the error recorded as evidence, and the run continues. A probe that fails partially produces a partial Observation with reduced confidence and a stated reason. Only a spec that fails validation, or a target that cannot be reached at all, aborts a run. The tool reporting less is acceptable; the tool reporting wrongly is not.
