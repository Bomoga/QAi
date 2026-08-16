# Progress

Updated: 2026-08-15T12:00:00Z
Current stage: S1
Next task: stage boundary, S1 exit criterion needs the `qai validate` command from M8

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

- [ ] not started

## S3. Access checks (M3)

- [ ] not started

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
- S0.3: CI runs typecheck, lint, format:check, test, build on push to main or dev and on PRs into them. Feature branch pushes are covered by the PR event, not by a second push trigger.
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
