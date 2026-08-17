# M7: Run Assembly and Report Emitters

**Status:** not started
**Owns:** `packages/core/src/report/`, run assembly in `packages/core/src/index.ts`
**Depends on:** M1, M3, M4, M5
**Depended on by:** M6, M8
**Read alongside:** `03-CONTRACTS.md`, `04-CONVENTIONS.md` output string style

## Purpose

Assemble check results, structural findings, and observation references into one `RunResult`, then project that object into every output format. RunResult is the public interface of this tool; everything else is a view of it.

## Inputs

- `CheckResult[]` from M3 and M5, `StructuralBlock` from M4, `Observation` from M4, Spec and hash from M1.

## Outputs

- `RunResult` per `03-CONTRACTS.md` section 3.
- Rendered text, JSON, SARIF 2.1.0, and JUnit XML.
- An exit code recommendation of 0 or 1, computed but not applied, since `core` does not exit. Codes 2 and 3 are error paths owned by the CLI, per `modules/M8-cli-ci.md`.

## Public API

```ts
export function assembleRun(input: AssembleInput): RunResult;
export function renderText(result: RunResult, opts: TextOptions): string;
export function renderJson(result: RunResult): string;
export function renderSarif(result: RunResult): string;
export function renderJunit(result: RunResult): string;
export function computeExitCode(result: RunResult, policy: ExitPolicy): 0 | 1;
```

## Implementation notes

**Verdict rollup, exactly as specified in the contract.** A requirement is `verified` only with at least one check and no failures. Any fail makes it `failed`. All inconclusive, or no checks, makes it `unverified` with a reason from the closed set. Implement this once, in one function, tested exhaustively over the combination table; it is the rule most likely to be reimplemented subtly differently elsewhere.

**Report ordering, which is the actual information design.** The text report leads with the map, not with a pass rate, because the demystification is the product and the verification is the evidence that the map is accurate.

```
1. Target and run header, including spec hash and commit
2. What was built: entity and endpoint counts, by origin and confidence
3. Disagreements: observed not specified, specified not observed, field mismatches
4. Findings, ordered by severity then by requirement id
5. Unverified, with a reason for each, as its own section
6. Summary: counts, coverage, and model assisted check count, always shown
```

Coverage is labeled as coverage and never as a pass rate. If a reader could mistake the number for a grade, the label is wrong.

**SARIF.** One `rule` per check type, one `result` per finding. Map severity to `level`: high and medium become `error` and `warning`, low and info become `note`. Populate `locations` from `locationRef` when source is available, otherwise use a logical location naming the endpoint. Include the request and response summary in `message.text`, redacted, so a reader in the GitHub UI sees the evidence without leaving the page.

Hand-roll the SARIF. The libraries are worse than the specification and exact control over what appears in the security tab is worth more than the saved hour.

**JUnit.** One `testsuite` per requirement, one `testcase` per check. Inconclusive maps to `skipped`, not to `failure`, so a coverage gap never masquerades as a pass or a failure in a CI dashboard.

**Text output.** Plain by default, color through `picocolors` when the stream is a TTY, never when piped. Findings are readable by an engineer who has not read the documentation: actor, method, path, status, observed fields, file reference. No vulnerability class names, no intent claims.

**Determinism.** Every collection is sorted before serialization. Two runs over identical inputs produce byte-identical JSON, which is what makes the golden files in `06-TESTING.md` viable.

## Tasks

1. **M7.1** Implement `assembleRun`, including the verdict rollup function and the closed reason set.
2. **M7.2** Implement `renderJson` with sorted, stable output; establish it as the golden format.
3. **M7.3** Implement `renderText` in the section order above.
4. **M7.4** Implement `renderSarif` and validate output against the SARIF 2.1.0 schema in a test.
5. **M7.5** Implement `renderJunit` with the inconclusive to skipped mapping.
6. **M7.6** Implement `computeExitCode` with `--fail-on` severity and the `--fail-on-unverified` opt-in.
7. **M7.7** Create golden `RunResult` files for the defective and fixed fixture configurations, and render tests against them.

## Definition of Done

```
pnpm --filter @qai/core test report
pnpm --filter @qai/cli exec qai check --format sarif > /tmp/out.sarif
```

**Corrected 2026-08-16.** This command previously carried a `--` before the filter
names. pnpm forwards that `--` to the script, so vitest is invoked as
`vitest run "--" "<name>"` and reads what follows as passthrough arguments rather
than as filename filters, which runs the whole core suite and passes for the wrong
reason. Without it the filter applies. `pnpm --filter @qai/core exec vitest run <name>`
is the explicit equivalent.

- SARIF output validates against the published schema.
- The text report displays `modelAssistedCheckCount` even when zero.
- Unverified requirements appear in their own section with a reason each, never folded into pass or fail.
- Rendering the same golden twice produces byte-identical output.

## Do Not

- Do not re-query the target or the store from an emitter. Emitters are pure functions of RunResult.
- Do not label coverage as a pass rate anywhere, including in help text.
- Do not exit the process from `core`, per rule R5.
- Do not emit unredacted evidence into any format, including SARIF message text.

## Open questions

- None blocking.
