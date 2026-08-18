# Progress

Updated: 2026-08-18T15:56:00Z
Current stage: S6, module M8, branch feat/m8-cli-ci
Next task: the S6 stage boundary

## S0. Skeleton

- [x] S0.1 repo, workspaces, tooling (commit ae53e2a)
- [x] S0.2 package skeletons for core, cli, action (commit 5c78bb9)
- [x] S0.3 CI running typecheck, lint, test (commit 14831b2)
- [x] S0.4 fixtures/ledger boots with one seeded defect (commit dd4b3f7)
- Exit criterion: `pnpm test` green in GitHub Actions, and `fixtures/ledger` serves an endpoint that leaks a record across owners
- Exit criterion, local half: verified 2026-08-15. `GET /api/invoices/INV-1001` as actor `outsider` (org-2) returned HTTP 200 with `org_id: org-1`, `total_cents`, and `notes`. Boot took 1.09s.
- Exit criterion, CI half: verified 2026-08-15. Run 31887004814 on PR #1, job "typecheck, lint, test", succeeded in 30s. Every step green: Install, Typecheck, Lint, Format, Test, Build.

### S0 summary

Built: pnpm workspace with three package skeletons and a fixture app, TypeScript
strict with `noUncheckedIndexedAccess`, ESLint with both import boundaries enforced,
Prettier, Vitest, and a CI workflow running typecheck, lint, format, test, and build.
15 tests pass, none of which touch the network.

Deferred: defects D2 through D7 and negative control N2, which need the checks that
consume them. `spec/ledger.spec.yaml`, which needs the M1 schema to validate against.
The `bin` entry for `qai` and every command, flag, and exit code, all owned by M8.

Surprises worth recording:

- typescript-eslint 8.x refuses to load against TypeScript 7. TypeScript is pinned to 6.x until that is resolved upstream.
- The model boundary and the package direction rules share one ESLint rule key, so a later config block replaces an earlier one outright instead of merging. Every scope now restates every group that applies to it, and the test reads the config ESLint resolves for a path rather than the shape of the config file.
- Prettier reflowed the entire imported plan on its first run. `docs/plan/` is now in `.prettierignore`.
- The fixture needs no runtime dependencies at all. `node:http` with Node's TypeScript stripping covers it, which is also why it boots in about a second.

## S1. Spec and contracts (M1)

- [x] M1.1 scaffold packages/core contracts directory (commit 5310e50)
- [x] M1.2 SpecSchema and sub-schemas (commit 61198b6)
- [x] M1.3 ObservationSchema, RunResultSchema, EvidenceSchema (commit 792dcc4)
- [x] M1.4 condition tokenizer and parser (commit ca8c4d9)
- [x] M1.5 YAML loading, merge, identifier derivation, diagnostics (commit 9f7bd65)
- [x] M1.6 canonicalization and hashing (commit 5b11678)
- [x] M1.7 generate schema/spec.schema.json and assert it matches (commit 29d3808)
- [x] M1.8 author fixtures/ledger/spec/ledger.spec.yaml (commit backfilled below)
- Exit criterion: `qai validate spec/ledger.spec.yaml` prints a structured summary and exits 0; a malformed spec exits 2 naming file, path, and reason
- Exit criterion status: **blocked on the CLI, behavior demonstrated**. `qai validate` belongs to M8 and lands in S6, so the command does not exist. The behavior it describes does: a structured summary and exit 0 for the fixture spec, exit 2 with file, path, and reason for a malformed one. Recorded in the M1 Open questions; needs a human decision on whether to restate the criterion or pull `qai validate` into S1.

### S1 summary

Built: all four contracts as strict Zod schemas with types derived by inference, a
condition tokenizer and parser that never evaluates, `loadSpec` with glob resolution,
multi-file merge, identifier derivation and diagnostics, canonicalization and sha256
hashing, a generated JSON Schema guarded against drift, and a 15 requirement fixture
spec covering all seven defects and both negative controls. 193 tests pass, 178 of
them in core.

Deferred: nothing from M1. The `qai validate` command is M8 and was never in scope here.

Surprises worth recording:

- `pnpm --filter @qai/core test` was green while running zero tests, because vitest resolved the repository root config whose include patterns are root relative. A Definition of Done that passes by running nothing is worse than one that fails.
- Node's type stripping refuses TypeScript parameter properties, so `scripts/validate-fixture-spec.ts` could not run while the whole suite stayed green. Vitest and tsup compile with esbuild, which accepts them. Passing tests do not prove core runs under plain `node`.
- `pnpm format` rewrote the generated JSON Schema and broke its own byte for byte drift test. Generated artifacts now sit in `.prettierignore` alongside the plan.
- Q4 needed no human decision in the end. Writing the fixture spec answered it: the proposed grammar covered every rule, and nothing wanted disjunction or ordering.

## S2. Target, actors, evidence (M2)

- [x] M2.1 TargetConfig schema and loadConfig (commit fa4f81f)
- [x] M2.2 environment variable resolution, all missing named at once (commit cf105a2)
- [x] M2.3 undici request layer with injected clock and id generator (commit 94f497e)
- [x] M2.4 evidence capture, redaction, writing (commit 0f06546)
- [x] M2.5 ActorSession for bearer, cookie, header, none (commit 0c198f5)
- [x] M2.6 seed and reset execution with the disposability gate (commit d752a75)
- [x] M2.7 startup capability report (commit backfilled below)
- [x] M2.8 `stateActor` in TargetConfig (commit backfilled below), added 2026-08-17 on the S5 branch, after S2 merged, because M5's state assertions had no configured identity to read as
- Exit criterion: a script authenticates two distinct actors against `fixtures/ledger`, issues one request as each, and writes two redacted evidence records to `.qai/evidence/`
- Exit criterion: **met**, verified 2026-08-16 via `packages/core/scripts/capture-two-actors.ts` against a live ledger. Two actors resolved, one request each, four files written, `request.headers.authorization` and `response.body.notes` redacted in both. No token and no sensitive field reached disk; `INV-1001` and `org-1` were retained.

### S2 summary

Built: `qai.config.yaml` resolution, credential resolution from named environment
variables, an undici request layer with injected clock and ids, evidence capture with
redaction at the point of capture, actor sessions for all four auth kinds, the fixture
disposability gate, and the startup capability report. 343 tests pass, 329 in core.

Deferred: nothing from M2. `createTargetContext` is synchronous where the module
declares a Promise, which is recorded rather than papered over.

Surprises worth recording:

- The stage demonstration found two faults the unit tests had passed over. Evidence recorded the caller's headers rather than the ones actually sent, so records showed no authorization header at all. And `createTargetContext` built a writer it never handed to the sessions, so a run printed evidence ids and bodyRef paths for files that were never written. Both looked correct in isolation and only failed when run end to end.
- Writing the M2.5 session tests found a leak in M2.4: a target echoing a credential back in its response body had it written unredacted, because the always-redacted names were matched in header position only.
- With `shell: true` a kill does not reach the command, reliably not on Windows, so a timeout waited out the full command. One test held the suite at 11.3s before that was fixed.
- The proposed config has no way to supply `actor.org_id`, which the condition grammar compares against. Added as `actors[].attributes` and flagged.

## S3. Access checks (M3)

- [x] M3.1 CheckResult helpers and the check registry (commit 9e91220)
- [x] M3.2 rule to plan expansion (commit 5eaaaaf)
- [x] M3.3 condition AST evaluation against a candidate record (commit 6d7c324)
- [x] M3.4 deny verdict table (commit 56a9cf3)
- [x] M3.5 allow rule verification and the check runner (commit 2545c2b)
- [x] M3.6 list handling per Q5 (commit d73bd1e)
- [x] M3.7 mutating rules behind the disposability gate (commit bdcf8c1)
- [x] M3.8 severity assignment and finding text (commit 8ac6c38)
- [x] M3.9 integration test over D1, D2, D3, N1, N2 (commit backfilled below)
- Exit criterion: `qai check` against `fixtures/ledger` reports the seeded cross-owner leak as a high severity finding with request and response evidence and exits 1; fixing the fixture app makes it exit 0
- Known blockers on the criterion, same shape as S1: `qai check` is M8 and lands in S6, and the module Definition of Done names `pnpm --filter @qai/cli exec qai check`. The fixture implemented only D1; D2 and D3 were added at M3.9.
- Exit criterion: **behavior met, command still M8**. Verified 2026-08-16 via `packages/core/scripts/check-ledger.ts` against a live ledger. Defective: 3 fail, 4 pass, exit 1, with the cross-owner leak reported high severity carrying request and response evidence. Fixed: 7 pass, 0 fail, exit 0. The same seven checks run in both, so the runs compare.
- Re-verified 2026-08-17 at M5.14, after the fixture spec gained an actor and AR-011-01 was pointed at a resource that has routes. Defective: 8 planned and 0 unplannable, 3 fail, 5 pass, exit 1. Fixed: 8 pass, 0 fail, exit 0. The three failures are the same three defects; the extra passing check is the forged credential being refused, which was unplannable when the criterion was first verified. The 2026-08-16 numbers above are left as they were recorded rather than edited, since they describe the run that actually happened that day.

### S3 summary

Built: check identity and the registry, rule to plan expansion, three-valued condition
evaluation, the deny verdict table, allow verification, list scoping per Q5, the
mutating interlock, severity and finding text, and an integration run over the fixture.
Defects D2 and D3 were added to `fixtures/ledger`. 549 tests pass, 511 in core.

Deferred: nothing from M3. D4 through D7 stay with the stages that consume them.

Surprises worth recording:

- Attribute lookup read inherited properties, so a condition naming `Invoice.constructor` resolved to the `Object` constructor and compared as data. A condition should read the target, never the runtime.
- `process.exit` with undici's keep-alive sockets open trips a libuv assertion on Windows and reports a crash code instead of the exit code the run reached. For a tool whose exit code is the product, that is worse than the crash. The pool is closed and `process.exitCode` set instead. `HttpClient` has no teardown method, which M8 will want.
- A default parameter swallows an explicitly passed `undefined`, so a test meant to exercise an absent argument silently exercised the present one.
- The integration test cannot live in either package without breaking the architecture rule that both depend on nothing here. It sits at the repository root.

## S4. Probe and structural diff (M4)

- [x] M4.1 probe interfaces and adapter registration (commit 6795e64)
- [x] M4.2 Next.js App Router adapter (commit f14f1cd)
- [x] M4.3 Express adapter (commit d1cbcbf)
- [x] M4.4 Prisma schema adapter, read textually by decision (commit backfilled below)
- [x] M4.5 black box crawler, read-only, budgeted (commit 9adc558)
- [x] M4.6 endpoint identity normalization (commit 5117842)
- [x] M4.7 source and black box merge with confidence (commit b82ae56)
- [x] M4.8 diffSpecObservation and severity rules (commit 9298e61)
- [x] M4.9 integration test over D5 and D6 (commits 7d8ea01 and 8e717f7)
- Exit criterion: `qai probe` emits an Observation naming every entity and endpoint with correct origin and confidence; `qai check` additionally reports one endpoint that exists but appears in no requirement
- **Conflict raised at stage start, decided 2026-08-16: black box origin for the ledger.** M4's adapters target Next.js, Express, and Prisma; `fixtures/ledger` is a hand-written `node:http` server with no ORM, chosen at S0 so the fixture needed no runtime dependencies. The Definition of Done line "every entity and endpoint in fixtures/ledger appears in the Observation with correct origin" therefore holds with `origin: blackbox` and reduced confidence, not `origin: source`. Adapters are built and tested against synthetic source trees. Rejected: adding a `node:http` adapter, which is outside Q1's list and covers a framework no real user has; and rewriting the fixture on Express, which adds a runtime dependency and risks the three second boot requirement in 06-TESTING.md. The DoD line should be restated to say black box for this fixture.
- D5, the undeclared debug endpoint, was added to the ledger at M4.9, the same way D2 and D3 were added during S3.
- Merged into `dev` as `11e987a`, PR #6, 2026-08-17. Not squashed.
- Exit criterion: **behavior met, command still M8**. Verified 2026-08-16 via `packages/core/scripts/probe-ledger.ts` against a live ledger, both directions. Defects on: 4 endpoints, every one `origin: blackbox` and `confidence: low` with one evidence id each, `GET /api/debug/state` reported in `observedNotSpecified` at medium, `AuditLog` in `specifiedNotObserved`, exit 1. D5 off: 3 endpoints, no medium finding, exit 0. The source adapters cannot be demonstrated against this fixture and are covered by their own tests, per the decision recorded at the top of this section.

### S4 summary

Built: the probe interfaces and adapter registry, the Next.js App Router adapter, the
Express adapter with cross-file mount resolution, the Prisma schema adapter, the
read-only black box crawler, endpoint identity normalization, the source and black box
merge with its confidence table, `probe()` itself, `diffSpecObservation` with the
module's severity rules, D5 in the fixture, and an integration run over D5 and D6.
850 tests pass, 37 files.

Deferred: nothing from M4. M4.4 stopped the loop on the `@prisma/internals` dependency
and was resolved in the same session: read the schema textually, add no dependency, and
correct the plan. The fixture is unaffected either way, since it has no `schema.prisma`,
so `Organization`, `User`, and `AuditLog` are still reported as specified and not
observed when probing the ledger.

Surprises worth recording:

- The stage demonstration found a false finding four hundred unit tests had passed over,
  the same pattern as S2. The ledger returns rows under an `invoices` key, so the crawler
  recorded the envelope as the response shape and the diff then reported every declared
  Invoice field as missing. M3.6 had already solved that shape for lists; the crawler had
  not. Running the thing end to end keeps being worth more than another unit test.
- The demonstration also showed `mode: hybrid` for a run whose source half read nothing,
  because the config points `sourceRoot` at a fixture no adapter recognizes. A source root
  that nothing recognized is not a source reading.
- Four probe tests wrote a synthetic Express file with no `import express`, so detection
  correctly said no and the source half never ran. Three of them passed anyway. A fixture
  that does not trip detection tests nothing about the adapter.
- The M4 Definition of Done command `pnpm --filter @qai/core test -- probe diff` filtered
  nothing, because pnpm forwards the `--` to the script and vitest reads what follows as
  passthrough rather than as filename filters. Same family as the M1.2 trap. Every module
  file carried the same wrong form and all of them are corrected.
- Endpoint identity turned out to be the highest stakes small function in the module.
  M6 diffs runs on that string, so widening what counts as a record identifier renames
  every endpoint in every stored run.

## S5. Behavioral checks (M5)

- [x] M5.1 assertion vocabulary parser and validation warnings (commit 2ecf6f2)
- [x] M5.2 deterministic HTTP runner with evidence capture (commits 45fc681, 0a75029, 16c8501)
- [x] M5.9 the `when` vocabulary and planBehavioralChecks (commits 4fd00c1 and 15ddee1), added by decision, out of order because M5.8 needs it
- [x] M5.3 persisted state assertions via follow-up reads (commit fe2cc2a)
- [x] M5.4 the Judge interface in llm/ (commits ecc5057 and 8191700)
- [x] M5.5 browser capture, lazy Playwright, selector policy (commit c2e1c02)
- [x] M5.6 verdict mapping, one test per row (commit 7774ab4)
- [x] M5.8-pre1 D4 in fixtures/ledger, the switch M5.8 has to toggle (commit ccd7892)
- [x] M5.8-pre2 the fixture spec rewritten into both vocabularies (commits 5dc6c8b and bc93686)
- [x] M5.7 graceful degradation when Playwright is absent (commits e086e1a, af65b47, c2fd391)
- [x] M5.8 integration test over D4 (commits 7505312, 2c86e39, 03dc6fa)
- [x] M5.10 the actor reference and every row assertion forms (commits d70cb04, 7e231ab, 079a08f), approved 2026-08-17 after the stage was otherwise complete
- [x] M5.11 the before and after state form (commits 83b86ca, 0d26083, f47327e, ad9ed65), approved 2026-08-17
- [x] M5.12 the cross-request status comparison (commits 049e8b3, d986c5e, 06eb606), approved 2026-08-17
- [x] M5.12b the endpoint sweep (commits 0e126b0, 284ed8c, c93c02b), approved 2026-08-17
- [x] M5.12c the actor axis on the sweep (commits adcff2a, 8199d07, aa954c5), approved 2026-08-17
- [x] M5.13 the impostor actor, closing the last criterion in the fixture spec (commits 24bd43b and 3389dd9), approved 2026-08-17
- [x] M5.14 AR-011-01 pointed at a resource that has routes, so the last unplannable access rule became a check (commits 1f6d690 and 53acdcd)
- [x] M5.15 the S3 script prints coverage gaps with their reasons instead of counting them (commits 5ccbfd5 and 4b68276)
- [x] M5.16 one collector for every coverage gap, so no caller has to remember three side channels (commit backfilled below)
- Exit criterion, as restated at the boundary on 2026-08-17: deterministic acceptance criteria pass and fail correctly against `fixtures/ledger`; the fuzzy path is built and bounded by invariant I1; skipping Playwright degrades to `unverified` with a reason, never to an error
- **Exit criterion restated, by the human's decision at the boundary.** It asked for a fuzzy criterion to run under Playwright and be labeled model assisted. Playwright is installable; no model SDK is approved, so the only judge available is a scripted one, and running it would have printed "model assisted" over a run no model touched. Options put up were restating the criterion, approving a model SDK, installing Playwright with a scripted judge labeled as scripted, and opening the PR partially met. The choice was to restate. `05-BUILD-ORDER.md` and the M5 Open questions both say so.
- **Screenshots ruled on at the same time: opt in stands.** The module said a fuzzy check captures one, rule R8 says never write an unredacted response to disk, and an image cannot be redacted. The module was corrected rather than the rule.
- Pull request #7 opened into `dev` on 2026-08-17, 22 commits. Merged as `556d41c`, not squashed.
- Follow-up pull request #8, `fix/ar-011-01-resource`, carried the work that landed after #7 merged: M5.14 through M5.16. Six commits, merged as `0aed8f9`, not squashed.
- Both merges happened mid-session and both deleted their branch, which a later push resurrected each time. Work that lands after a stage pull request merges belongs on a new branch cut from `dev`, not on the branch that was just merged. Noticed the first time only because `git push` reported a new branch.
- Exit criterion: **met as restated**, verified 2026-08-17 via `packages/core/scripts/check-behavior-ledger.ts` against a live ledger, both directions, and re-run after M5.10 changed the counts. Defective: 15 criteria planned, 7 pass, 6 fail, 2 unverified, exit 1, with D4 reported at medium severity carrying request evidence. Repaired: 13 pass, 0 fail, 2 unverified, exit 0. The same 15 checks run in both, so the runs compare. With Playwright absent, `AC-005-02` is unverified with reason `capability-unavailable` and the install line, and the exit code is unaffected in both directions. Re-run after M5.13, which closed the last criterion: 16 criteria planned and 0 not, giving 8 pass, 6 fail, 2 unverified, exit 1 defective, and 14 pass, 0 fail, 2 unverified, exit 0 repaired. The two unverified are the fuzzy criterion with no Playwright and the audit log the application never built. Authoring warnings went from 1 to 0 when M5.10 closed the last unexpressible `then`. M5.11 did not move the counts, since AC-003-01 was already failing on its status clause; what changed is what the finding says, which now reads `status 200, Invoice INV-1001 changed across the action: total_cents`. `qai check` is M8 and lands in S6, so the command itself does not exist yet.
- **Raised at M5.1 and needing a decision before M5.8: only 4 of the 14 deterministic criteria in `fixtures/ledger/spec/ledger.spec.yaml` can be expressed in the assertion vocabulary.** The fixture spec was authored at M1.8 in prose, before the vocabulary existed. Six of the ten are straightforwardly rewritable, for example "the body reports status ok" into `body.status equals "ok"` and "no response body contains a token field" into `body omits field User.token`. Four are genuinely outside the table: the two "the invoice is unchanged" clauses need before and after state, "every returned invoice has org_id equal to the caller organization" is a per-row comparison against an actor attribute, and AC-013-01 compares the status of two different requests. The plan's own instruction covers this, warn and suggest a rewrite or `mode: fuzzy`, so the rewrite belongs with M5.8. Nothing pins the fixture spec hash as a literal, so rewriting the clauses is safe; `fixture-spec.test.ts` only asserts the hash is stable across loads.

### S5 summary

Built: the assertion vocabulary and its authoring warnings, the deterministic HTTP
runner, the `when` request vocabulary and `planBehavioralChecks`, persisted state
assertions through follow-up reads, the judge boundary proved by type sweep, page capture
with a lazily imported Playwright, the fuzzy verdict mapping that makes invariant I1
executable, the batch runner that degrades to unverified when no browser is there, D4 in
the fixture, the fixture spec rewritten into both vocabularies, and an integration run
over the live ledger, and five assertion forms added afterwards at M5.10 through M5.12c,
with the state actor field M2.8 added to carry them. 1137 tests pass across 47 files.

Deferred: a fuzzy criterion judged by a real model, which needs a model SDK nobody has
approved, and a run against a real browser, which needs Playwright installed. Both are
recorded in the M5 Open questions rather than papered over. The fixture spec has no
coverage gap left at all: all 16 criteria plan, and every one narrowed at M5.8-pre2 says
what it originally said.

Surprises worth recording:

- The stage found its own blocker before the demonstration did. `planBehavioralChecks`
  refused every fuzzy criterion, which made the exit criterion unreachable by
  construction: a criterion that never plans can never run under a browser. Four tasks had
  passed over it because each one tested its own half.
- The fixture spec was the real work. Ten of fourteen criteria could not be read at all,
  and rewriting them turned up something worth more than the rewrite: what the tool can
  check is narrower than what an author can say. Two of the gaps that argument produced
  were closed the same day at M5.10, which is the argument working.
- Verifying by breaking kept paying. Removing the capability branch left the run working
  and only the reason wrong, which is exactly the failure a passing suite hides. One test
  caught it.
- The demonstration disagreed with nothing this time, which is itself worth noting after
  S2 and S4 both found faults there. The integration test was written to pin whole verdict
  maps in both directions first, and the script found no eighth thing.

## S6. Report and CI (M7, M8)

- [x] M7.1 assembleRun, the verdict rollup, and the closed reason set (commit 3683191)
- [x] M7.2 renderJson with sorted, stable output (commit c55759a)
- [x] M7.3 renderText in the section order the module gives (commit 2c7a182)
- [x] M7.4 renderSarif, validated against the 2.1.0 schema (commit f406813)
- [x] M7.5 renderJunit, inconclusive mapping to skipped (commit b0784a4)
- [x] M7.6 computeExitCode with --fail-on and --fail-on-unverified (commit 66c9cc2)
- [x] M7.7 golden RunResult files for both fixture configurations (capture command 14bb703,
  goldens and render tests 9b06153, module marked complete 6e0c3d0)
- [x] M8.1 scaffold packages/cli with Commander, the qai binary, and the reporter
  (commits a411409 and 352be6e)
- [x] M8.2 configuration precedence and --verbose resolved config output
  (commits ad295c4 and 4345562)
- [x] M8.3 init with scaffolding and the .gitignore entry (commit 4dd2495)
- [x] M8.4 validate (commits 44aa7c7 and 55bc6f5)
- [x] M8.5 check, the startup capability report, and exit code application
  (commits fcf8d2f and 13cd02c)
- [~] M8.6 probe done (commits f93e5f8 and 4bbab25); report is blocked on M6 run
  persistence, recorded in the M8 open questions; diff was already S7
- [x] M8.7 error presentation for exit codes 2 and 3 (commit backfilled below)
- [ ] M8.7 error presentation for exit codes 2 and 3
- [ ] M8.8 the GitHub Action, with SARIF upload and outputs
- [ ] M8.9 end to end test of init, validate, and check against fixtures/ledger
- Exit criterion: a pull request on the fixture repository shows findings inline in the GitHub UI, sourced from SARIF, with the run's summary in the check output
- Started 2026-08-18 on the human's instruction, after PRs #7, #8 and #9 were merged. Branch `feat/m7-report`, cut from `dev` at `5d60d9f`.
- M7 finished 2026-08-18 and opened as PR #10, eleven commits, unmerged. `feat/m8-cli-ci` is cut from `feat/m7-report` rather than from `dev`, because M8 imports emitters that do not exist on `dev` until #10 merges. Rebase onto `dev` once it does.

## S7. Store and delta (M6)

- [ ] not started

## S8. Corpus run

- [ ] not started

## S9. Buffer and demo

- [ ] not started

## Notes carried forward

- M8.9 drives `main` rather than spawning the binary. Spawning would test that pnpm linked
  a bin, which is true or false regardless of anything in this repository, and would make
  every assertion about a subprocess's stdout rather than about the command. `main` takes
  its streams, environment, and working directory as arguments for exactly this reason.
- M8.9 pins both directions, exit 1 with the defects on and 0 with them off, so a command
  that always failed or always passed breaks one of them. Proved by breaking it: forcing
  the exit code to 0 failed three tests including that one.
- M8.9: the verdict counts reached through the command match the M7.7 goldens exactly, 15
  requirements as 7, 6, and 2 and 24 checks as 13, 9, and 2. The goldens were captured by
  a script, so this is what says the command and the script agree rather than each being
  separately plausible.
- M8.9: each test starts its own ledger on an ephemeral port and writes a config naming
  it, so nothing depends on a server somebody left running. That is the hazard that cost
  this session an hour at M7.7, turned into a test.
- M8.9: the probe test asserts D5 both ways. A probe that reported the debug endpoint
  whatever the switch said would be describing something other than the application in
  front of it, and one that never reported it would pass just as quietly.
- M8 is complete. Every command in the module's table exists except `report <runId>`,
  which is blocked on M6 run persistence and recorded in the module's open questions, and
  `diff`, which the module already assigns to S7.

- M8.8: the Action runs `qai check` once, never twice. A second run to collect counts in
  another format would double the traffic against the target and could disagree with the
  first, since a run writes to whatever it is allowed to write to. Every output comes out
  of the SARIF, which carries coverage, the unverified count, and the model assisted count
  in `runs[0].properties` because M7.4 put them there for exactly this caller.
- M8.8: the check step captures the exit code instead of letting it end the step. A run
  that found something still has a report worth uploading, and failing there would skip
  the upload and leave the findings invisible on the pull request. The workflow fails at
  the end with the code the CLI returned, applied and never recomputed from the counts.
- M8.8: output computation is TypeScript and orchestration is YAML, because a decision in
  YAML is a decision nobody can test. Thirteen tests cover the computation, and one of
  them asserts that the set of names written matches the set declared in `action.yml`: an
  output declared with nothing writing it comes back as an empty string, which a workflow
  reads as zero findings.
- M8.8: an unreadable SARIF throws rather than reporting zero. An Action that said no
  findings because it could not read the file is the quietest possible failure.
- M8.8 verified against a real report, not a hand-built one: the fixture's defective run
  gives 15 findings, 3 error, 7 warning, 5 note, coverage 87%, 2 unverified, 1 model
  assisted, which matches the M7.7 golden exactly.
- M8.8: `upload-sarif` is an input although it mirrors no flag. Uploading needs code
  scanning enabled on the repository, and a workflow that only wants the outputs should
  not fail on that. Every other input mirrors a global flag, since a flag and an input
  that meant different things would be two surfaces to learn.
- M8.8: the repository now has a README, which it did not before. The module asks for the
  three line workflow snippet to live there, and there was nowhere to put it.
- M8.8: `packages/action` got its own vitest config, the third time the M1.2 trap has
  come up. Without one the package's Definition of Done command passes by running nothing.

- M8.7: there were nine error sites each formatting its own shape. A user learns the shape
  of a tool's errors the way they learn its output, by seeing the same thing twice, and
  the only way that holds across nine sites is if none of them formats its own. They all
  go through `present` now, which takes the summary, the where, the reason, and one
  suggested fix, and returns the exit code the error carries.
- M8.7: the code travels with the error rather than being chosen by the caller. That is
  what stops a new error path picking 1, which belongs to a completed run with findings.
- M8.7: a stack trace appears only under `--verbose`. A trace through this tool's
  internals tells a user nothing about their spec, and printing one by default trains
  people to skip error output. Proved by breaking it: printing it unconditionally failed
  exactly the test written for it.
- M8.7: `main` now catches anything that is not a Commander error and presents it as exit
  3, which 03-CONTRACTS.md gives to a fatal runtime error with the run aborted. Without
  it the binary ended in a raw trace and whatever code Node chose, which for a tool whose
  exit code is the product is worse than the crash.
- M8.7: a spec diagnostic becomes one error per problem rather than a summary and a list,
  so a spec with four mistakes costs one run instead of four. The suggestion names the
  path rather than guessing the fix, since a tool that guessed what somebody meant by a
  malformed requirement would be wrong often enough to be worse than saying where to look.
- M8.7: the Definition of Done sentence, that a malformed spec exits 2 naming file, path,
  reason, and a suggested fix with no stack trace, is five assertions and is tested as
  five, including the negative.
- M8.7 escape trap, fourth time this session and the most expensive yet: the Bash tool
  strips one level of backslash before Python sees a heredoc, so `\n` in a pattern
  arrives as a real newline and never matches TypeScript source containing a literal
  backslash-n. An earlier patch silently wrote real newlines inside template literals
  because of it. Two rules that work: build the escape from `chr(92)`, and normalize CRLF
  before matching, since Prettier writes CRLF here and multi-line LF patterns never match.

- M8.6 is half done and the half that is missing is blocked, not skipped. `probe` is
  implemented. `report <runId>` re-renders a stored run and nothing stores one:
  `packages/core/src/store/` does not exist and run persistence is M6. The module header
  says M6 is "required only by the `diff` subcommand", which is not true of `report`
  either, and that is a plan error rather than a coding decision. Three ways out are in
  the M8 open questions; none was taken, because the persistence layout belongs to M6 and
  inventing one here would leave that module adopting somebody else's choice.
- M8.6: `probe` loads the spec and still does not give it to the probe. M4 is deliberate
  that an Observation shaped by the spec cannot support a finding that the two disagree.
  The spec is read for its `sensitive: true` fields, which redaction needs before any
  response is written, per rule R8.
- M8.6: probing with no spec at all is allowed, since the point of the command is
  answering what is in here before a spec exists. It warns, because redaction then covers
  only credentials and the configured patterns. Two tests, one each way, so the warning
  cannot pass by always firing.
- M8.6: `probe` can never exit 1. It produces no findings, so the failure threshold has
  nothing to act on, and 1 would tell CI an application has findings from a command that
  judged nothing. Swept across every refusal path in one test.
- M8.6: `--format sarif` and `--format junit` on a probe say so rather than emitting an
  empty document. An empty findings document reports a clean application, where the truth
  is an unjudged one.
- M8.6 test bug caught while writing it: the first version of the redaction warning test
  asserted a tautology, `!x || x`, which passes whatever happens. Replaced with a
  capturing reporter and a negative case. Worth remembering that a test written to make a
  suite green is easier to write than one that can fail.

- M8.5: `qai check` runs end to end against the real fixture and the numbers match the
  M7.7 goldens exactly. Defects on: 15 requirements, 7 verified, 6 failed, 2 unverified,
  24 checks, 13 pass, 9 fail, 2 inconclusive, exit 1. Defects off: 13 verified, 0 failed,
  22 pass, exit 0. That is the M8 Definition of Done met, and the first time the emitters
  have been driven by the command rather than by a script.
- M8.5: the M7 Definition of Done command finally runs. `qai check --format sarif` writes
  a conforming document with 15 results across all three rules and levels error, warning,
  and note. Every stage since S1 has carried a Definition of Done line that could not run
  until the CLI existed; this is where they stop being deferred.
- M8.5: the M8 Definition of Done names `fixtures/ledger/qai.config.yaml`, which does not
  exist. The target configuration is at the repository root and `fixtures/ledger` holds
  the application and its spec. The criterion was demonstrated against the real path and
  both halves hold, so the written path is what is wrong. Recorded in the M8 open
  questions rather than corrected unilaterally.
- M8.5: exit 3 is established by one unauthenticated request to the base URL before any
  other work, so an unreachable target is reported as one rather than as a report full of
  inconclusive checks. Whether the root answers 200 or 401 is a fact about the
  application; whether anything answered at all is what that request asks. Proved by
  breaking it: returning 1 there failed the two tests that pin the refusal codes.
- M8.5: nothing that failed to start may return 1. 03-CONTRACTS.md gives 1 to a completed
  run with findings, so a missing config, an unloadable spec, an absent baseUrl, and an
  unreachable target are 2, 2, 2, and 3. A test sweeps all of them together rather than
  asserting one at a time, since the risk is one drifting onto 1 later.
- M8.5: the capability report prints before any work and states the available half as
  well as the gaps. `createTargetContext` already phrases every gap as what will not be
  checked and the contract calls those lines something a surface prints verbatim, so they
  are printed verbatim. The browser line is added here, since Playwright detection lives
  in M5 and the context does not know about it.
- M8.5: the M7.3 deviation pays off exactly where it was meant to. `check` holds the
  Observation, so it passes it into `renderText` and the report's second section shows 4
  endpoints by origin and confidence instead of saying no probe was recorded. Without it
  the section was blank in a real run, which is how the gap became visible.
- M8.5: terminal detection is two answers, not one. Progress goes to stderr and the
  report to stdout, and piping one does not pipe the other, so `stderrTty` and
  `stdoutTty` travel separately from the binary. Nothing below the binary sniffs.
- M8.5: `pnpm --filter @qai/cli exec qai ...` does not resolve until `pnpm install` has
  run since the `bin` entry was added. The workspace link is created at install time, so
  adding a bin to a package.json is not enough on its own.

- M8.4: an error exits 2 and a warning does not. `diagnostics.ts` already says the two
  are different things, an error meaning no Spec could be produced and a warning meaning
  the spec loaded and something is worth saying out loud. Failing the command over a
  warning would teach people to stop reading warnings, which costs more than the warning
  was worth. Proved by breaking it: treating every diagnostic as an error failed the two
  tests written for that split.
- M8.4: nothing to validate is a failure. A clean summary over zero matched files is the
  vacuous green this repository keeps catching, so a glob that matched nothing exits 2.
- M8.4: two real path bugs, both found by running the command rather than by reading it.
  `readAndValidate` joined cwd and file with a slash, which is wrong for an absolute path
  and on Windows produced a path with two drive letters. And `resolveFiles` handed
  backslashes to fast-glob, which treats them as escape characters, so a Windows path
  matched nothing and the loader said no spec files matched the one that was named. Both
  fixed in M1's file, both proved by reverting them one at a time.
- M8.4: `LoadedSpec` now reports `files`, the paths actually read. A caller hands in
  patterns and gets one merged Spec, so nothing downstream could say where it came from.
  `RunResult.spec.files` is exactly that list and M8.5 needs it, and `validate` has to
  name what it read or a user cannot tell a passing spec from a glob that matched the
  wrong directory. A cross-module edit into M1's file.
- M8.4: `--format` is reported as inapplicable rather than ignored. The emitters project
  a RunResult and a spec summary is not one. A silently ignored flag is a user believing
  they configured something they did not, which is the same rule the program applies to
  an unknown option.
- M8.4 test bug worth remembering: two spec files in one glob cannot both declare
  REQ-001. The loader calls that a conflicting redefinition, correctly, and the test that
  wrote the same spec twice was asserting the wrong thing about the glob.
- M8.4 verified against the real fixture spec, and the numbers match the M1.8 record
  exactly: 4 actors, 4 entities, 15 requirements, 8 access rules, 16 criteria of which 1
  is model assisted, 4 parsed conditions, and 1 warning for REQ-007 having no checks.

- M8.3: `init` never overwrites, and that is invariant I7 landing in the one command that
  writes. An existing file is left alone and named, and running init twice is a success
  rather than an error: refusing would be hostile to exactly the user who is unsure
  whether they ran it already. Proved by breaking it: removing the existence check failed
  three tests.
- M8.3, the tests that are actually worth having: the generated config is run through
  `loadConfig` and the generated spec through `loadSpec`, and the spec test asserts zero
  diagnostics rather than merely no error. A starter that produces authoring warnings
  makes a user's first `qai validate` red over a file they did not write. That is why the
  template's actors are all referenced by an access rule and every criterion is written
  in the request and assertion vocabularies.
- M8.3: the `.gitignore` append adds a newline first when the existing file does not end
  with one. Without it the entry is glued to the last line as `dist/.qai/`, which ignores
  neither. Found by writing the test before the code.
- M8.3: the starter config names environment variables and never holds a value. M2.1
  rejects a literal at load time, and a template that taught the habit would be worse
  than the check that catches it. A test asserts no bare `token:` appears.
- M8.3 surprise from registering the first subcommand: Commander sees a program with
  subcommands and no root action, decides the user must have meant to name one, and
  prints help and throws before anything else runs. That silently preempted
  `qai --verbose` and turned three passing tests red. The root now has an explicit no-op
  action and `main` decides what a bare invocation does.
- M8.3 behavior change, deliberate: a bare `qai` now prints help instead of succeeding
  silently. Succeeding silently reads as though something ran. `qai --verbose` still
  prints the resolved configuration, since that is what the flag is for.
- M8.3: commands record an exit code in an outcome object rather than exiting, and `main`
  reads it. Commander action handlers return nothing useful, and keeping the single place
  that ends the process in the binary is the same rule that keeps `core` from exiting.

- M8.2: the config file layer needed a schema change. `TargetConfigSchema` is strict, so
  before this a project writing `format: sarif` into `qai.config.yaml` got a load error,
  and the third layer of the precedence the module states could not exist. `defaults` is
  a cross-module edit into M2's file, same shape as M3.2 and M2.8.
- M8.2: every resolved setting carries the layer it came from, and `--verbose` prints it.
  The value alone does not answer the question a confused user is asking. Somebody
  staring at a `sarif` report they did not ask for needs to be told it came from
  `QAI_FORMAT` in their shell profile, or the value sends them to the wrong file.
- M8.2 proved by breaking it: swapping the flag and environment branches in `pick` failed
  two tests, including the one that sets all four layers at once. Single-layer tests are
  the trap here, since a resolver that reads only the layer a test supplies passes every
  one of them and still gets the order wrong.
- M8.2: an environment value outside its closed set is an error, not a fallback. Rule R2.
  A bad `QAI_FORMAT` that quietly became text would hand somebody a report in a shape
  their pipeline cannot read with nothing anywhere saying why.
- M8.2: an empty variable counts as unset, and `QAI_FAIL_ON_UNVERIFIED=0` counts as off.
  An empty variable is how a shell spells unset by accident, and reading either as on is
  the surprise that costs a red build nobody can explain.
- M8.2: an absent switch is undefined, never false. Commander leaves it undefined, and
  reading that as an explicit false would make the flag layer always win and silence the
  two layers beneath it. There is a test for exactly that.
- M8.2: a missing config file is not an error while resolving settings, but a file that
  exists and will not load is. `loadConfig` reports both identically as "could not read",
  so the CLI checks existence first. Before `qai init` has run there is no file and
  `qai --verbose` should still say what it resolved; reading a malformed config as absent
  would run against built-in defaults and report on the wrong target.
- M8.2: `--verbose` goes to stderr, like all diagnostics. Proved by breaking it: pointing
  it at stdout failed three tests. A user running `qai check --format json --verbose | jq`
  has to get a clean document.
- M8.2 found by running the binary, not by the suite: `fail-on-unverified` is exactly
  eighteen characters, so a column of eighteen ran the name straight into its value. The
  suite only ever asserted that the words appear.

- M8 is branched from `feat/m7-report`, not from `dev`, and that is a deliberate
  deviation from the one rule in 04-CONVENTIONS.md that says base every branch on `dev`.
  M8's CLI imports `renderSarif`, `renderJunit`, and `computeExitCode`, none of which
  exist on `dev` until PR #10 merges, and merging that PR is not the agent's call. PR #2
  stacked on the S0 branch for the same reason, and since S1 removed the `pull_request`
  branch filter a stacked PR still gets CI. Rebase M8 onto `dev` once #10 merges.
- M8.1: `Reporter` did not exist. 03-CONTRACTS.md lists it among the shared runtime types
  with M7 as its owner, and M7 completed without building it, so this is a cross-module
  edit into `packages/core/src/report/` from the M8 branch. Same shape as M3.2 adding
  `resources` to M2's file and M2.8 adding `stateActor`.
- M8.1, stated plainly so nobody assumes otherwise: nothing in `core` accepts a
  `Reporter` yet. `probe`, `runAccessChecks`, and `runBehavioralChecks` report no progress
  at all, and threading one through them changes signatures owned by M4 and M5. Declaring
  the port is what makes that a mechanical follow-up instead of a design question.
- M8.1: the reporter writes every level to stderr and never to stdout, because stdout
  carries the report and nothing else so `qai check --format json | jq` works. Proved by
  breaking it: pointing the writer at stdout failed four tests, led by the one written
  for exactly that.
- M8.1: a bad invocation exits 2, not 1. Commander's own default for a usage error is 1,
  and 1 is spoken for by 03-CONTRACTS.md as a run that completed and found something at
  or above the threshold. A misspelled flag exiting 1 would tell CI the application has
  findings, which is the worst lie available here.
- M8.1: `exitOverride` makes Commander throw for `--help` and `--version` too, after the
  output has already printed. The first run of the built binary ended `qai --help` in a
  stack trace because of it. `main` now treats those three Commander codes as a clean 0.
  Found by running the binary, not by reading the suite.
- M8.1: `packages/cli/vitest.config.ts` exists for the M1.2 trap, which that note
  predicted would arrive here. Without it vitest walks to the root config, whose include
  patterns are relative to the repository root, matches nothing, and exits 0. M8's
  Definition of Done runs `pnpm --filter @qai/cli test`, so it would have passed by
  running nothing.
- M8.1: the CLI dts build reads `@qai/core` from its `dist`, not its source, so adding an
  export to core and building only the CLI fails with the export missing. Build core
  first, or run `pnpm build` at the root, which builds in dependency order.
- M8.1: `bin/qai.js` imports `process` from `node:process` rather than taking the global,
  so the file needs no lint environment of its own. ESLint flagged the global, and the
  import is a smaller fix than a config carve out.
- M8.1: `picocolors` is now a dependency of `@qai/cli` as well as `@qai/core`. pnpm's
  strict layout will not let one workspace package reach another's dependency, and it is
  right not to.
- M8.1 left for M8.2 and M8.7: Commander writes its help and its usage errors straight to
  the real streams, so the CLI suite is noisy and the wording is Commander's rather than
  this project's. Routing that through injected streams belongs with configuration
  resolution and error presentation.

- M7.7 done. Both goldens captured against a freshly started `fixtures/ledger`, one per
  configuration. Defective: 15 requirements, 7 verified, 6 failed, 2 unverified, 24
  checks, 13 pass, 9 fail, 2 inconclusive, 4 endpoints observed. Fixed: the same 15 and
  24, 13 verified, 0 failed, 2 unverified, 22 pass, 3 endpoints observed. Coverage is 87%
  either way, which is the point: fixing a defect is not coverage.
- M7.7, the property that matters, proved rather than assumed: each golden was captured
  twice from a freshly restarted ledger and the two files are byte identical. A capture
  against a target that has already been run is not, because the run writes. `INV-1001`
  goes from 125000 to 125003 in the defective configuration and to 125001 in the fixed
  one, since one authenticated write still lands with D3 off. Restart between captures.
- M7.7: that drift is exactly what made the pre-existing server unusable. It reported
  125003, meaning one full run had already hit it, and a golden encoding that state would
  not have reproduced from a fresh start.
- M7.7: `packages/core/src/report/goldens/` is in `.prettierignore`. `renderJson` is the
  format, the round trip test asserts the file byte for byte, and prettier collapses a
  short array onto one line, so letting it rewrite them fails a test against a change
  nobody made. This is the M1.7 `schema/` trap arriving a second time, and it was
  predicted before it fired.
- M7.7 proved by breaking it: changing the JSON indent to four failed both round trip
  tests and nothing else; rendering an inconclusive check as a JUnit failure failed both
  invariant I4 tests. Both goldens carry inconclusive checks, so neither direction of
  that test can pass vacuously.
- M7.7 observation for M5, not M7 to fix: every behavioral finding is titled
  "Acceptance criterion AC-001-01" while every access finding states what happened. Read
  side by side in a rendered report the difference is stark, and the title is the line a
  reviewer sees first in a code scanning list.
- M7.7 observation, and it is the M3.8 contract question arriving as predicted: an access
  `detail` already ends with "Request: ... Evidence: ... Suggestion: ...", so the text
  report prints an evidence reference the detail just gave. M3.8 recorded that a
  suggested fix lives inside `detail` because `CheckResult` has no field for one, and
  said a report wanting to render them separately should raise the contract question.
  This is a report wanting exactly that. Sniffing the string from the emitter would be
  worse than the duplication.
- M7.7 observation: REQ-006 comes back `check-error`, which reads as though something
  threw. Nothing did. AC-006-01 is inconclusive because D6 is the entity the spec
  declares and the application never built, so there is nowhere to count records. The
  closed set in 03-CONTRACTS.md has no member for that, and `assembleRun` falls back to
  `check-error` whenever checks ran and none reached a verdict. Either the set needs a
  member or the fallback needs a better default; both are contract questions.

- M7.7 partial, and the reason it stopped is worth reading before anyone retries it. The
  capture command exists, `pnpm --filter @qai/core capture:goldens <defective|fixed>`, and
  it typechecks, lints, and formats. What it needs is a target in a known configuration,
  and the machine has a `fixtures/ledger` on port 3000 that this session did not start,
  running since 00:13 today, which is before this session began.
- M7.7: that server cannot be used as it stands, and this is a fact rather than caution.
  `INV-1001` reports `total_cents` 125003 where the seed in `fixtures/ledger/src/data.ts`
  is 125000. M5.11 made an accepted write actually write, applying a fixed increment, so
  three mutating checks have already landed on this process. A golden captured against it
  would encode drifted state and would not reproduce from a fresh start, which is the one
  property a golden has to have.
- M7.7: the running server is otherwise in the defective configuration, established by
  reading it rather than assuming. D1 on, a cross-organization read of `INV-1001` as
  `outsider` returns 200. D2 and D4 on, the list as `outsider` returns the org-1 invoice
  and carries `notes`. D5 on, `/api/debug/state` answers 200. D3 was deliberately not
  probed, since probing it writes.
- M7.7: capturing both goldens needs the ledger restarted twice, once per configuration,
  which means stopping a process this session did not start. That is the human's call, so
  the loop stopped here rather than killing it.
- Worth flagging separately, and unrelated to the plan: HEAD moved from `feat/m7-report`
  to `dev` partway through this session, between the M7.6 commit and the start of M7.7.
  Nothing in this session ran a checkout. The reflog records it as
  `checkout: moving from feat/m7-report to dev`, and the branch and all six commits were
  intact, so nothing was lost. If a second session or tool is operating in this working
  tree, that needs settling before more commits land, since committing to `dev` is
  forbidden and a concurrent checkout could land one there.
- M7.7: the capture pins `toolVersion`, `runId`, and both instants rather than reading
  them, and uses `fixedDeps` for the clock and the identifier source. Without that every
  capture differs in its timestamps and evidence ids and the file tests the calendar.
- M7.7: nothing in the suite calls the capture command. 06-TESTING.md says to regenerate
  goldens only with an explicit command whose diff a human reads, and a golden that
  changed is a question rather than a chore.

- M7.6: only 0 and 1 are computed here. 03-CONTRACTS.md gives 2 to an invalid spec or a
  configuration error and 3 to an unreachable target or a fatal runtime error, and both
  describe a run that did not happen or did not finish. A function handed a finished
  RunResult is by construction in neither case, and a test sweeps the whole option space
  asserting no other value is ever produced.
- M7.6: nothing in the file exits, per rule R5. It returns a number and M8 applies it,
  which is what keeps the rule structural rather than a convention somebody remembers.
- M7.6: the threshold table is asserted as a four by four grid rather than as four
  lookups. A comparator inverted in one direction can agree with itself across a handful
  of single assertions; it cannot agree with the whole grid. Proved by breaking it:
  flipping the comparison failed two tests including the grid.
- M7.6: the unverified opt in reads `summary.requirements.unverified`, not the
  inconclusive check tally. A requirement with one inconclusive check and one that passed
  is verified and is not a coverage gap, so counting checks would fail a run that has no
  gaps at all. A test states exactly that case.
- M7.6: gaps are off by default and that is a product decision rather than a default
  nobody chose. A requirement nobody could check is not a requirement that failed, and
  turning gaps red by default makes the honest verdict the one people switch off.
- M7.6: `--fail-on info` cannot turn a clean run red, because `findingsBySeverity` counts
  failures only and a passing check carrying `info` was never a finding. That is the
  M7.1 tally decision paying for itself in a second place.

- M7.5: inconclusive maps to `skipped`, and the reason is worth stating rather than
  remembering. A dashboard counts red and green and has no third column, so a check that
  reached no verdict has to land in the one that means nobody knows. Reporting it as a
  failure would also train the reader to ignore failures, which costs more than the gap
  it hid. Proved by breaking it: disabling the branch failed three tests and nothing else.
- M7.5: a requirement with no checks still gets a suite, holding one skipped case named
  with its reason from `unverifiedReasons`. Emitting nothing drops the requirement out of
  the dashboard, and a reader comparing two runs sees a requirement disappear rather than
  a gap appear. Proved by breaking it: dropping the empty suite failed exactly one test.
- M7.5: the test found a real gap rather than confirming the code. A model assisted check
  that came back inconclusive was losing its label, because the failure path said
  "Model assisted" and the skipped path only carried `detail`. A skipped case is exactly
  where a reader asks why nobody knows, so it says so now.
- M7.5: counts are computed from the cases that were emitted, not copied from `summary`.
  Two sources for one number is how a report starts contradicting itself, and the root
  totals are summed from the suites for the same reason.
- M7.5: a check with no requirement id goes into an `unassigned` suite rather than being
  dropped. A dropped check is a lost finding, and a structural result is the obvious case.
- M7.5: the case name carries the check id as well as the rule id, because two actors
  against one access rule are two checks sharing a rule id, per M3.1. A dashboard
  tracking a case across runs needs the name to identify one check.
- M7.5: `time` is on the root only, computed from the recorded instants rather than a
  clock, per rule R6. Per-case timing is not recorded anywhere and writing zero for it
  would claim a measurement nobody took.
- M7.5: `errors` is written as zero rather than left off. Rule R4 turns a thrown check
  into an inconclusive result, so nothing reaching this emitter is an error in the JUnit
  sense, and an absent attribute reads as unknown where zero reads as a fact.
- M7.5: XML escaping covers the five entities and strips the control bytes XML 1.0 cannot
  represent. A raw byte in a captured detail would produce a document no parser reads,
  which loses the whole report rather than one character of one message.
- M7.5, the Windows escape trap for the third time this session: writing a regex over
  control characters through a shell heredoc put literal control bytes into the source
  file, and writing `split('
')` the same way produced a real newline inside a string
  literal and broke the parse. Both times the fix was to build the escape from `chr(92)`
  or to use the file tools. This is now the single most expensive recurring mistake in
  this repository.

- M7.4, the honest state of "validates against the published schema": it validates
  against `report/sarif-schema.ts`, a Zod transcription of the SARIF 2.1.0 required
  property lists, closed enumerations, and property types, not against the published
  JSON Schema. Running the real document needs a JSON Schema validator, none is approved,
  and rule R9 forbids a test fetching one. The transcription is not decorative: changing
  `version` to `2.1` failed eighteen tests. Recorded in the M7 Open questions with three
  ways out, since adding a dependency is a human's call.
- M7.4: SARIF results are failed checks plus the structural disagreements. The module
  asks for one rule per check type and the contract has a `structural` type, so the rule
  needs something to carry, and 01-PRODUCT.md calls those entries structural findings.
  Without them D6, the entity the spec declares and the application never built, never
  reaches the GitHub UI, which is the one surface a CI user reads. `observedNotSpecified`
  brings its own severity; the other two take the constants M4.8 exported for exactly
  this caller, which is that note's open item closed.
- M7.4 deviation: the module says a location with no source names the endpoint.
  `CheckResultRecord` has no endpoint field and the route lives inside `detail` as prose,
  so a check names its rule and requirement instead. Parsing a path back out of a
  sentence would be a guess in the one place a reader is told where to look. A structural
  endpoint entry does carry an id and does name it.
- M7.4: `partialFingerprints` carries the content-hashed check id. Without it GitHub
  opens a new alert every run instead of tracking one, which turns a stable finding into
  a stream of duplicates and is the failure that makes hand-rolled SARIF worth testing.
- M7.4: `executionSuccessful` is true even when the run found things. Whether findings
  exist is what `level` says, and conflating the two reports a working tool as broken.
- M7.4: only a trailing colon and digits is read as a line number out of `locationRef`.
  A Windows path carries a colon too, and slicing on the first one would point a reader
  at a file whose name lost its drive letter.
- M7.4: keys are written in order rather than sorted, unlike `renderJson`. `version` and
  `$schema` leading the document is what every reader and every tool expects, arrays are
  sorted before they are written, and no golden file depends on the alphabet here.
- M7.4: the message is one part per line, title first, because a code scanning list shows
  the leading line and the alert page shows the rest. Joined with a space, which is how
  it was first written and how it read when printed, the title runs into the request
  summary and neither is a sentence. Read by running it, not inferred from a green suite.
- M7.4 repeat of a known Windows trap: a Python heredoc writing a JavaScript escape
  turned `split('
')` into a literal newline inside a string and the whole test file
  failed to parse. Build the backslash from `chr(92)` or use the file tools. The notes
  said this at M5 and it still cost a cycle.

- M7.3 deviation, needs review: `TextOptions` carries an optional `Observation`. Section 2
  of the report is entity and endpoint counts by origin and confidence, and RunResult
  carries `observation.ref` and nothing else, so those counts are not derivable from the
  argument the module's Public API hands this function. Putting them on RunResult is a
  contract change and therefore a stop; taking the object the caller already holds is
  not, and the emitter stays a pure function either way. If the intent was that RunResult
  summarizes its own Observation, that is the contract question to raise, and the other
  three emitters would want it too.
- M7.3: with no Observation the section names the reference rather than reporting counts
  of zero. Zero entities is a claim about the application; this is an absence of data
  about it, and the two read identically once a number is printed. A run that recorded no
  probe at all says so in a different sentence again.
- M7.3: color is a parameter, never a detection. `createColors(enabled)` is used rather
  than picocolors' default export, which sniffs the process: with the default, output
  would depend on how the suite was launched, and rule R6 keeps core out of the
  environment. Whether the destination is a TTY is M8's fact to establish and pass in. A
  test asserts the colored render, stripped of escapes, is byte identical to the plain
  one, so color stays decoration over one document rather than a second document.
- M7.3: `picocolors` was added to `@qai/core`. It is named by the module and is on the
  approved runtime list in 04-CONVENTIONS.md, so it is not a dependency stop.
- M7.3: findings are failures only, sorted by severity then requirement id then check id.
  A passing check carries `info`, so listing passes here would report a clean run as
  having findings, the same mistake `tallyFindings` refuses to make in the summary.
- M7.3: coverage is labeled coverage and the line says what it counts, "of requirements
  with at least one check that reached a verdict". The label alone is what stops a reader
  taking the number for a grade, and it is cheaper to say than to correct later.
- M7.3 proved by breaking it, three ways, each failing exactly its own tests and nothing
  else: relabeling coverage as a pass rate failed the two coverage tests; emptying the
  unverified list failed the two invariant I4 tests; dropping the severity term from the
  finding comparator failed the one ordering test.
- M7.3 test bug, the third of this family after M3.6 and M7.2: a sweep of the whole
  document for forbidden finding terms failed on `cve`, which is inside `specVersion` in
  the run header. The assertion is scoped to the findings section now and reuses the
  exported `FORBIDDEN_FINDING_TERMS` rather than a second copy of the list, so the two
  cannot drift. A test that greps a serialized document has to say which part of it.
- M7.3: the M7 Definition of Done's second command,
  `pnpm --filter @qai/cli exec qai check --format sarif`, cannot run. The command surface
  is M8 and lands later in this stage. Stated rather than skipped quietly; the same shape
  as every stage since S1.

- M7.2: keys are sorted at every level, arrays are never reordered. `JSON.stringify` emits
  keys in insertion order, so two structurally identical results can differ byte for byte
  and a golden file would be testing construction order rather than content. Array order is
  the opposite case and carries meaning: `assembleRun` puts requirements in spec order so a
  reader comparing two runs looks down the same list, and sorting them here would destroy
  that. Proved by breaking it: dropping the `.sort()` failed exactly the different-order
  test and nothing else.
- M7.2: this deliberately does not reuse `stableStringify` from `spec/hash.ts`. That one
  feeds a digest, so it is compact and writes `null` where a key has no value. Both are
  wrong for a report, which wants indentation a reader can diff and needs an absent
  optional field to stay absent, since the strict schema rejects `null` where it expects
  an optional string. Two serializers with different requirements rather than two answers
  to one question, which is the opposite of the M5.2 case where reuse was right.
- M7.2 test bug worth remembering, the same family as the M3.6 one: the array-order test
  searched the whole document for a requirement id, and found it first inside `checks`,
  which sorts before `requirements`. It failed for a reason unrelated to what it was
  testing. The assertion is scoped to the requirements block now. A test that searches a
  serialized document has to say which part of it.

- M7.1: the rollup is one exported function, `rollUpRequirement`, because the module says
  it is the rule most likely to be reimplemented subtly differently somewhere else. It is
  tested over the whole combination table, and the clause that matters is that all
  inconclusive is unverified rather than verified. Proved by breaking it: forcing that
  branch to fall through failed exactly the two tests written for it.
- M7.1: coverage is requirements with at least one non-inconclusive check over total
  requirements, and a failing check still counts as coverage, since the requirement was
  established. A run with no requirements is 0 rather than a division that would report
  perfect coverage of nothing.
- M7.1: `findingsBySeverity` counts failures only. A passing check carries `info`, and
  counting it would report a clean run as having findings.
- M7.1: unverified reasons prefer a recorded coverage gap over the generic fallback, since
  a gap names something the reader can act on. That is what `collectCoverageGaps` from
  M5.16 feeds, so the three side channels reach the RunResult through one path.
- M7.1: requirements are listed in spec order rather than in the order checks finished, so
  a reader comparing two runs looks down the same list both times. Everything else is
  sorted before it is returned, which is what M7.2's golden files will depend on.

- M5.16: gaps arrived from three places, `planAccessChecks`, `planBehavioralChecks` and
  `runBehavioralChecks`, and a caller that remembered two dropped the third silently.
  `collectCoverageGaps` gathers all three, sorted by requirement then id, and both
  demonstration scripts print from it. One place to read, one order, one format.
- M5.16, and this corrects what M5.15 proposed: the open question suggested turning each
  unplannable rule into a `CheckResult` with verdict `inconclusive` so gaps would sit in
  the same table as everything else. That is wrong. 00-INDEX.md defines a check as a single
  verification attempt producing one verdict, and an unplannable rule was never attempted,
  so it would put work the tool never did into `summary.checks.total`. The contract already
  has the right home, `unverifiedReasons` on the RunResult, keyed by requirement and drawn
  from a closed set, and every gap shape already carries a reason from that set.
- M5.16: one gap per rule or criterion, not per requirement. A requirement with two
  unplannable rules has two things wrong with it and whoever is fixing them needs both
  named. Collapsing per requirement is M7's job when it fills `unverifiedReasons`.
- M5.16: a criterion reported by two sources at once is listed once, with the planning
  reason winning, since planning happens first and its reason is the more actionable. A
  gap listed twice reads as two problems.

- M5.15, the actual reason AR-011-01 went unnoticed for two stages: `check-ledger.ts`
  printed `1 not` and threw the reasons away. `planAccessChecks` had been returning the
  rule id, a reason from the closed set, and a sentence naming the fix on every run since
  M3.2, and no reader ever saw any of it. The script prints them now, under a heading that
  says what they are.
- M5.15, proved by putting the defect back: with AR-011-01 pointed at `User` again the run
  reports `AR-011-01 unsupported-condition` and `No route is known for read on "User".
  Configure resources[].routes.read for it, or run a probe first.` Pointed at `Invoice` it
  reports no gaps at all. The count alone was what made a two-stage-old gap look exactly
  like a fresh one.
- M5.15, what this does not fix, stated so nobody mistakes it for solved: a gap that has
  been open since M1.8 still reads identically to one introduced this morning. Telling them
  apart needs run history, which is M6, and a report that can compare against it, which is
  M7. Neither exists. The honest position is that gaps are now legible, not that they are
  ranked.
- M5.15 for M7 to decide: an unplannable rule reaches the caller in a side channel next to
  the results, so any renderer that shows results and forgets the side channel loses it
  again. Turning each one into a `CheckResult` with verdict `inconclusive` would put gaps
  in the same table as everything else and make forgetting them structurally harder. That
  changes what the results list means and belongs to whoever assembles the RunResult.

- M5.14: AR-011-01 named `User`, which the target serves no route for, so it could never be
  planned. It names `Invoice` now and the rule is checked rather than being coverage on
  paper. What it asserts did not change: a forged credential is refused. With that, both
  halves of the fixture spec are fully planned, 8 access rules and 16 criteria, 0
  unplannable on either side.
- M5.14: the S3 exit criterion was re-verified rather than left to drift, since changing a
  rule changes what that script reports. Defective 3 fail 5 pass exit 1, fixed 8 pass 0 fail
  exit 0, against 3 fail 4 pass and 7 pass when it was first run. The original numbers are
  left in place as the record of the run that happened on the day, with the re-run recorded
  beneath them.
- M5.14 worth watching: an unplannable rule is quiet. AR-011-01 sat unplannable from M1.8 to
  here, reported honestly every run, and nobody looked at it until an unrelated change made
  the loader warn about an unreferenced actor. The reasons are in the output; what is
  missing is anything that makes a long-standing gap harder to ignore than a new one.

- M5.13, approved by the human on 2026-08-17: `qai.config.yaml` configures an `impostor`
  actor carrying a bearer token that matches no seeded user, which closes AC-011-01. Every
  criterion in the fixture spec now plans, 16 of 16, and the file has no recorded gap left.
- M5.13, the thing worth remembering: this was never a vocabulary problem, and no assertion
  form would ever have closed it. A spec can only ask about identities the target is
  configured to present. That is a limit on coverage no grammar reaches, and the honest
  signal was the criterion staying unplannable with its `when` clause named rather than
  being quietly rewritten into a claim about `anonymous`.
- M5.13: `anonymous` and `impostor` are two actors on purpose. One presents nothing and the
  other presents a credential belonging to nobody, and a target can refuse the first while
  accepting the second. Collapsing them would have made REQ-010 and REQ-011 the same check.
- M5.13 consequence for every script: `resolveCredentials` treats an unresolved credential
  as fatal, so a fourth configured actor makes `LEDGER_UNKNOWN_TOKEN` mandatory for all
  four scripts in `packages/core/scripts/`, not just the behavioral one. Their run recipes
  say so now. Without it a run stops at exit code 2 naming the variable, which is the right
  failure and still a new one.
- M5.13: the loader caught something the change would otherwise have hidden. Adding the
  actor produced a second load warning, that `impostor` is referenced by no access rule,
  which pointed straight at AR-011-01 naming `anonymous` for a requirement about
  unrecognized tokens. The rule now names the impostor and says what REQ-011 says. It stays
  unplannable, since the target serves no `User` route, exactly as it was before.
- M5.13 follow-up worth considering: AR-011-01 could point at `Invoice`, which has routes,
  and REQ-011 would then be checked on the access side as well as the behavioral one. Left
  alone here because it changes what the S3 demonstration script reports, and that evidence
  is recorded against a run nobody has repeated.

- M5.12c, approved by the human on 2026-08-17: `as every actor` on the endpoint sweep
  closes the second half of AC-014-01. Every criterion the fixture spec narrowed at
  M5.8-pre2 has now been restored to what it originally claimed, which was not the plan
  when those gaps were recorded as losses.
- M5.12c: the axis is written out in the criterion rather than implied by the word every,
  because it multiplies the request count. Three actors across four observed endpoints is
  twelve readings from one criterion, and an author should meet that number in the spec
  rather than in a run. The result states the reading count and names the actors.
- M5.12c: the sweep runs as the actors in the session map, which holds those whose
  credentials resolved. An actor that did not resolve is absent rather than failing, so
  naming who was swept is what stops that reading as coverage the run did not have.
- M5.12c earns its cost, measured rather than argued. Making the fixture hand a token to
  org-2 only, the criterion without the axis passes over four clean readings as the owner
  while the outsider is being handed a token; with the axis it fails naming
  `/health as outsider`. A field one identity can see and another cannot is exactly what a
  single-actor sweep cannot find.
- M5.12c: `every endpoint omits field User.token for every actor` is refused, as is a
  sentence that trails off after `as every`. Multiplying the request count is not something
  to infer from prose that nearly says it.

- M5.12b, approved by the human on 2026-08-17: `every endpoint omits field <Entity>.<field>`
  closes AC-014-01, the last of the fixture spec's vocabulary gaps. It quantifies over the
  endpoints an Observation holds, which is the only enumeration of an application that
  exists here.
- M5.12b, the rule that makes the quantifier safe: with no Observation, or none the sweep
  can read, the assertion is unevaluable rather than satisfied. A universal over nothing
  was not asked. An integration test runs the criterion both ways and asserts exactly that,
  since a form that passed when it checked nothing would be worse than the enumerated
  criteria it replaced.
- M5.12b: an endpoint whose body could not be read blocks a pass. Four clean readings and
  one unparseable body do not establish that every endpoint omits a field, which is the
  refusal M3.6 already made about rows nobody could judge. A definite leak still outranks
  an unreadable body, since the leak was seen.
- M5.12b proved by breaking it: adding a `token` field to the debug endpoint's response
  made the criterion fail, and `AC-014-02`, the enumerated read this form replaced, did not
  notice. That is the coverage the universal buys, measured rather than asserted.
- M5.12b: only GET and HEAD are swept and a path carrying an unresolved parameter is
  skipped, so an assertion cannot write and cannot request a route the target does not
  serve.
- M5.12b honest limitation: coverage is the crawl's coverage. An endpoint the probe never
  reached was never checked. The result says how many endpoints answered so the scope of
  the claim is visible, and the structural diff remains what reports an endpoint nobody
  specified.
- M5.12b: the demonstration script now probes before planning, since a criterion that
  quantifies over an Observation needs one. `AC-014-02` was kept deliberately, so REQ-014
  still has deterministic coverage in a run with no probe at all.
- M5.12b: the universal over actors was deliberately not closed. A criterion names one
  actor, and sweeping every configured identity would read as thoroughness while hiding a
  loop whose cost the author cannot see. One criterion per actor keeps the request count in
  the spec where somebody can read it.

- M5.12, approved by the human on 2026-08-17: `status matches <request>` compares the
  action's status against the status another request returns, which is what AC-013-01
  claimed at M1.8 and lost at M5.8-pre2. The reference is written in the `when` vocabulary
  rather than a second grammar, so it resolves its route, actor, and instance exactly as an
  action does and a reader learns one table.
- M5.12: a reference that mutates is refused at parse time and the criterion is reported
  unsupported. An assertion that changed the target would break invariant I7 from inside a
  verdict, and that is not a rule to leave in a runner for future callers to preserve.
- M5.12 is worth more than the literal it replaced, and this was shown rather than argued.
  Making the fixture answer 403 to both a cross-organization read and a read of a
  nonexistent invoice keeps the criterion passing, where `status is 404` would have reported
  a false finding against an application that was behaving correctly.
- M5.12: only the status is compared. The form says status and claims nothing more.
  Comparing two whole responses is a much larger assertion wearing the same words and would
  need its own approval.
- M5.12: this is the third form that issues its own traffic, after the record count and the
  before and after comparison, so the runner's old framing of one criterion, one request is
  no longer literally true. The header comment in `deterministic.ts` now says so. Every one
  of the three is a read, and every request any of them makes is recorded as evidence.
- M5.12: the parsed reference is rebuilt field by field rather than stored as the parser
  returned it, so the parse discriminator does not travel into the assertion AST. A `kind`
  nested inside another `kind` reads like a bug the first time somebody serializes one, and
  a deep-equality test caught it immediately.

- M5.11, approved by the human on 2026-08-17: the assertion table gained
  `record <Entity> is unchanged`, which restores the clause AC-003-01 and AC-009-01 had to
  drop at M5.8-pre2. It is the only form that needs the runner to hold state across
  requests: the record is read once before the action and once after, and the two readings
  are compared.
- M5.11: the before read is the one thing in the runner that has to happen first, and the
  ordering is load bearing rather than incidental. Proved by breaking it: moving the read
  to after the action failed five tests, including the end to end one.
- M5.11: the record is read as the configured state actor, never the acting one, for a
  reason this criterion makes vivid. AC-003-01 acts as `anonymous`, who cannot read the
  invoice at all, so reading state as the actor under test would report a scoping rule as
  a state fact and the criterion could never be evaluated.
- M5.11: a record present before and gone after is a violation, not an unreadable reading.
  Deletion is the largest change a record can undergo and collapsing it into "could not
  read" would lose the finding entirely.
- M5.11: everything else that can go wrong is unevaluable, with the reason attached. No
  state actor, no read route, a read that failed, a record that did not exist to begin
  with, or a body that will not parse. Only two readable records that differ is a
  violation, and the finding names the fields that moved.
- M5.11: two byte-identical bodies that are not JSON count as unchanged, and two differing
  ones do not count as changed. A difference between two unparseable bodies could be a
  rendered timestamp, which is not evidence about the record.
- M5.11 fixture change, flagged for review: an accepted write in `fixtures/ledger` now
  actually writes. It did not before, so D3's catalog line, that an invoice can be modified
  without credentials, was only half true, and the unchanged clause could never be false
  against this fixture. The tool issues no request body, so the applied change is a fixed
  increment to the total. The seed is untouched, so a restart is still the reset.
- M2.8, resolving what M5.11 raised: `TargetConfig` now carries `stateActor`. It names a
  configured actor, has no default, and naming an actor that is not configured fails the
  load rather than leaving every state assertion quietly unevaluable. A cross-module edit
  into M2's file, the same shape as M3.2 adding `resources`, and recorded in both module
  files.
- M2.8: neither candidate default was safe, which is why there is none. The acting actor is
  frequently an identity that cannot read the record at all, and that is the point of the
  criterion rather than an edge case. An actor scoped to its own organization counts only
  what it can see, so a scoping bug would arrive dressed as a state bug.
- M2.8 proved by breaking it: commenting `stateActor` out of `qai.config.yaml` and running
  the demonstration against the repaired ledger turned AC-003-01 and AC-009-01 from pass to
  unverified, 13 pass 0 fail 2 unverified becoming 11 pass 0 fail 4 unverified. The field is
  load bearing, and its absence degrades honestly rather than passing quietly.
- M2.8 limit worth stating: the fixture's `stateActor` is `owner`, which is scoped to org-1.
  It is the right identity for the records these criteria compare and the wrong one in
  general, since a count of an entity owned by another organization would come back short
  rather than wrong. The config says so beside the field, and the corpus run will want an
  unscoped reader.

- M5.10, approved by the human on 2026-08-17 after the stage was otherwise complete: the
  assertion table gained an actor reference on the right of an equality and an every row
  form over a list. Both are what AC-002-01 needed, and it is now a real check rather than
  a recorded gap. The fixture spec has no unexpressible `then` clause left, so
  `validateAcceptanceCriteria` returns nothing and the demonstration reports 0 authoring
  warnings where it reported 1.
- M5.10: the demonstration numbers moved, and were re-run rather than adjusted on paper.
  15 criteria plan where 14 did, defects on gives 6 failures where it gave 5, and defects
  off gives 13 passes where it gave 12. The finding text is the part worth reading:
  `1 of 2 Invoice row(s) without org_id equal to actor.org_id, which is "org-2": INV-1001`.
  It names the row, which is what makes a scoping finding actionable.
- M5.10: three rules keep the new forms from being a way to guess. An unconfigured actor
  attribute is unevaluable, never violated, since a finding there would be about the
  configuration. An empty list is unevaluable, not vacuously satisfied, which is Q5's
  answer held to in a second place. A row that was read and found wanting is a violation
  and is named.
- M5.10: a literal keeps the strict comparison it always had, and an actor attribute is
  compared loosely across string and number exactly as `evaluateCondition` compares.
  Configuration can only hold strings, so a strict comparison against a numeric field would
  fail every time and the failure would look like a finding.
- M5.10: `body-equals` now carries `expected: AssertionValue` rather than `value:
  LiteralValue`, so both equality forms share one comparison path. Two ways to spell
  equality in the AST would have been two code paths in the runner forever.
- M5.10 gap that remains: AC-011-01, which needs a configured actor holding a token
  belonging to no user. That is a target configuration question and no assertion form
  closes it. The three narrowed criteria would need a before and after state form and a
  cross-request comparison, both larger extensions than these two, since they need the
  runner to hold state across requests rather than read one response.

- M5.8: the integration test reads the real `fixtures/ledger/spec/ledger.spec.yaml` rather
  than a spec written inside the test. A hand-built spec would only prove the runner agrees
  with something the test invented; what is worth asserting is that the file a user would
  write turns into checks that catch what is wrong with the application it describes.
- M5.8: both directions are pinned as whole verdict maps, not as one lookup each. Defects
  on gives 5 fails, 2 inconclusive, 7 pass; defects off gives 0 fails and the same 14
  criteria. A runner that always failed or always passed breaks one of the two, and the
  same checks run in both so the runs compare.
- M5.8: D1 costs two failures, AC-001-01 and AC-013-01. The second is the one that says a
  refusal must not confirm the invoice exists, and with D1 on the read simply succeeds, so
  both criteria are reporting the same defect from different angles.
- M5.8: AC-006-01 is inconclusive in both directions and always will be. D6 is the entity
  the spec declares and the application never built, so there is nowhere to count records
  and nothing is claimed either way. That is invariant I4 doing its job rather than a gap
  in the runner.
- M5.8: the fuzzy criterion is the only result carrying `deterministic: false`, so
  `modelAssistedCheckCount` is 1 for a run in which no model was consulted at all. That is
  the M5.7 judgment call showing up in a real run, and it is the number a reviewer should
  look at first.

- M5.7 crossed a task boundary by one function, flagged rather than hidden:
  `planBehavioralChecks` used to refuse every fuzzy criterion with `capability-unavailable`,
  which made the S5 exit criterion unreachable, since a criterion that never plans can
  never run under Playwright. Fuzzy criteria now plan through the `when` vocabulary with no
  assertions, and the capability question moved to the runner where it belongs. Planning is
  M5.9's task; the decision to move it is M5.7's.
- M5.7: a fuzzy criterion's `then` deliberately does not go through the assertion table.
  Parsing it would refuse the criterion for being exactly what it declares itself to be.
  Planning with an empty assertion list is also what makes the deterministic runner decline
  it, since that runner already reports a plan with nothing to assert as inconclusive.
- M5.7: the browser capability is resolved once per run rather than per capture, so twelve
  fuzzy criteria attempt the optional import once, and a missing browser is a fact about the
  run that is phrased in one place instead of rediscovered in twelve.
- M5.7: `capability-unavailable` and `model-inconclusive` are kept apart. Nothing looked at
  the page and a model looked and was unsure are different facts, the contract keeps
  separate reasons for them, and only the first is fixable by installing something. Proved
  by breaking it: dropping the capability branch reclassified a skipped criterion as
  `model-inconclusive` and exactly one test failed.
- M5.7: the reason travels beside the results, not inside them. `CheckResult` has no field
  for an unverified reason and adding one would be a contract change, so
  `runBehavioralChecks` returns `{results, unverified}`, the same widening
  `planBehavioralChecks` made with `unplannable`.
- M5.7 judgment call, worth a review: a fuzzy criterion skipped for a missing browser is
  recorded `deterministic: false`, so it counts toward `modelAssistedCheckCount` although no
  model was consulted. The alternative claims a deterministic check produced the result.
  Overstating how much of a run was not deterministic is the safer error here.
- M5.7: the degradation is two layers deep, which the break test made visible. Even with the
  capability check removed, `capturePage` still returns `unavailable` and the criterion is
  still inconclusive with the install line attached. Only the classification was wrong.
- M5.7: the M5 Definition of Done lost its second command rather than gaining a replacement.
  `--no-playwright` was never a vitest option, and an environment variable would put core in
  the environment against rule R6. The launcher is injected by the caller and absent by
  default, and this repository genuinely lacking Playwright is what exercises the absent
  path. A test asserts that premise so the day the dependency lands, the suite says so.

- M5.8-pre2: the fixture spec now reads through both vocabularies. 13 of 16 criteria plan,
  and the three that do not are recorded gaps rather than silence: AC-002-01 whose `then`
  compares a field on every row against a caller attribute, AC-011-01 whose `when` needs an
  actor holding a token belonging to no user, and AC-005-02 which is the fuzzy one. The
  spec hash moved to `sha256:63c0096716d3...`; nothing pinned the old one.
- M5.8-pre2, the honest cost of the rewrite: two criteria lost a clause. "and the invoice
  is unchanged" in AC-003-01 and AC-009-01 needs the record read before and after the
  action, and the vocabulary offers only a count. Keeping the sentence whole would have
  left D3 and N2 with no behavioral coverage at all, so the clause was dropped with a
  comment in the spec rather than left to fail the whole criterion. The criteria now assert
  less than the sentences they replaced, which is a real reduction and belongs in a review.
- M5.8-pre2: AC-013-01 traded generality for expressibility. It compared the status of two
  different requests, which nothing can state, and now names 404 as a literal because
  REQ-012 pins the absent-invoice status at 404. If REQ-012 ever changes, this literal has
  to change with it and nothing enforces that.
- M5.8-pre2: AC-014-01 was one universal over every endpoint and every actor, and is now
  two criteria naming two routes. An endpoint added later is not covered until somebody
  adds a criterion for it. That is worse than the sentence it replaces and is the shape of
  the tradeoff every rewrite here made: what the tool can check is narrower than what an
  author can say.
- M5.8-pre2: AC-005-02 was added as the one `mode: fuzzy` criterion in the fixture, since
  the S5 exit criterion needs a fuzzy criterion to run and the file had none. It asks
  whether the index page offers an administrative route, which is a judgment rather than an
  assertion. `planBehavioralChecks` refuses fuzzy criteria today with
  `capability-unavailable`, so M5.7 owns what happens to it when Playwright is present.
- M5.8-pre2: no actor was added to the spec. `fixture-spec.test.ts` asserts the actor list
  is exactly owner, outsider, anonymous, and a fourth actor for AC-011-01 would need a
  credential in `qai.config.yaml` that resolves to a token belonging to no user. That is a
  target configuration question, not a vocabulary one, so the criterion stays a gap.
- M5.8-pre2: `fixture-criteria.test.ts` builds its planning context from the repository's
  own `qai.config.yaml` rather than a literal, so the claim under test is that this spec
  plans against this target. A hand-built context would assert only that the spec plans
  against something the test invented, and could not fail when config drifts.
- M5.8-pre2: the planning result was read by running it, not inferred from a green suite.
  13 planned, 3 unplannable, and every route, actor, method and assertion kind was printed
  and checked by eye before the test was believed.

- M5.8-pre1: D4 is now implemented in `fixtures/ledger` behind `LEDGER_DEFECT_D4`, with
  ledger level tests holding it in both directions, the same shape D5 took at M4.9. The
  catalog now has D1, D2, D3, D4, D5 and both negative controls. D6 stays unimplemented on
  purpose and D7 is still deferred.
- M5.8-pre1: the switch is scoped to the list. REQ-004 says notes are omitted from list
  responses, so a single invoice read returns the field whichever way the switch is set.
  Covering the read as well would put two defects behind one toggle and would change what
  D1 leaks, which several S0 to S3 assertions are written against.
- M5.8-pre1: the redacted row is spelled out field by field against `Omit<Invoice,'notes'>`
  rather than copied and pruned, so a field added to `Invoice` later fails to compile
  instead of quietly disappearing from list responses.
- M5.8-pre1 consequence to watch at M5.8: with D4 off the crawler no longer sees `notes` in
  the list, so `diffSpecObservation` can report a field mismatch against an entity the spec
  declares the field on. No test asserts `fieldMismatches` for the defects-off probe today,
  so nothing breaks, but a spec declaring a field and a requirement asking for it to be
  withheld from one response are not in conflict and the diff cannot currently tell.

- M5.6, the invariant I1 rule in code: a deterministic failure decides the verdict whatever the model answered; `satisfied` with nothing failing is `pass`; `not-satisfied` and `uncertain` are both `inconclusive`. The only `fail` in the file is reached without consulting the answer at all, and a test iterates the whole answer union asserting none of them produces one.
- M5.6: the same rule runs the other way, and that direction is the more tempting mistake. A model answering `satisfied` cannot erase a deterministic failure. A check a model can talk out of failing is worth nothing, and there is a test for it.
- M5.6: a fuzzy result carries the deterministic result's evidence and records none of its own. That is not a gap in invariant I3: the only verdict this path can produce that is a finding is `fail`, which arrives from the deterministic side already carrying a request and a response. `pass` and `inconclusive` are not findings.
- M5.6: the model's answer is quoted in the detail behind the words "Model assisted", and on the failing row the deterministic observation is stated first so nobody reads the model as having decided. Every result sets `deterministic: false`, which is what drives `modelAssistedCheckCount`.
- M5.6: `fuzzy.test.ts` declares its own judges rather than importing `scriptedJudge` from `llm/`. Rule R1 forbids anything under `checks/` importing that directory, and lint enforces it for tests as much as for runners. A boundary a test may cross is not a boundary. The duplication is small and the alternative weakens the rule.
- M5.6: `BehavioralPlan` gained `given` and `when`, so a fuzzy check shows the model the whole criterion rather than a fragment, and `BehavioralContext` gained `browser`, which keeps `runFuzzyCheck` to the three arguments the module's Public API names plus an optional deterministic result.

- M5.5: `capturePage` reads `innerText('body')`, the rendered text of the document, and never a class, a tag structure, an nth-child position, or a generated identifier. Invariant I6 holds by construction rather than by review, and a test reads the source with comments stripped to assert no such API is called. The first version of that test failed against the words in its own doc comment, which is a fair warning about grepping prose for a policy.
- M5.5 judgment call, needs review: **screenshots are off by default.** The module says a fuzzy check captures one, and a screenshot cannot be redacted the way a JSON body can, so a field marked `sensitive: true` is plainly readable in the image while rule R8 says never write an unredacted response to disk. The image is captured only when a caller passes a path; the accessible text, which does go through redaction, is the default evidence. If the intent was that screenshots are always taken, that is a conflict between the module and R8 rather than a local choice.
- M5.5: Playwright is loaded through a specifier held in a variable, so TypeScript does not try to resolve a module this project does not depend on, and a failed import is a returned undefined rather than a throw. The absent-Playwright path is not faked in tests: this repository genuinely lacks Playwright, so `loadLauncher` is exercised against reality and returns undefined.
- M5.5 limit worth stating: the real Playwright path is unexercised. Every capture test drives a fake launcher, which defines the shape this code expects rather than proving Playwright provides it. The first run against a real browser will be the first real test, and it belongs with M5.8 or the corpus run.
- M5.5: a page authenticates through `extraHTTPHeaders`, which the caller supplies. `ActorSession` deliberately does not expose its credential, so nothing in this file can reach one; whoever assembles a fuzzy run has to pass headers explicitly. A cookie-authenticated actor is not covered and needs `context.addCookies`, which nothing calls yet.

- M5.4 deviation, flagged in the module: the `Judge` interface lives in `checks/behavioral/judge.ts`, not in `llm/` where the task puts it. R1's lint rule forbids `checks/**` importing `**/llm/**` with `allowTypeImports: false`, and the fuzzy runner is a check, so a `Judge` declared in `llm/` would be unimportable by its only consumer. The port sits beside the consumer and `llm/` holds the implementations. The alternative, relaxing `allowTypeImports`, weakens the invariant and is not a local call.
- M5.4: the boundary is proved by a type sweep over everything `llm/` exports rather than by naming functions one at a time, so a function added later is covered without anyone remembering to extend the test. Verified by probe, not by reading: adding `export function leakyVerdict(): 'pass'` to `llm/` made `pnpm typecheck` fail with "Type '\"pass\"' does not satisfy the constraint 'never'", and removing it made it pass. A proof that cannot fail proves nothing.
- M5.4: `unavailableJudge` answers `uncertain` every time, including when the page text contains an instruction telling it to answer satisfied. That is not cleverness, it is the shape of the boundary: with no model configured nothing looked at the page, and `uncertain` maps to `inconclusive`. A test drives an injection string through it.
- M5.4: `scriptedJudge` lives in `llm/` rather than in a test helper, for the reason `fixedDeps` does. M5.6 has to test adversarial model output, and two suites with two different fakes would eventually disagree about what the boundary permits.
- M5.4: no model client is imported and none can be until a dependency is approved, since the list in 04-CONVENTIONS.md has no model SDK on it. A test reads the source and asserts no client import appears, so the day someone adds one it is a decision rather than an accident.

- M5.3: the state read is issued after the action, as a separate request, and its evidence id joins the action's on the result. Two requests, both recorded, which is what makes a state claim reviewable.
- M5.3: state is read as a configured state actor rather than as the acting one, per the module's line about the owner actor. An actor scoped to their own organization would count only what they can see, so a scoping bug would arrive dressed as a state bug. Absent configuration leaves the count unevaluable rather than falling back to the acting actor.
- M5.3: every way a count can fail to be produced is unevaluable, never zero. No list route, no state actor, a transport failure, a refusal, or a body whose rows cannot be found all report why. `extractRows` from M3.6 already separates an unreadable shape from an empty list, and reusing it is what keeps that distinction from being re-derived differently here.
- M5.3: where to read an entity back is resolved at planning time, so the runner knows nothing about configuration and route resolution stays in one place. An entity with no list route still plans, because the clause is expressible and it is the target that offers nowhere to look, which is a capability gap rather than an authoring mistake.
- M5.3: two clauses counting the same entity read it once. A test asserts the request list, since a second read after the first would be counting a different moment.

- M5.9, resolving the M5.2 gap: the user chose a `when` vocabulary over reusing access rules or changing the contract, so the module now carries a request table beside the assertion table. Seven forms, same discipline as `then`: canonical, mechanically tolerant, refusing rather than guessing.
- M5.9: the instance id is optional on a read and required on an update or delete. A read of any record is still a read, while updating one record means naming which, and picking for the author would be the tool inventing a target's shape. A read may also name an id so a criterion about a record that does not exist can say which.
- M5.9: routes resolve exactly as they do for access rules, Observation first then configured route then nothing, reusing M3's `resolvePath` and `PlanningContext`. No spec needs to carry target data, since the instance comes from config unless the criterion names one.
- M5.9: `planBehavioralChecks` returns `{plans, unplannable}` where the module's Public API says `BehavioralPlan[]`, the same widening M3 made and for the same reason. A criterion that vanished from the plan would read as coverage that does not exist, so each one comes back with a reason from the contract's closed set.
- M5.9: create and update send no request body, matching what access checks do. A criterion needing one is outside the table and needs approval, which is recorded in the module.
- M5.9 repeat of the M5.1 trap, worth stating plainly: the type predicate was written over an intersection rather than a named union member, so narrowing failed on the negative branch and 958 tests passed while `pnpm typecheck` failed. Writing the note at M5.1 did not stop it happening again at M5.9. The rule to follow mechanically is that a predicate names a member of the union, never a shape that merely matches one.
- M5.9: fixing the narrowing immediately surfaced dead code the compiler could not see before, a ternary for a `path` action that had already returned. Better types find more than they cost.

- M5.2 gap, needs a decision before M5.8: nothing turns a criterion's `when` clause into a request. An access rule carries actor, action, and resource as fields, so M3 could plan one; an acceptance criterion states `when` in prose and the module gives a vocabulary for `then` only. `BehavioralPlan` therefore carries its request rather than deriving one, and `planBehavioralChecks` from the module's public API is not implemented. Three ways out: a `when` vocabulary mirroring the `then` table, reusing the requirement's access rules to supply the request where one exists, or adding structured fields to the criterion, which is a contract change. Recorded in the M5 Open questions.
- M5.2: assertion evaluation is three-valued, satisfied, violated, or unevaluable, and a definite violation outranks an unevaluable assertion. If one clause is proven false the criterion did not hold, whatever could not be read about the rest. A criterion whose assertions are all unevaluable is `inconclusive`, never a pass.
- M5.2: a body that is not JSON makes a field or value assertion unevaluable, but a JSON body missing the asserted path is a violation. Not being able to read the body and reading it to find the value absent are different facts.
- M5.2: a violated `response time under` assertion fails at info severity, per the module's line that latency is informational. When latency is only one of several failures the criterion keeps its own severity, since something other than speed was wrong. Both directions have tests.
- M5.2: the runner reuses `resourceFieldsIn` from M3's verdict table rather than writing a second field matcher. Two implementations of "is this field in the body" would eventually disagree, and the one in access checks is already the one findings are written against.
- M5.2: `record count of <Entity> is <n>` is unevaluable here and says so in the finding text. It needs the follow-up read that M5.3 adds, and reporting anything else would be a verdict about state nobody read.
- M5.2: the mutating interlock is the same shape as M3.7, permission passed in rather than recomputed, absent means refused. A refused mutating criterion issues no request at all, asserted by a test on the recorded request list.

- M5.1: the vocabulary is strict and its tolerance is mechanical only. A leading `the`, a leading `response`, a trailing period, and `and` between clauses are absorbed; nothing else. A parser that decided "the body reports status ok" means `body.status equals "ok"` would be guessing, and a wrong guess here becomes a confident verdict about somebody's application. Eight tests assert the refusals, using the real unparseable clauses from the fixture spec.
- M5.1: a criterion is all or nothing. If one clause of three falls outside the table the whole criterion is unsupported, because asserting the two that parsed and reporting `pass` claims the criterion was verified while a third of it was never tested. That is the quiet green run invariant I2 exists to stop.
- M5.1: `validateAcceptanceCriteria` lives in M5 and is called by whoever assembles a run, though the module calls its output a load-time warning. M1 does not depend on M5, and having `loadSpec` emit M5's diagnostics would invert that dependency for the sake of the word.
- M5.1 trap, a new variant of an old one: 44 tests passed while `pnpm typecheck` failed. The type predicate `isSupported` named a structurally equivalent shape rather than a member of the union, so TypeScript would not narrow on the negative branch and rejected a `.reason` access that could only be reached with an unsupported result. Vitest strips types, so the suite never saw it. A predicate has to name the union member.
- M5.1: `splitClauses` splits on `and` outside quotes, so `body.message equals "created and sent"` stays one clause, and it matches whole words, so `"android"` is not split.

- M4.4 resolved 2026-08-16: the user chose to read `schema.prisma` textually and add no dependency. The plan was corrected rather than the approved list widened, so the module implementation note now says so. The adapter reads `model` and `view` blocks with the same glob and regex posture as the other two.
- M4.4: relation fields are dropped. A relation is a link to another model, not necessarily a field in any response, and recording one would produce an undeclared field finding against a spec that was right. Enums are read but are not entities, and a field typed by an enum stays, because an enum is a value.
- M4.4: `@map` is not used as the field name. The mapped value is the database column and the client surface carries the field name. The diff's name normalization already matches `orgId` to `org_id`, so nothing is lost.
- M4.4: `fieldsInBlock` is named for the block because `fieldsIn` is already exported by the crawler through the same barrel. The M4.1 note said anything the barrel exports twice is a compile error rather than a silent divergence; this is the second time that has come up.
- M4.4 does not change the ledger. It has no `schema.prisma`, so the probe of it is still black box and `Organization`, `User`, and `AuditLog` are still reported as specified and not observed. That earlier note predicted the integration assertion would change when M4.4 landed; it does not, because the fixture has no schema for any adapter to read.
- M4.9: D5 is now implemented in `fixtures/ledger` behind `LEDGER_DEFECT_D5`, with ledger level tests holding it in both directions. D6 needed nothing: the spec has declared `AuditLog` since M1.8 and the application has never implemented it.
- M4.9: the ledger now serves a route index at `/`. It is not a defect and is asserted either way. Without something naming the debug route a black box crawl could not reach it at all, and a defect the probe cannot reach would test the diff against an Observation that could never contain it. The blind spot is real and is what the low confidence on a black box only endpoint is for.
- M4.9: the index names `/api/invoices/{id}`, which the crawler requests as `/api/invoices/%7Bid%7D` because every candidate is resolved through `URL` rather than pasted together. It answers 404 and is correctly not recorded. A test pins both halves of that.
- M4.9: the probe of the defective ledger records four endpoints, `/`, `/api/debug/state`, `/api/invoices`, and `/health`, each `origin: blackbox` and `confidence: low`, each carrying one evidence id.
- M4.9 cost of deferring M4.4, asserted rather than hidden: `Organization` and `User` are real in the fixture, serve no route of their own, and therefore appear in `specifiedNotObserved` alongside `AuditLog`. A Prisma adapter would have observed them as models. The test states all three so the day M4.4 lands, the assertion changes and someone has to look at it.
- M4.9: entity matching by response fields now ignores `id` and the timestamp names. Two records agreeing that they have an `id` is not evidence they are the same model, and without that rule an invoice response matched the `User` entity.
- M4.8: the contract's `specifiedNotObserved` and `fieldMismatches` entries carry no severity field, while the module states a default severity for both. Adding the field would be a contract change, so the two defaults are exported as constants for whoever turns an entry into a finding. Worth resolving properly when M7 renders these.
- M4.8: an Observation that saw nothing at all produces no `specifiedNotObserved` entries. A probe that could not reach the target and a target implementing none of the spec are different facts, and reporting the first as the second fills a report with findings about a run that never happened. The RunResult already has `probe-incomplete` for the real case.
- M4.8: entity matching has three strengths, and they are recorded rather than flattened. An adapter that read the model is high, a route named after the entity is medium, and response fields lining up is low. With M4.4 deferred nothing produces schema entities, so in practice every match is by route or by fields, which is exactly why the confidence is on the record.
- M4.8: an endpoint counts as specified when a path segment names a spec entity that some requirement references. That is the only link the spec offers, since a spec names entities and rules rather than routes. `TargetConfig.resources` would give an exact mapping, but `diffSpecObservation(spec, observation)` is the public API and taking config here would widen it.
- M4.8: the unauthenticated rule is checked before the noise rule. A health route that answers without credentials and returns fields from a spec entity is not noise, whatever it is called. A test holds that ordering.
- M4.8: `authRequired` is `unknown` on everything the crawler produces, so the high severity rule will rarely fire until a check establishes authentication. That is the module's rule working as written rather than a gap.
- M4.8: field mismatches are only computed for an entity whose fields were actually observed. Otherwise a spec field the crawl never had a chance to see would be reported as missing, which is a finding about the crawl budget dressed up as a finding about the application.
- M4.8: `singular` leaves words ending in `us`, `ss`, or `is` alone, so `status` does not become `statu`. Found by a test; both sides of a comparison run through it, so a wrong answer costs a match rather than inventing one.
- M4.7 owns `probe()` as well as the merge. No task claims the orchestration, nothing else can assemble an Observation, and M4.9 needs it. Flagged rather than assumed: if the plan meant it elsewhere, this is where it landed.
- M4.7 confidence table, from the module text: source only high, black box only low, both agree high, and in hybrid mode a route only one side saw is medium with a note. The two hybrid rows are the ones that matter. A declared route the crawl never reached may be unlinked, behind the budget, or not wired up, and the tool cannot tell which from outside. A route that answered while nothing declares it is the shape of an endpoint nobody asked for.
- M4.7: nothing either side saw is dropped. A merge that resolved a disagreement silently would erase the finding this stage exists to make possible.
- M4.7: when both sides agree, the source spelling of the path and its handler reference win, and the crawl contributes evidence and observed fields. Matching is by the M4.6 identity key, so `:invoiceId` from source pairs with `INV-1001` from the crawl.
- M4.7: `probe` takes a narrow `ProbeContext` rather than the whole `TargetContext`, which satisfies it structurally. The probe has no business reaching credentials, the evidence writer, or the redaction rules, and the narrower seam is what lets the unit tests state a target in three lines.
- M4.7: `ProbeOptions` gained `deps`, `cwd`, and `startPaths`. `deps` is required, because an Observation carries a timestamp and rule R6 says core does not read the clock on its own.
- M4.7 test trap, same family as the earlier ones: four probe tests wrote a synthetic Express file with no `import express`, so the adapter's detect correctly said no and the source half never ran. Three of them asserted things that were true anyway and passed. Only the one asserting an endpoint list failed. A fixture that does not trip detection tests nothing about the adapter.
- M4.6: identity has two levels. `endpointId` is what a reader sees and what the Observation stores, keeping parameter names as the adapter wrote them. `identityKey` erases them, so a source `:invoiceId` and a crawl's derived `:id` are recognized as one route. A merge comparing the written form would report each side as an endpoint the other did not have.
- M4.6: a segment becomes a parameter only when it is recognizably an identifier: all digits, a UUID, 24 or more hex characters, `INV-1001` or `user_42`, or a 20 character opaque token containing a digit. Never merely because it contains a digit, which is why `/api/v1/invoices` and `/oauth2/callback` survive intact. M6 diffs on this, so widening the rule renames every endpoint in every stored run.
- M4.6: a catch-all keeps its own marker in the identity key. `/files/:path*` and `/files/:name` match a different number of segments and are not the same route.
- M4.6: folding two records of one route unions their evidence and their observed fields, takes a determined `authRequired` over an unknown one, and falls back to `unknown` when two observations disagree rather than picking a side.
- M4.6: normalization is not applied inside the crawler. The crawl records what it observed and the fold happens once, over both sides, so the source and black box readings are normalized by the same rule. That is M4.7.
- M4.4 stopped the loop and was skipped by the user's decision on 2026-08-16. The module says to prefer `@prisma/internals` over regex for `schema.prisma`, and that package is not on the approved list in 04-CONVENTIONS.md, which is a dependency stop. Three options were put up: approve it as a runtime dependency, approve it as a lazily imported optional one, or correct the plan to read the schema textually like the other two adapters. The choice was to skip M4.4 for now and carry on; the options stay written down in the M4 Open questions. Consequence for the stage: the Observation has no entities from source at all, so `fieldMismatches` and `specifiedNotObserved` for an entity will have only the black box side to work from at M4.8.
- M4.5: the M4 Definition of Done says a black box degrade produces `origin: "inferred"`, but `EndpointOrigin` in 03-CONTRACTS.md is `source` or `blackbox`, and `inferred` is an entity origin. The crawler emits `blackbox` for endpoints, per the contract. The same DoD line already needs restating for the fixture being probed black box, so both corrections belong in one edit at the stage boundary.
- M4.5: the crawler records a path that answered 401 or 403 but not one that answered 404, 405, or 410. A refusal proves the route is there; a dead link is evidence against it, and recording one would invent a route the target refuses to serve.
- M4.5: `authRequired` stays `unknown` even on a 401. The crawl is authenticated, so a refusal says this actor may not have it, not that credentials are required. Only a refusal without credentials establishes that, and observing it is a check's job.
- M4.5: `actorVisibility` is left empty even though the crawling actor plainly saw the page, because 03-CONTRACTS.md reserves that field for checks and says a probe-only run reports every actor untested.
- M4.5: the crawler produces no entities. A crawl sees response field names, which are recorded as `responseShape.fields`, but never a model name, and naming an entity from a response would be a guess dressed as a schema reading.
- M4.5: static assets get HEAD rather than GET, and are recorded with the method that was issued. Reading the method off what was actually sent keeps the Observation a record of what happened; M4.8 already plans to lower asset routes to info severity.
- M4.5: a JSON body is scanned for string values that look like same-origin paths, so an API index listing its own routes is followed. Without that a JSON-only target stops at the seed, since there are no links to follow.
- M4.5: the crawl takes a narrow `CrawlSession` rather than the whole `ActorSession`. An `ActorSession` satisfies it structurally, and nothing in the probe should be able to reach a credential.
- M4.5: exhausting the page budget produces a warn note naming the ceiling and how many paths were left. An Observation that stopped early and does not say so reads as an application with nothing more in it.
- M4.3, corrected in the plan at the stage boundary: the M4 Definition of Done command was `pnpm --filter @qai/core test -- probe diff` and filtered nothing. pnpm forwards the `--` to the script, so vitest runs as `vitest run "--" "probe" "diff"` and reads everything after it as passthrough rather than as filename filters. The whole core suite ran instead, 32 files and 794 tests. Dropping the `--` filters correctly, 9 files and 283 tests, and the module now says so. Same class as the M1.2 trap: a Definition of Done command that quietly does not do what it says. Both forms were run at every task in this stage.
- M4.3: mount prefixes are resolved across files. A router declaring `/invoices` that the app mounts at `/api` is recorded as `/api/invoices`, because recording the declared path alone puts an endpoint in the Observation the target does not serve, and that costs two structural findings rather than one: the specified path missing and the wrong path undeclared.
- M4.3: a router file nothing mounts still contributes its endpoints, with an info note saying the path may be missing a prefix. Dropping it would hide a route that exists; claiming a prefix nobody could find would be a guess.
- M4.3: a receiver counts as a router when it was assigned from `express()` or `Router()` in the same file, or when its last dotted segment is `app` or `router`, which covers `function routes(app)` and `this.app`. A registration also has to pass a handler argument, so `client.get('/api/invoices', config)` and `request(app).get('/x')` are not routes. Both forms have tests.
- M4.3: `app.all('/x', h)` produces one endpoint with method `ALL`, not eight. Expanding it would invent endpoints; dropping it would lose one. Worth confirming at M4.7, since a black box observation of the same route reports a concrete method and the merge will have to reconcile `ALL` against it.
- M4.3: a route registered on a path the adapter cannot read, a template literal for example, produces a warn note naming `file:line` and no endpoint.
- M4.3: Express has no directory convention, so the adapter reads every source file rather than a glob of route files. Test files, type declarations, and the usual build directories are excluded, since a route registered inside a test is not a route the target serves.
- M4.2: adapters are tested against synthetic route trees in a temp directory, not a scaffolded Next.js app. The adapter reads a directory convention and a few export forms; a real application would add hundreds of files without covering anything more.
- M4.2: method patterns are anchored to the line start, so `// export async function DELETE()` in a comment and `"export function PUT()"` in a string do not become endpoints. Both have tests.
- M4.2: a route file exporting nothing recognizable produces a warning note and no endpoint. Inventing a route from a filename would put something in the Observation the application does not serve.
- M4.2: confidence constants revised from the M4.1 guess. Source only is now `high`, because an adapter read the declaration rather than deducing it; black box only is `low`, since traffic inference can miss an unlinked route and can split one route into two.
- M4.1: `ProbeMode` was briefly redefined in `probe/types.ts` when the contracts already export it. Typecheck caught the ambiguous re-export. Worth remembering as a category: anything the contracts already name is imported, never restated, and the barrel makes a duplicate a compile error rather than a silent divergence.
- M4.1: an adapter whose `detect` throws has simply not recognized the root; an adapter whose `scan` throws produces an error note and the other adapters still run. A probe that fails partially produces a partial Observation, per the failure posture in 02-ARCHITECTURE.md.
- M4.1: more than one adapter recognizing a repository is normal rather than a conflict. A Next.js app with a Prisma schema is two adapters describing different things.
- M4.1: the probe is not given the spec. Matching happens in the diff, because a probe that knew what it was looking for would find it, and an Observation shaped by the spec cannot support a finding that the two disagree.

- M3.9: D2 and D3 are now implemented in `fixtures/ledger`, so the catalog has D1, D2, D3 and both negative controls. D4 through D7 remain deferred to the stages that build the checks consuming them. Ledger level tests hold D2 and D3 in place the same way they hold D1.
- M3.9 placement: the integration test lives in the repository root `test/`, not in either package. 02-ARCHITECTURE.md says core depends on nothing here and `fixtures/ledger` likewise, and an integration test inside either one would quietly make that false. The root is the only place legitimately allowed to depend on both.
- M3.9: the test pins both directions. Defects on gives exactly three failures and both controls passing; defects off gives zero failures and everything passing. A check family that always answered the same way would fail one of those two, so neither assertion can pass vacuously.
- M3.9: D2 returns rows under an `invoices` key rather than a bare array, deliberately, so a list check that only understood top level arrays would miss it.
- M3.8: severity is deny high, allow medium, and deliberately does not scale by which fields came back. Scaling by field sensitivity would look like a refinement but means guessing the cost of an exposure from field names, which the spec author is better placed to judge than the tool. A test asserts severity is unchanged when the resource declares no fields.
- M3.8: a suggested fix lives inside `detail`, prefixed `Suggestion:`. The CheckResult contract has no field for one, and adding it would be a contract change. If a report wants to render suggestions separately, that is the contract question to raise.
- M3.8: a passing check carries no reference and no suggestion. There is nothing to look up and nothing to fix, and a suggestion attached to a pass reads as a finding to anyone skimming.
- M3.8: `FORBIDDEN_FINDING_TERMS` is exported and asserted per term against real finding output, so the Do Not on naming vulnerability classes is enforced rather than remembered.
- M3.8: plans now carry `locationRef` from an Observation `handlerRef` when a probe supplied one, so a finding cites a file rather than a request. Nothing supplies it until M4.
- M3.7: the runner takes mutation permission as an argument from the M2 gate rather than recomputing disposability itself. One interlock, not two implementations of one. Absent permission means refused, so the safe answer is the default rather than something a caller has to remember to ask for.
- M3.7: `runAccessChecks` orders by plan, so handing it mutating checks first still runs every read first. A test sorts the plans backwards to prove the ordering does not come from the caller.
- M3.7: a failed reset stops the remaining mutating checks and reports them inconclusive naming the reset failure. Continuing would run them against a target in an unknown state, and a verdict from that describes nothing.
- M3.6, Q5 answered by implementation: a deny list rule asserts the absence of foreign rows. Rows must be present and identifiable for a pass. An empty list is inconclusive, since the endpoint scoping correctly and the dataset simply being empty are not distinguishable from outside. A row whose ownership cannot be judged also blocks a pass, because claiming correct scoping on the strength of rows nobody could read is the same mistake in a quieter form.
- M3.6: row extraction reads a top level array, or the first own property holding an array of objects, which covers `{invoices: []}` and `{data: []}` without guessing at key names. Returning undefined for an unreadable shape is deliberate: not recognizing the shape and the list being empty are different facts and get different verdicts.
- M3.6 test bug worth remembering: a default parameter swallows an explicitly passed `undefined`, so a test meant to exercise the no-condition path was silently exercising the with-condition path and failing for the right reason by accident. Call the function directly when the point of the test is that an argument is absent.
- M3.5 design not given by the plan, needs review: the module states the allow case in prose, not a table, so the assessment was designed here. 2xx is a pass whatever the body, since the assertion is only that the actor was let through and a 204 on a permitted update is a success with nothing to return. 401, 403, and 404 fail. 5xx and any other status are inconclusive, because a finding on an allow rule claims a legitimate user is being refused and the tool cannot tell a malformed request of its own making from a broken target.
- M3.5: the runner sends nothing when no suitable record can be identified. Requesting an id that was never seeded returns a 404 that looks exactly like correct enforcement, so the check is inconclusive and the request is never made. Two tests assert the request list stays empty.
- M3.5: `AccessCheckPlan` gained `resourceFields`, resolved from the spec entity at planning time, so a verdict does not look the entity up again per response.
- M3.5: a test asserts no finding text contains idor, vulnerability, exploit, injection, cve, or owasp, per the module's Do Not on naming vulnerability classes.
- M3.4 addition beyond the table, worth confirming: a 401, 403, or 404 that still returns resource fields is treated as a fail, not a pass. The table's first row says refusal statuses pass "with no resource fields in body", so this reads the qualifier as load bearing rather than descriptive. A refusal that returns the record is not a refusal.
- M3.4: a status the table does not name, including 3xx and 4xx outside 401/403/404, is `inconclusive`. The table covers refusal statuses, 2xx, 5xx, and transport errors; anything else is not evidence of either outcome.
- M3.4: resource fields are matched by name at any depth, so an enveloped or listed record still counts as returned. Matching requires parsed JSON, so an unparseable body never matches on a substring.
- M3.3 bug worth remembering: attribute lookup read inherited properties, so a condition naming `Invoice.constructor` resolved to the `Object` constructor and was compared as data, returning `false` rather than `unknown`. Own properties only now. A condition should read the target, never the runtime, and the two tests that caught it were written to assert exactly that.
- M3.3: evaluation is three-valued. What cannot be resolved is `unknown`, never `false`. Treating a missing attribute as a failed match would silently pick the wrong record and then report a confident verdict about it.
- M3.3: an undecidable condition does not fall through to an arbitrary record. `selectCandidate` returns a reason, and the caller turns that into `inconclusive`, per the module note that testing access control against a record that does not exist proves nothing.
- M3.2 cross-module edit, needs a PR note: `TargetConfig` gained a `resources` section holding route templates and seeded instances. M2 owns that file. It is here because M3 resolves a resource to a URL and refuses to guess one, and M4, which would discover routes, is S4. When the probe lands, the Observation takes precedence and this becomes the fallback the module already describes.
- M3.2: a rule that cannot be planned comes back in `unplannable` with a reason from the contract's closed set, not dropped. An unplanned rule that vanished would read as coverage.
- M3.2: action to method mapping is fixed, read and list to GET, create to POST, update to PATCH, delete to DELETE. Not stated anywhere in the plan; confirm, particularly PATCH over PUT for update.
- M3.2: severity on failure is deny high, allow medium, which M3.8 may refine. A deny that fails means something forbidden is reachable; an allow that fails means a feature is broken, which matters less to this audience.
- M3.1: the registry converts a thrown runner into `inconclusive` rather than letting it escape. Rule R4 stated as a convention would leave every runner to remember it; here it is enforced in the one place every check passes through. A test asserts a throwing check does not remove the checks after it.
- M3.1: `runAll` orders non-mutating checks before mutating ones by plan, not by caller discipline, so a mutating check cannot land mid-batch and change what later checks observe.
- M3.1: check ids are content-hashed over type, requirement, rule, actor, and action. Two actors against one rule are two checks. Anything that changes identity renames the check and breaks M6's run comparison, so the hash inputs are deliberately narrow.
- M3.1: lint now stops `packages/core/src/checks/**` importing `llm/` by path, which is the M3 Definition of Done item. Verified by probe: a check importing `../../llm/judge.ts` errors, the same import from `spec/` passes. The model client patterns already covered the direct route; this covers importing a helper that wraps one.
- M3.1: `pnpm --filter @qai/core test -- access` exits 1 with "No test files found" until `checks/access/` exists at M3.2. Expected at this task; it is a module level Definition of Done, not a per task one.

- Post-merge fix, branch `fix/entity-field-order`: `sameEntity` in the loader compared entity fields by array position, so two spec files agreeing about an entity but declaring its fields in a different order failed to load as a conflicting redefinition. `hash.ts` already sorted fields before hashing, so the two disagreed with each other: the loader called them different, the hash called them identical. Found by Copilot's review on PR #2. The fixture spec hash is unchanged, `sha256:5a31b527c6c1...`.
- Worth watching for the same class of bug elsewhere: any place that compares two authored collections should say whether order is meaningful. It is for access rules, since ordinal position derives an identifier. It is not for entity fields, actors, or entities.

- M2.7: `createTargetContext` is synchronous, while the Public API in modules/M2-target.md declares it returning a Promise. Nothing it does is asynchronous: credential resolution reads a passed-in map, and the only filesystem call is an existence check. Flagged for review; making it async to match the signature would be ceremony around nothing.
- M2.7: the capability report states available capabilities as well as unavailable ones. A reader seeing only warnings cannot tell a clean setup from an unreported gap.
- M2.6: the disposability gate requires both `disposable: true` and a `resetCommand`, even to seed. Seeding a target that cannot be restored leaves someone with a dirty database and no way back. Not overridable by flag; an interlock the person in a hurry can reach past is not an interlock.
- M2.6 platform trap: with `shell: true` the child is the shell, and killing it does not take the command with it, reliably not on Windows. A timeout now resolves at the deadline rather than waiting for a close event, with a best effort tree kill (`taskkill /t /f` on Windows, SIGKILL elsewhere). Before the fix one test took 10.5s and the suite took 11.3s; it is back to 1.5s.
- M2.5 found a real leak in M2.4, worth remembering: redaction matched `authorization` and `cookie` only in header position, so a target that echoed the credential back in its response body had it written to disk unredacted. The always-redacted names now apply to body field names too. Over-redacting a body field innocently named `cookie` is visible in the `redactions` list; under-redacting is a leak nobody notices.
- M2.5: `ActorSession.request` is the only way to reach the target, and it always captures evidence, including on a transport failure. Rule R7 made structural: there is no method that requests without recording.
- M2.4 contract question, needs review: Evidence in 03-CONTRACTS.md has `response.bodyRef` and no place for a request body, but modules/M2-target.md says the request body is captured. Rather than add a contract field, `bodyRef` points at a document holding both under `request.body` and `response.body`. If an emitter needs the response body alone, that is a contract change, not a local fix.
- M2.4: two files per record, `EV-xxxx.json` for the bodies and `EV-xxxx.record.json` for the Evidence itself. A test asserts those are the only two files, so nothing else can be left holding an unredacted copy.
- M2.4: a body that is not JSON passes through unredacted. Redaction matches field names, and guessing at structure in an opaque body would either miss the field or corrupt the evidence. A caller needing a guarantee over opaque bodies should not be storing them.
- M2.4: an invalid `extraPatterns` regex is dropped and reported rather than thrown. A bad pattern in a config should not take down a run that would otherwise produce findings. The inline `(?i)` flag YAML configs tend to carry is translated to the JavaScript flag.
- M2.3: `RequestSpec.method` is a closed union, not a string. The probe issues GET-equivalent traffic and mutating checks declare themselves, so an arbitrary method reaching a target should fail to compile.
- M2.3: a transport failure is a returned value, not a throw, so M3 can turn it into `inconclusive` rather than losing the run. No retry and no backoff, per the module's Do Not.
- M2.3: `fixedDeps` lives in `target/deps.ts` beside `systemDeps`, not in a test helper. Every module taking `Deps` needs the same fake, and three slightly different ones is how golden files start disagreeing.
- M2.3: round trip tests start a `node:http` server inside the test on an ephemeral loopback port. Core does not depend on `fixtures/ledger`, and R9 rules out anything remote.
- M2.2: an actor whose variable is unset is dropped, not given a blank credential. A blank credential produces a 401 that reads as a finding rather than a configuration mistake. An empty or whitespace only variable counts as unset for the same reason.
- M2.2: `resolveCredentials` takes the environment as an argument. Core never reads `process.env`, per 02-ARCHITECTURE.md and rule R6, so the CLI will pass it in.
- M2.1 addition, needs review: `actors[].attributes` is not in the proposed config in modules/M2-target.md, and without it the condition grammar cannot be evaluated at all. `Invoice.org_id != actor.org_id` needs a value for `actor.org_id`, and nothing in the proposed shape supplies one. Added as a string map per actor. M3 will need it; confirm the shape before it does.
- M2.1 judgment call: the proposed config shows only `bearer`, but M2.5 has to implement `cookie`, `header`, and `none`. Designed as `cookie: {name, valueEnv}`, `header: {name, valueEnv}`, `none: {}`, keeping the rule that config names a variable and never holds a value.
- M2.1: `target.disposable` defaults to false. A target is not disposable until someone writes it down. Invariant I7.
- M2.1: literal secret detection runs before schema validation, so the message can name the fix rather than reporting an unrecognized key. Keys caught: token, password, secret, apiKey, value. A test asserts the rejected secret never appears in the error.
- M2.1: `tokenEnv` and `valueEnv` are regex-constrained to `^[A-Z][A-Z0-9_]*$`, so a value pasted where a variable name belongs fails on shape even if the key is right.
- Q2 and Q3 are listed unresolved in 07-DECISIONS.md but modules/M2-target.md says both proposals are implemented as written, the same pattern M1 used for Q4. Treated as directed, not as a stop.

- M1.1 conflict, plan vs code: the task says scaffold `packages/core` with tsup, vitest, and a strict tsconfig, but S0.2 already did all three. Reduced to what was actually missing: the `contracts/` directory, `zod`, and a package level `test` script so the module's Definition of Done command resolves.
- M1 Definition of Done runs `pnpm --filter @qai/core exec tsx scripts/validate-fixture-spec.ts`, but `tsx` is not in the approved dependency list in 04-CONVENTIONS.md. The repo already runs TypeScript directly through Node's type stripping for the ledger. Decide at M1.5 or M1.8: add `tsx` with approval, or correct the plan to use `node --experimental-strip-types`.
- Q4 is listed unresolved in 07-DECISIONS.md and blocks M1, but `modules/M1-spec.md` supplies the full grammar and instructs implementing the proposal while flagging anything the fixture spec cannot express. Treated as directed rather than as a stop. Any gap found at M1.8 goes in the M1 Open questions section.
- zod resolved to 4.x. 04-CONVENTIONS.md approves `zod` without pinning a major.
- M1.2: `pnpm --filter @qai/core test` was passing by running zero tests. Vitest walked up to the root config, whose include patterns are relative to the repository root, and matched nothing from inside the package. Core now has its own `vitest.config.ts` and its test script dropped `--passWithNoTests`. Worth checking the same trap if cli, action, or ledger ever get a Definition of Done command.
- M1.2: `allowImportingTsExtensions` moved into `tsconfig.base.json`. Relative imports carry explicit `.ts` extensions repo wide, matching what the ledger already did. Every project sets `noEmit` and is bundled by tsup, so no `.ts` specifier reaches output. The redundant setting in `fixtures/ledger/tsconfig.json` is now a no-op and can be dropped whenever that file is next touched.
- M1.8: Q4 answered by use. The proposed grammar expressed every access rule the fixture spec needed, 4 conditions across 8 rules. Nothing required disjunction, ordering comparison, or negation. The rules that carry no condition are unconditional denials, for example anonymous update, where a condition would add nothing.
- M1.8: 15 requirements, 3 actors, 4 entities, 8 access rules, 14 acceptance criteria, 4 parsed conditions, 1 warning (REQ-007, the intended D7 coverage gap). Hash `sha256:5a31b527c6c1...`.
- M1.8: `condition.ts` no longer uses TypeScript parameter properties. Node's strip-only mode refuses them, which broke `scripts/validate-fixture-spec.ts`. Vitest and tsup use esbuild and accepted them, so the suite was green while the script could not run at all. Worth remembering: passing tests do not prove core runs under plain `node`.
- M1.7: `schema/` is in `.prettierignore`. The generated file is asserted byte for byte, and `pnpm format` rewrote it, failing the test for a reason nobody could act on.
- M1.7: regenerate with `pnpm --filter @qai/core generate:schema`. The drift guard was confirmed to fire: editing the committed file makes the suite fail, restoring it makes the suite pass.
- M1.7: core's tsconfig dropped `rootDir` and `outDir` and now includes `scripts/`. It typechecks only, tsup owns the build, and pinning rootDir to `src` rejected the generator.
- M1.7: the generator runs under `node --experimental-strip-types`, not `tsx`. Still open whether the M1 Definition of Done command should be corrected to match; see the note above.
- M1.6 judgment call: access rule and acceptance criterion order is kept in the canonical form, while actors, entities, and requirements are sorted. Ordinal position determines a derived identifier, so swapping two rules renames them, and a renamed check is a different check to M6 even when the assertions are unchanged. Sorting rules would have hidden that.
- M1.6: hand-written rule and criterion ids are excluded from the hash entirely, not just derived ones. Naming a rule is not changing what it asserts. 05-BUILD-ORDER.md says only "exclude derived identifiers", so this is slightly wider; flagged for review.
- M1.5 deviation, needs review: parsed condition ASTs are returned in a `conditions` map keyed by access rule id, not attached to the rule. Putting the AST on the rule would add a field to the Spec contract, which is a stop condition. This widens the `loadSpec` return in modules/M1-spec.md from `{ spec, hash, diagnostics }` by one field. Smaller correction than a contract change, but the module file should be updated to match.
- M1.5: `loadSpec` returns `{ spec, diagnostics, conditions }`. The `hash` field named in the module's public API arrives with M1.6, which owns canonicalization and hashing.
- M1.5 judgment calls not covered by the plan: a `specVersion` mismatch across merged files is an error, since they are different contract versions. A differing `name` is a warning and the first file's name wins. Neither case is described in modules/M1-spec.md.
- M1.5: files are glob-resolved then sorted, so merge order, derived identifiers, and diagnostic order do not depend on filesystem ordering. Rule R6.
- M1.4: the Q4 grammar as implemented has no disjunction, no ordering comparison, and no negation of a whole condition. Only `==`, `!=`, `in`, `not in`, joined by `and`. Check at M1.8 whether the fixture spec needs anything outside that; if it does, Q4 needs a human answer rather than a wider parser.
- M1.4: two identifiers separated by a dot is the only reference form, so `actor.org.id` is rejected. A bare identifier is rejected too rather than being read as a string, because `Invoice.org_id == admin` is far more likely a mistyped reference than a literal, and guessing would turn an authoring mistake into a silently wrong check.
- M1.4: `parseCondition` returns errors as values. A malformed condition becomes a load diagnostic naming the file and requirement, rather than an exception unwinding the whole load.
- M1.3: three shapes in 03-CONTRACTS.md are shown in the examples but never named as enums. Chosen closed sets, flagged for review: `ObservationNote.level` as info/warn/error, `actorVisibility` values as untested/visible/refused/error, and structural entry `kind` as entity/endpoint/field. Only `untested` appears in the document. If M4 or M7 needs a value outside these, that is a contract change and a stop.
- M1.3: `authRequired` has no default. Omitting it is a parse error rather than an assumed value, since the contract says never to default it to `true`.
- M1.3: `packages/core/src/index.ts` now re-exports the contracts, so the public API matches the one in modules/M1-spec.md.
- M1.2: every spec schema is `.strict()`. A key the schema does not know is an error rather than a silent drop, since a misspelled `acceptanceCriteria` would remove every check from a requirement and still report coverage.

- S0 has no owning module file. 05-BUILD-ORDER.md points at 06-TESTING.md for fixture app requirements.
- S0 tasks are derived from the S0 prose in 05-BUILD-ORDER.md, which lists no numbered tasks.
- Branch is `chore/s0-skeleton`, per the 04-CONVENTIONS.md rule that setup work with no functionality uses `chore/`.
- `origin` (github.com/Bomoga/QAi) has no branches yet, so bootstrap `git pull` was a no-op.
- pnpm was absent on this machine; installed 11.21.0 via `npm install -g pnpm` (corepack enable needs admin).
- Repo-local git identity was set to Adrian Morton <atmorton04@gmail.com>; none was configured.
- A commit cannot contain its own hash, so each task's hash is backfilled at the top of the next task's commit.
- TypeScript is pinned to the 6.x line. typescript-eslint 8.x refuses to load against TS 7.0; unpin once it supports TS >= 7.1 (typescript-eslint issue 10940).
- `docs/plan/` is in `.prettierignore`. Prettier reflowed the imported plan on first run; the plan is source of truth and tooling must not rewrite it.
- The R1 model boundary was verified by probe, not just by config reading: an `openai` import outside `packages/core/src/llm/` errors, the same import inside it passes.
- S0.2: `@qai/cli` has no `bin` entry yet. The command surface, flags, and exit codes belong to M8 and land in S6; `npx qai` should not resolve until it does something.
- S0.2: all three package index files export nothing. The public API of core is assembled by later modules, and a surface reaching past `src/index.ts` is reaching into private code.
- S0.2: `ignoreDeprecations: "6.0"` is set in `tsconfig.base.json` only because tsup's dts build injects the deprecated `baseUrl`. Drop it when tsup stops.
- S0.3: CI runs typecheck, lint, format:check, test, build on push to main or dev and on every pull request. The `pull_request` branch filter was removed during S1: it left PR #2, stacked on the S0 branch, with no checks at all. Push stays filtered to main and dev so feature branches are not checked twice.
- S0.3: the workflow's green run cannot be demonstrated until the branch is pushed. That evidence belongs to the S0 exit criterion at the stage boundary.
- S0.4: only D1 is implemented. D2 through D7 and the two negative controls beyond N1 land with the stages that build the checks consuming them. D1 alone is what the S0 exit criterion asks for.
- S0.4: `spec/ledger.spec.yaml` does not exist yet. 06-TESTING.md lists it as a fixture requirement, but there is no schema to validate it against until M1, so writing it now would produce a file nothing can check.
- S0.4: the ledger has no runtime dependencies. It is `node:http` and nothing else, which also keeps its boot time inside the three second requirement (measured 1.09s).
- S0.4: the ledger runs under Node's TypeScript stripping, so its imports carry explicit `.ts` extensions and its tsconfig sets `allowImportingTsExtensions`.
- The `no-restricted-imports` rule key is shared by the model boundary and the package direction rules, so every eslint scope restates every group that applies to it. A later block replaces the rule outright rather than merging.

## Known issues, not blocking

- Resolved at M5.7: `--no-playwright` was removed from the M5 Definition of Done rather than replaced. It was never a vitest option, and an environment variable would have put core in the environment against rule R6. The launcher is injected by the caller and absent by default.

- The Definition of Done test command was corrected in every module file, M2 through M9, not only M4. Each carried a `--` before its filter names, which pnpm forwards to the script so vitest reads them as passthrough arguments and filters nothing. Verified for the two modules that have tests today: `test target evidence` runs 151 tests, `test access` runs 159, where the old form ran the whole suite of 850.

- The GitHub CLI was installed during S4, `gh` 2.97.0 via winget, user scope. It authenticates as `Bomoga` with a fine-grained token whose repository access had to be widened twice, first to include this private repository at all, then to give Pull requests read and write. The token has no Checks permission, so `gh pr checks` fails and CI status has to be read on the pull request page.

- CI emits one warning annotation: the v4 actions target Node.js 20 and are being forced onto a newer runtime. Bump `actions/checkout` and `actions/setup-node` to v5 when convenient. It does not affect the result.
- `origin/main` does not exist. Only `dev` and the stage branch are pushed. Create `main` before the first release.

## Blocked

- none. The M7.7 blocker was cleared on 2026-08-18: the human authorized stopping the
  leftover ledger, and confirmed the mid-session HEAD move was their own accident rather
  than a second session.
