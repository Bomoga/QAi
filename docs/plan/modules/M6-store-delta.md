# M6: Run Store and Delta

**Status:** not started
**Owns:** `packages/core/src/store/`, `packages/core/src/diff/run-run.ts`
**Depends on:** M1, M7 (RunResult assembly)
**Depended on by:** M8
**Read alongside:** `03-CONTRACTS.md`

## Purpose

Persist runs and compare them. The delta is the feature an engineer returns for weekly, because the real pain is not the first read of a generated application, it is the fifth regeneration.

## Inputs

- Completed `RunResult` objects and their Evidence records.
- Two run identifiers to compare, or the implicit pair of latest and previous.

## Outputs

- Rows in `.qai/runs.db`.
- `RunDelta`, a structured comparison.

## Public API

```ts
export function openStore(dir: string): Store;
export interface Store {
  saveRun(result: RunResult, evidence: Evidence[]): void;
  getRun(runId: string): RunResult | null;
  listRuns(opts?: { limit?: number; target?: string }): RunSummary[];
  pruneEvidence(policy: PrunePolicy): PruneReport;
}
export function diffRuns(a: RunResult, b: RunResult): RunDelta;
```

## Implementation notes

**Storage.** SQLite via `better-sqlite3`, one file at `.qai/runs.db`, synchronous API. Schema versioned with a `schema_version` table and forward-only migrations. Evidence bodies live as files under `.qai/evidence/` with the database holding references; blobs in SQLite make the file unwieldy and the directory ungreppable.

`.qai/` is git ignored by the `init` command.

**Stable check identity is the load-bearing requirement.** `checkId` is a content hash over requirement id, rule or criterion id, actor id, resource, and action. It must not include timestamps, run ids, ordering, or response content. Without this the delta degrades into noise, so test identity stability explicitly and separately.

**RunDelta shape:**

```jsonc
{
  "from": "RUN-...", "to": "RUN-...",
  "comparable": true,
  "specChanged": false,
  "requirements": {
    "regressed": [{ "requirementId": "REQ-014", "from": "verified", "to": "failed", "checkIds": ["CHK-a91f2c"] }],
    "fixed": [], "stillFailing": [], "newlyUnverified": []
  },
  "structural": {
    "endpointsAdded": ["POST /api/export"],
    "endpointsRemoved": [],
    "fieldsAdded": [{ "entity": "Invoice", "field": "internal_notes" }],
    "accessLoosened": [{ "endpoint": "GET /api/invoices/:id", "detail": "now reachable unauthenticated" }]
  }
}
```

**Access loosening is the headline of the delta** and deserves its own detection path rather than falling out of a generic diff. It fires when an endpoint's `authRequired` moves from `true` to `false` or `"unknown"`, or when a deny-rule check moves from `pass` to `fail`. This is the exact silent-divergence case the product exists to catch.

**Spec changes affect comparability.** If `spec.hash` differs between runs, set `specChanged: true` and restrict the comparison to requirement ids present in both, listing added and removed requirement ids separately. Never present a delta across differing specs as though the application changed.

**Retention.** Default: keep the last twenty runs and the evidence for the last five. Prune on write. Report what was pruned rather than doing it silently.

## Tasks

1. **M6.1** Implement the SQLite schema, migrations, and `schema_version` handling.
2. **M6.2** Implement `saveRun` and evidence file writing with referential integrity.
3. **M6.3** Implement stable `checkId` hashing, with a dedicated test proving identity survives response changes, reordering, and re-runs.
4. **M6.4** Implement `diffRuns` for requirement verdict transitions.
5. **M6.5** Implement structural delta including the dedicated access loosening detection.
6. **M6.6** Implement comparability handling for differing spec hashes.
7. **M6.7** Implement retention and pruning with a reported summary.
8. **M6.8** Integration test: run against the defective fixture, run against the fixed fixture, assert the delta reports fixes; then reverse the order and assert it reports regressions.

## Definition of Done

```
pnpm --filter @qai/core test store delta
pnpm --filter @qai/cli exec qai diff --last 2
```

**Corrected 2026-08-16.** This command previously carried a `--` before the filter
names. pnpm forwards that `--` to the script, so vitest is invoked as
`vitest run "--" "<name>"` and reads what follows as passthrough arguments rather
than as filename filters, which runs the whole core suite and passes for the wrong
reason. Without it the filter applies. `pnpm --filter @qai/core exec vitest run <name>`
is the explicit equivalent.

- The same check against an unchanged target yields an identical `checkId` across runs.
- A deliberate regeneration of the fixture app that removes an authorization guard produces an `accessLoosened` entry.
- Comparing runs with different spec hashes sets `specChanged` and does not present removed requirements as fixed.

## Do Not

- Do not put evidence bodies in SQLite.
- Do not include volatile data in `checkId`.
- Do not silently prune. Report it.
- Do not add a query layer beyond what `diff` and `list` need. This is not an analytics store.

## Open questions

- **Half of the access loosening rule cannot be computed, and the cause has now bitten
  twice.** The rule fires when a deny rule check moves from pass to fail, which a
  RunResult can answer, or when an endpoint's `authRequired` moves away from `true`,
  which it cannot: a RunResult carries `observation.ref` and no endpoint list. The same
  gap stopped `renderText` filling its "what was built" section at M7.3, where it was
  worked around by passing the Observation through an option. Two modules needing the
  same absent data is the argument for `RunResult` carrying a summary of its own
  Observation, which is a change to `03-CONTRACTS.md` and therefore a human's call. The
  deny rule half is implemented and the fixture exercises it.
- **`endpointsAdded` is derived from the two structural lists rather than from an
  endpoint list.** An endpoint that leaves `specifiedNotObserved` has appeared, and one
  that enters `observedNotSpecified` has appeared. That is complete with respect to what a
  RunResult knows, and it catches D5 in the fixture, but an endpoint that is both
  specified and observed in both runs is invisible to it, correctly, and one that changes
  shape without changing presence is invisible too.
- **`accessLoosened[].endpoint` holds a rule id when nothing better exists.** A
  `CheckResultRecord` carries no endpoint, which M7.4 already ran into: the route appears
  only inside `detail` as prose and parsing it back out would be a guess. The entry also
  carries `requirementId` and `ruleId` so a reader is not relying on the one field.
