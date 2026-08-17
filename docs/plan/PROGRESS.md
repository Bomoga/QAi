# Progress

Updated: 2026-08-17T03:10:00Z
Current stage: S5
Next task: M5.3

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
- [x] M5.9 the `when` vocabulary and planBehavioralChecks (commits 4fd00c1 and the one backfilled below), added by decision, out of order because M5.8 needs it
- [ ] M5.3 persisted state assertions via follow-up reads
- [ ] M5.4 the Judge interface in llm/
- [ ] M5.5 Playwright fuzzy runner with the selector policy
- [ ] M5.6 verdict mapping, one test per row
- [ ] M5.7 graceful degradation when Playwright is absent
- [ ] M5.8 integration test over D4, needs the fixture spec rewritten into both vocabularies first
- Exit criterion: deterministic acceptance criteria pass and fail correctly against `fixtures/ledger`; at least one fuzzy criterion runs under Playwright and is labeled model assisted in the report; skipping Playwright degrades to `unverified` with a reason, never to an error
- **Raised at M5.1 and needing a decision before M5.8: only 4 of the 14 deterministic criteria in `fixtures/ledger/spec/ledger.spec.yaml` can be expressed in the assertion vocabulary.** The fixture spec was authored at M1.8 in prose, before the vocabulary existed. Six of the ten are straightforwardly rewritable, for example "the body reports status ok" into `body.status equals "ok"` and "no response body contains a token field" into `body omits field User.token`. Four are genuinely outside the table: the two "the invoice is unchanged" clauses need before and after state, "every returned invoice has org_id equal to the caller organization" is a per-row comparison against an actor attribute, and AC-013-01 compares the status of two different requests. The plan's own instruction covers this, warn and suggest a rewrite or `mode: fuzzy`, so the rewrite belongs with M5.8. Nothing pins the fixture spec hash as a literal, so rewriting the clauses is safe; `fixture-spec.test.ts` only asserts the hash is stable across loads.

## S6. Report and CI (M7, M8)

- [ ] not started

## S7. Store and delta (M6)

- [ ] not started

## S8. Corpus run

- [ ] not started

## S9. Buffer and demo

- [ ] not started

## Notes carried forward

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

- `--no-playwright` in the M5 Definition of Done is not a vitest option. pnpm forwards it and vitest exits with `Unknown option --no-playwright`, so that command cannot work as written. Fixing the `--` does not fix this. How the playwright-absent path gets exercised is an M5 decision, most likely an environment variable the test reads, and it is recorded in the M5 Open questions.

- The Definition of Done test command was corrected in every module file, M2 through M9, not only M4. Each carried a `--` before its filter names, which pnpm forwards to the script so vitest reads them as passthrough arguments and filters nothing. Verified for the two modules that have tests today: `test target evidence` runs 151 tests, `test access` runs 159, where the old form ran the whole suite of 850.

- The GitHub CLI was installed during S4, `gh` 2.97.0 via winget, user scope. It authenticates as `Bomoga` with a fine-grained token whose repository access had to be widened twice, first to include this private repository at all, then to give Pull requests read and write. The token has no Checks permission, so `gh pr checks` fails and CI status has to be read on the pull request page.

- CI emits one warning annotation: the v4 actions target Node.js 20 and are being forced onto a newer runtime. Bump `actions/checkout` and `actions/setup-node` to v5 when convenient. It does not affect the result.
- `origin/main` does not exist. Only `dev` and the stage branch are pushed. Create `main` before the first release.

## Blocked

- none
