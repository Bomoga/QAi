# Build Order

**Stages are `S0` through `S9` and describe schedule. Modules are `M1` through `M9` and describe code ownership. They are different numbering systems and do not correspond; a stage may build part of one module or parts of several.**

Nine weeks, part time alongside other commitments. The ordering rule: something real by week four, and every week after adds a stage rather than finishing one. Each milestone has an exit criterion that is demonstrable, not merely written.

Week 9 is buffer. It is not scheduled work. If it is being spent on features, the plan has already failed.

## S0. Skeleton, week 1

Repository, workspaces, tooling, CI running typecheck, lint, and an empty test suite. The fixture app `fixtures/ledger` exists and boots with a single seeded defect.

**Exit:** `pnpm test` runs green in GitHub Actions, and `fixtures/ledger` serves an endpoint that leaks a record across owners.

Modules: none. Setup only, see `06-TESTING.md` for the fixture app requirements.

## S1. Spec and contracts, weeks 1 to 2

Contract schemas, spec loading, validation, condition grammar parsing, hashing.

**Exit:** `qai validate spec/ledger.spec.yaml` prints a structured summary and exits 0; a malformed spec exits 2 with a message naming the file, path, and reason.

Modules: M1. Depends on nothing.

## S2. Target, actors, evidence, week 2

Config resolution, actor sessions, fixture seeding and reset, evidence capture with redaction.

**Exit:** a script authenticates two distinct actors against `fixtures/ledger`, issues one request as each, and writes two redacted evidence records to `.qai/evidence/`.

Modules: M2. Depends on M1.

## S3. Access checks, weeks 3 to 4

The first real verdicts. Deny-rule verification, severity assignment, findings with evidence. Text report is minimal at this stage, a list is sufficient.

**Exit:** `qai check` against `fixtures/ledger` reports the seeded cross-owner leak as a high severity finding with request and response evidence, and exits 1. Fixing the fixture app makes it exit 0. **This is the first demonstrable version of the product.**

Modules: M3. Depends on M1, M2.

## S4. Probe and structural diff, weeks 4 to 5

Source adapters, black box fallback, Observation assembly, Spec against Observation diff.

**Exit:** `qai probe` on `fixtures/ledger` emits an Observation naming every entity and endpoint, correctly marking origin and confidence; `qai check` additionally reports one endpoint that exists but appears in no requirement.

Modules: M4. Depends on M1, M2.

## S5. Behavioral checks, weeks 5 to 6

Deterministic HTTP criteria first. Browser and fuzzy criteria second, behind an optional dependency.

**Exit:** deterministic acceptance criteria pass and fail correctly against `fixtures/ledger`; at least one fuzzy criterion runs under Playwright and is labeled model assisted in the report. Skipping Playwright installation degrades to `unverified` with reason, never to an error.

Modules: M5. Depends on M1, M2, M3 registry.

## S6. Report and CI, weeks 6 to 7

Full text report, JSON, SARIF, JUnit, exit code policy, GitHub Action, PR annotations.

**Exit:** a pull request on the fixture repository shows findings inline in the GitHub UI, sourced from SARIF, with the run's summary in the check output.

Modules: M7, and M8 excluding the `diff` subcommand, which needs M6 and lands in S7. Depends on all prior.

## S7. Store and delta, week 7

Run persistence, stable check identity across runs, run to run comparison.

**Exit:** `qai diff <runA> <runB>` reports a requirement moving from failed to verified, an endpoint newly appearing, and an access rule newly loosening, on runs taken before and after a deliberate regeneration of the fixture app.

Modules: M6. Depends on M7 assembly, M8 surface.

## S8. Corpus run, week 8

Twenty to fifty generated applications collected or produced, hand-specced at a shallow level, run through the tool. Results tabulated. This is the artifact that outlives the sprint.

**Exit:** a results table with per-application findings, a false positive rate computed by manual review of every finding, and a written summary. Any check with a false positive rate above five percent is disabled before the demo, per invariant I2.

Modules: none new. See `06-TESTING.md`.

## S9. Buffer and demo, week 9

Rehearse the sequence in `01-PRODUCT.md`. Fix only what that sequence exposes.

## Deferred beyond the sprint

- Module M9, spec extraction from prose. Build only if stages S0 through S6 complete by week 6. The corpus run matters more.
- Any UI. The engine emits JSON; a surface can be built against it later without touching `core`.
- Spec recovery from an app that never had one. Last slide, not this sprint.
