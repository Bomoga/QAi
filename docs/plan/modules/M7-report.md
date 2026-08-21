# M7: Run Assembly and Report Emitters

**Status:** complete
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

- **Resolved 2026-08-21. GitHub rejected the SARIF, and had always rejected it.** `renderSarif` gives a result a `physicalLocation` only when the check
  carries a `locationRef`, and a `logicalLocations` entry otherwise, which is what the
  module asks for and is valid SARIF 2.1.0. GitHub's ingester requires a physical
  location on every result, so it uploads successfully and then fails processing with
  `locationFromSarifResult: expected a physical location`, once per result. Against the
  fixture that is all fifteen: none of the nine failed checks carries a `locationRef`,
  because a black box probe has no source to point at, and the six structural entries use
  logical locations too. Nothing renders inline on a pull request, which is the whole
  point of emitting SARIF.

  Observed on 2026-08-21 on the run for PR #12, after the two CI fixes on that branch let
  the upload get far enough to be rejected on its merits.

  **This is the M7.4 open question arriving as a real failure.** Conformance is checked
  against a Zod transcription of the 2.1.0 schema, and the document passes it. Schema
  validity is not sufficient for this consumer, and no test in this repository can catch
  that, because the only authority is GitHub's own ingester.

  The fix needs a decision about what a sourceless finding points at, which is a product
  question rather than a rendering one. The obvious candidate is the spec file that
  declares the requirement, which `RunResult.spec.files` already carries: the finding is
  about a requirement and the requirement is written there, so a reviewer clicking an
  alert lands somewhere true. File level only, since the loader records no line numbers.
  A synthetic path would be worse, since a finding that points somewhere false is the
  false positive invariant I2 exists to prevent.

  **The human chose the spec file, and it is implemented.** Every result now carries a
  physical location: the check's own source reference when it has one, and the first
  entry of `spec.files` otherwise, with the logical location kept beside it. A run that
  recorded no spec file keeps a logical location alone and will still be refused, which
  is correct: there is nothing true to point at.

  Two limits worth stating. With several spec files this names the first, which is the
  run's spec rather than necessarily the file that declared that requirement; the
  requirement id is in the message and the logical location either way. And no test here
  can prove the document is ingestible, because the only authority is GitHub. What the
  tests pin is the property its refusal taught us, that every result has a physical
  location, asserted across a document carrying every kind of result at once.

- **M7.7 resolved 2026-08-18.** The blocker was the target, not the code: a leftover
  ledger held port 3000 and its state had already drifted from the seed. The human
  authorized stopping it. Both goldens are captured, and each was captured twice from a
  freshly restarted ledger to prove the file reproduces byte for byte. Capturing needs a
  restart between configurations and between captures, since the run writes to the
  target.
- **Two contract questions the goldens surfaced, neither blocking.** First, an access
  `detail` already ends with its own request, evidence, and suggestion references, so a
  rendered report repeats the evidence line. M3.8 recorded that a suggested fix lives
  inside `detail` because `CheckResult` has no field for one, and said a report wanting
  to render them separately should raise the question. This is that report. Second,
  REQ-006 comes back `check-error`, which reads as though something threw; nothing did,
  the entity simply does not exist to count. The closed set in `03-CONTRACTS.md` has no
  member for that and `assembleRun` falls back to `check-error`.
- **One observation for M5.** Every behavioral finding is titled "Acceptance criterion
  AC-001-01" while every access finding states what happened. Side by side in a rendered
  report the difference is stark, and the title is the first line a reviewer reads in a
  code scanning list.

- **M7.4, needs a dependency decision.** The Definition of Done says SARIF output
  validates against the published schema. Doing that literally means running a JSON
  Schema validator over `sarif-schema-2.1.0.json`, and no validator is on the approved
  list in `04-CONVENTIONS.md`, while rule R9 forbids a test fetching the schema at run
  time. What is implemented instead is `report/sarif-schema.ts`, a Zod transcription of
  the required property lists, the closed enumerations, and the types of every property
  this emitter writes, named against its published source. It catches a real
  non-conforming document: changing `version` to `2.1` fails eighteen tests. It is still
  a transcription rather than the schema. Three ways out: approve a JSON Schema validator
  as a dev dependency and vendor the published schema, accept the transcription and
  reword the Definition of Done to say so, or leave it and verify conformance once against
  a real consumer at the stage boundary, since GitHub rejects a malformed upload.
- **M7.4 deviation, minor.** The module says a result with no source uses a logical
  location naming the endpoint. `CheckResultRecord` has no endpoint field and the route
  appears only inside `detail` as prose, so a check's logical location names its rule and
  requirement instead. Parsing a path back out of a sentence would be a guess in the one
  place a reader is told where to look. A structural entry does carry an endpoint id and
  does name it.
- **M7.4 scope call, worth confirming.** SARIF results are failed checks plus the
  structural disagreements. `01-PRODUCT.md` calls those structural findings,
  `03-CONTRACTS.md` reserves a `structural` check type, and the module asks for one rule
  per check type, so the rule needs something to carry. Without them D6, the entity the
  spec declares and the application never built, never reaches the GitHub UI at all. The
  two entry kinds that carry no severity field take the defaults M4.8 exported for
  exactly this caller.
- **M7.3 deviation, needs review.** `TextOptions` carries an optional `Observation`.
  Section 2 of the text report is entity and endpoint counts by origin and confidence,
  and RunResult carries only `observation.ref`, so those counts are not derivable from
  the argument the Public API hands `renderText`. Putting them on RunResult is a contract
  change; taking the object the caller already holds is not. If the intent was that
  RunResult summarizes its own Observation, that is the contract question to raise, and
  the other three emitters would want it too.
- The Definition of Done's second command,
  `pnpm --filter @qai/cli exec qai check --format sarif`, cannot run until M8 builds the
  command surface. Same shape as every stage since S1. M7 is demonstrated through a
  script in `packages/core/scripts/` until then.
