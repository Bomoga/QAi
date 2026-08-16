# Progress

Updated: 2026-08-16T19:30:00Z
Current stage: S3
Next task: M3.9

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
- [x] M3.8 severity assignment and finding text (commit backfilled below)
- [ ] M3.9 integration test over D1, D2, D3, N1, N2
- Exit criterion: `qai check` against `fixtures/ledger` reports the seeded cross-owner leak as a high severity finding with request and response evidence and exits 1; fixing the fixture app makes it exit 0
- Known blockers on the criterion, same shape as S1: `qai check` is M8 and lands in S6, and the module Definition of Done names `pnpm --filter @qai/cli exec qai check`. The fixture also implements only D1, so D2 and D3 have to be added here before M3.9 can cover them.

## S4. Probe and structural diff (M4)

- [ ] not started

## S5. Behavioral checks (M5)

- [ ] not started

## S6. Report and CI (M7, M8)

- [ ] not started

## S7. Store and delta (M6)

- [ ] not started

## S8. Corpus run

- [ ] not started

## S9. Buffer and demo

- [ ] not started

## Notes carried forward

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

- CI emits one warning annotation: the v4 actions target Node.js 20 and are being forced onto a newer runtime. Bump `actions/checkout` and `actions/setup-node` to v5 when convenient. It does not affect the result.
- `origin/main` does not exist. Only `dev` and the stage branch are pushed. Create `main` before the first release.

## Blocked

- none
