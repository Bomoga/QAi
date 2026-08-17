# M5: Behavioral Checks

**Status:** not started
**Owns:** `packages/core/src/checks/behavioral/`
**Depends on:** M1, M2, M3 registry
**Depended on by:** M7
**Read alongside:** `03-CONTRACTS.md`, `04-CONVENTIONS.md` rule R1

## Purpose

Verify acceptance criteria. Deterministic criteria assert over HTTP and persisted state and are the bulk of the value. Fuzzy criteria drive a browser and are model assisted, tightly bounded by invariant I1, and deliberately thin.

## Inputs

- Spec acceptance criteria with `mode`.
- `TargetContext`, and optionally Playwright if installed.

## Outputs

- `CheckResult[]` of `type: "behavioral"`, each with `deterministic` set truthfully.

## Public API

```ts
export function planBehavioralChecks(spec: Spec, ctx: TargetContext): BehavioralPlan[];
export function runDeterministicCheck(plan: BehavioralPlan, ctx: TargetContext): Promise<CheckResult>;
export function runFuzzyCheck(plan: BehavioralPlan, ctx: TargetContext, judge: Judge): Promise<CheckResult>;
```

## Implementation notes

**Deterministic first and by default.** A criterion is deterministic when its `then` clause can be expressed as an assertion over status code, headers, response fields, or persisted state. Build these before touching a browser. Most useful criteria are deterministic once written carefully, and the spec author should be pushed toward that by the validation warnings.

**Assertion vocabulary for deterministic criteria**, a closed set, extended only with approval:

| Form | Asserts |
|---|---|
| `status is <code>` or `status in <list>` | Response status |
| `body contains field <Entity>.<field>` | Field presence |
| `body omits field <Entity>.<field>` | Field absence |
| `body.<path> equals <literal>` | Value equality |
| `record count of <Entity> is <n>` | Persisted state via a subsequent read |
| `response time under <ms>` | Latency, informational severity only |

Anything a criterion needs that this table cannot express is a load-time warning suggesting either a rewrite or `mode: fuzzy`, never a silent skip.

**Fuzzy checks, and the boundary.** A fuzzy check drives Playwright, captures a screenshot and the accessible text of the page, and asks a model whether the `then` clause is satisfied. The model returns one of `satisfied`, `not-satisfied`, `uncertain`, with a one sentence reason. Mapping is fixed: `satisfied` becomes `pass`, `uncertain` becomes `inconclusive`, and `not-satisfied` becomes `inconclusive` unless a deterministic assertion in the same criterion also failed, in which case the deterministic result decides.

Read that last mapping carefully. A model alone can never produce `fail`. This is invariant I1 expressed in code, and it means the worst a hallucination can do is under-report. Every fuzzy result sets `deterministic: false` and increments `modelAssistedCheckCount` so the report can state the extent of model involvement plainly.

**Selector policy, invariant I6.** Locate by ARIA role, accessible name, label text, or `data-testid`. Never by CSS class, tag structure, nth-child, or generated identifier. A regeneration that preserves behavior must not break the suite; if it does, the selector was wrong, not the app.

**Playwright is optional.** Lazy import inside the fuzzy runner. If unavailable, every fuzzy criterion is `unverified` with reason `capability-unavailable` and a one line note telling the user how to enable it. Missing Playwright must never produce an error or a non-zero exit.

**Mutating criteria** follow the same disposability gate as M3: serial, after non-mutating checks, inside the fixture boundary.

## Tasks

1. **M5.1** Implement the assertion vocabulary parser and its load-time validation warnings.
2. **M5.2** Implement the deterministic HTTP runner with evidence capture.
3. **M5.3** Implement persisted state assertions via follow-up reads as the configured owner actor.
4. **M5.4** Implement the `Judge` interface in `llm/`, returning only the three-value enum plus a reason string. Assert by type that it cannot return a `Verdict`.
5. **M5.5** Implement the Playwright fuzzy runner with the selector policy and screenshot evidence.
6. **M5.6** Implement the verdict mapping above, with one test per mapping row, including the case that proves a model cannot produce `fail`.
7. **M5.7** Implement graceful degradation when Playwright is absent.
8. **M5.8** Integration test against `fixtures/ledger` covering defect D4.

## Definition of Done

```
pnpm --filter @qai/core test behavioral
pnpm --filter @qai/core test behavioral --no-playwright
```

**Corrected 2026-08-16.** These commands previously carried a `--` before the filter
names. pnpm forwards that `--` to the script, so vitest is invoked as
`vitest run "--" "<name>"` and reads what follows as passthrough arguments rather
than as filename filters, which runs the whole core suite and passes for the wrong
reason. Without it the filter applies. `pnpm --filter @qai/core exec vitest run <name>`
is the explicit equivalent.

**`--no-playwright` is not a vitest option.** pnpm forwards it, and vitest then exits with
`Unknown option --no-playwright`, so the second command cannot work as written whatever is
done about the `--`. Verified 2026-08-16. Deciding how the playwright-absent path is
exercised belongs to M5; an environment variable read by the test is the obvious shape,
since vitest has no flag for it. Recorded in Open questions.

- D4 produces a medium severity deterministic finding.
- A fuzzy criterion runs, is labeled model assisted in the RunResult, and cannot produce `fail` under any tested model output, including adversarial ones.
- With Playwright uninstalled, the run completes, fuzzy criteria are `unverified`, and the exit code is unaffected.
- No file outside `llm/` imports a model client.

## Do Not

- Do not let a model output reach a `fail` verdict, under any flag, in any mode.
- Do not bind an assertion to DOM structure or a CSS class.
- Do not add assertion forms outside the table without approval.
- Do not build an elaborate browser harness. This module is deliberately thin; the value is in M3 and M4.

## Open questions

- None blocking. Flag any acceptance criterion in the fixture spec that the assertion vocabulary cannot express.
- Raised 2026-08-16 while correcting the Definition of Done commands: `--no-playwright` is not a vitest option, and vitest exits with `Unknown option --no-playwright` when it is passed. The capability-unavailable path still has to be exercised somehow; an environment variable the test reads is the obvious shape. Decide when M5 is implemented, and correct the command above to match.
