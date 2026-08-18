# M5: Behavioral Checks

**Status:** complete
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
| `status matches <request>` | The status another, non-mutating, request returns |
| `body contains field <Entity>.<field>` | Field presence |
| `body omits field <Entity>.<field>` | Field absence |
| `body.<path> equals <literal>` | Value equality |
| `body.<path> equals actor.<attribute>` | Value equality against the acting actor |
| `every <Entity> has <field> equal to <literal>` | Every row of a list response |
| `every <Entity> has <field> equal to actor.<attribute>` | Every row, against the acting actor |
| `every endpoint omits field <Entity>.<field>` | Every endpoint an Observation holds, as the acting actor |
| the same, followed by `as every actor` | The same, as every configured actor |
| `record count of <Entity> is <n>` | Persisted state via a subsequent read |
| `record <Entity> is unchanged`, optionally naming an instance | The record, read before the action and again after |
| `response time under <ms>` | Latency, informational severity only |

Anything a criterion needs that this table cannot express is a load-time warning suggesting either a rewrite or `mode: fuzzy`, never a silent skip.

**The two actor and row forms were added 2026-08-17, with approval, and are M5.10.** They
exist because the fixture spec carried two criteria the table could not state, and both
were being held as recorded coverage gaps. Three rules keep them from becoming a way to
guess:

- An actor attribute that is not configured makes the assertion unevaluable, never
  violated. A finding there would be about the configuration, dressed as a finding about
  the application.
- An empty list is unevaluable, not vacuously satisfied. That is Q5's answer for deny
  lists and it holds here for the same reason: an endpoint scoping correctly and a dataset
  that happens to be empty are indistinguishable from outside.
- A row that was read and lacks the field, or carries a different value, is violated and is
  named in the finding. Reading a row and finding it wanting is a fact.

A literal is compared strictly, since the author wrote its type down. An actor attribute is
compared loosely across string and number, exactly as `evaluateCondition` compares, because
configuration can only hold strings and a strict comparison would fail against every
numeric field.

**The before and after form was added 2026-08-17, with approval, and is M5.11.** It is the
only assertion that needs the runner to hold state across requests: the record is read
once before the action and once after, and the two readings are compared. It restores the
"and the invoice is unchanged" clause that M5.8-pre2 had to drop from two criteria.

- **Read as the configured state actor, never the acting one.** The criterion that most
  needs this acts as an unauthenticated caller, who cannot read the record at all. Reading
  state as the actor under test would report a scoping rule as a state fact.
- **A record present before and gone after is a violation.** Deletion is the largest change
  a record can undergo, and reporting it as an unreadable reading would lose the finding.
- **Everything else that could go wrong is unevaluable**: no state actor, no read route, a
  read that failed, a record that did not exist to begin with, or a body that will not
  parse. Only two readable records that differ is a violation, and the finding names the
  fields that moved.
- Two byte-identical bodies that are not JSON count as unchanged. Two differing ones do
  not count as changed, since the difference could be a rendered timestamp.

The state actor comes from `TargetConfig.stateActor`, added as M2.8 for this.

**The cross-request form was added 2026-08-17, with approval, and is M5.12.** It restores
what AC-013-01 originally claimed: that a refusal is indistinguishable from a read of a
record that never existed. Stating it as `status is 404` said something narrower and
would have reported a false finding against an application that answered 403 to both.

The reference is written in the `when` request vocabulary rather than a second grammar, so
a reader learns one table and a reference resolves its route, actor, and instance exactly
as an action does.

- **A reference that mutates is refused at parse time**, which makes the criterion
  unsupported with the clause named. An assertion that changed the target would break
  invariant I7 from inside a verdict, and that is not something to guard in a runner and
  hope every future caller keeps.
- **Only the status is compared.** The form says status and claims nothing else. Comparing
  two whole responses would be a far larger assertion wearing the same words and is a
  separate approval.
- The reference is issued after the action, as the actor its phrase names, and its
  evidence id joins the check's. A claim resting on a second request has to carry it.

This is the third form that issues traffic, after the record count and the before and after
comparison, so a `then` clause is no longer always a pure function of one response. Every
one of them is a read, and each names in its own words that it goes and looks.

**The endpoint sweep was added 2026-08-17, with approval, and is M5.12b.** It closes the
last of the fixture spec's gaps, AC-014-01, which claimed that no endpoint returns a user
token and had been split into one criterion per endpoint because nothing could quantify.

The quantifier is the risk, and it is bounded by three rules that can only cost a pass:

- **It ranges over the endpoints in the Observation**, never over an idea of the
  application. With no Observation, or none the sweep can read, the assertion is
  unevaluable. A universal over nothing was not asked; it is not satisfied.
- **An endpoint whose body could not be read blocks a pass.** Four clean readings and one
  unparseable body do not establish that every endpoint omits the field, which is the same
  refusal M3.6 made about a list of rows nobody could judge.
- **The count is stated in the result**, so a reader sees the scope of the claim rather
  than inferring it from the word every.

Only GET and HEAD are swept and a path with an unresolved parameter is skipped, so the
sweep cannot write and cannot request a route the target does not serve.

**The actor axis was added 2026-08-17 as M5.12c**, closing the second half of AC-014-01's
sentence. It is written out in the criterion rather than implied, because it multiplies
the request count: three actors across four observed endpoints is twelve readings from one
criterion, and an author should meet that number in the spec rather than in a run.

- The sweep runs as every actor in the session map, which holds the actors whose
  credentials resolved. One that did not is simply absent, so the result names the actors
  it swept as and a reader can see that the sweep covered who it could reach.
- With the axis and no actors at all, the assertion is unevaluable, on the same rule as an
  empty endpoint list.
- It earns the cost: a field the outsider can see and the owner cannot is invisible to a
  single-actor sweep. Verified by making the fixture hand a token to org-2 only, where the
  criterion without the axis passes over four clean readings and with it fails naming
  `/health as outsider`.

The honest limitation, which no rule removes: coverage is the crawl's coverage. An
endpoint the probe never reached was never checked, and the criterion says how many
readings it took rather than claiming the application has no other endpoints. The
structural diff is what reports an endpoint nobody specified; this reports a field nobody
should return.

**Request vocabulary for `when` clauses**, a closed set on the same terms, added
2026-08-16 by decision. `then` had a vocabulary and `when` had none, so nothing could
turn a criterion into a request: an access rule carries `actor`, `action`, and `resource`
as fields, while a criterion states `when` in prose.

| Form | Issues |
|---|---|
| `actor <id> reads <Entity>` | GET on the resource's read route, against its first configured instance |
| `actor <id> reads <Entity> <instanceId>` | GET on the read route, against the named instance |
| `actor <id> lists <Entity>` | GET on the list route |
| `actor <id> creates <Entity>` | POST on the create route |
| `actor <id> updates <Entity> <instanceId>` | PATCH on the update route |
| `actor <id> deletes <Entity> <instanceId>` | DELETE on the delete route |
| `actor <id> requests <path>` | GET on a literal path, for a route that belongs to no entity |

Routes and instances resolve exactly as they do for access rules: an Observation endpoint
first, then a configured route, then nothing. A `when` the table cannot express is the
same load-time warning as an unexpressible `then`, and the criterion is unplannable rather
than skipped.

The instance id is optional for reads so that a spec need not carry target data, and
available so that a criterion about a record that does not exist can name one. Create and
update send no body, matching what access checks already do; a criterion that needs a
request body is outside this table and needs approval to add.

**Fuzzy checks, and the boundary.** A fuzzy check drives Playwright, captures the accessible text of the page, and asks a model whether the `then` clause is satisfied.

**Screenshots are opt in, decided 2026-08-17.** This paragraph used to say a fuzzy check captures a screenshot as well. Rule R8 says never write an unredacted response to disk, and an image cannot be redacted the way a JSON body can, so a field marked `sensitive: true` would sit in the clear in a PNG. The accessible text, which does go through redaction, is the default evidence, and an image is written only when a caller passes a path. The module was wrong rather than R8. The model returns one of `satisfied`, `not-satisfied`, `uncertain`, with a one sentence reason. Mapping is fixed: `satisfied` becomes `pass`, `uncertain` becomes `inconclusive`, and `not-satisfied` becomes `inconclusive` unless a deterministic assertion in the same criterion also failed, in which case the deterministic result decides.

Read that last mapping carefully. A model alone can never produce `fail`. This is invariant I1 expressed in code, and it means the worst a hallucination can do is under-report. Every fuzzy result sets `deterministic: false` and increments `modelAssistedCheckCount` so the report can state the extent of model involvement plainly.

**Selector policy, invariant I6.** Locate by ARIA role, accessible name, label text, or `data-testid`. Never by CSS class, tag structure, nth-child, or generated identifier. A regeneration that preserves behavior must not break the suite; if it does, the selector was wrong, not the app.

**Playwright is optional.** Lazy import inside the fuzzy runner. If unavailable, every fuzzy criterion is `unverified` with reason `capability-unavailable` and a one line note telling the user how to enable it. Missing Playwright must never produce an error or a non-zero exit.

**Mutating criteria** follow the same disposability gate as M3: serial, after non-mutating checks, inside the fixture boundary.

## Tasks

1. **M5.1** Implement the assertion vocabulary parser and its load-time validation warnings.
2. **M5.2** Implement the deterministic HTTP runner with evidence capture.
3. **M5.3** Implement persisted state assertions via follow-up reads as the configured owner actor.
4. **M5.4** Implement the `Judge` interface in `llm/`, returning only the three-value enum plus a reason string. Assert by type that it cannot return a `Verdict`.
5. **M5.5** Implement the Playwright fuzzy runner with the selector policy and page text evidence, screenshot on request only.
6. **M5.6** Implement the verdict mapping above, with one test per mapping row, including the case that proves a model cannot produce `fail`.
7. **M5.7** Implement graceful degradation when Playwright is absent.
8. **M5.8** Integration test against `fixtures/ledger` covering defect D4.
9. **M5.9** Implement the `when` vocabulary above and `planBehavioralChecks`. Added 2026-08-16; numbered last to leave the existing task ids alone, but it has to land before M5.8, which needs plans to run.
10. **M5.10** Add the actor reference and the every row assertion forms, closing the coverage gaps M5.8-pre2 recorded. Approved 2026-08-17, after the stage was otherwise complete.
11. **M5.11** Add the before and after state form, restoring the clause two criteria had to drop. Approved 2026-08-17. Includes making an accepted write in `fixtures/ledger` actually write, without which the form's violated branch could never fire against the fixture.
12. **M5.12** Add the cross-request status comparison, restoring what AC-013-01 originally claimed. Approved 2026-08-17. The reference is stated in the `when` vocabulary and must not mutate.
13. **M5.12b** Add the endpoint sweep, closing AC-014-01 over endpoints. Approved 2026-08-17. It quantifies over an Observation and is unevaluable without one, so a run with no probe cannot pass it by checking nothing.
14. **M5.12c** Add the actor axis to the sweep, closing the rest of AC-014-01. Approved 2026-08-17. Written out in the criterion, since it multiplies the request count by the number of configured actors.
15. **M5.13** Configure an `impostor` actor carrying a token belonging to no user, closing AC-011-01. Approved 2026-08-17. A target change rather than a vocabulary one, and it makes a third credential variable mandatory for every script.
16. **M5.14** Point AR-011-01 at a resource the target serves, so the last unplannable access rule became a check. The S3 demonstration was re-run rather than left to drift.
17. **M5.15** Print coverage gaps with their reasons in the S3 demonstration rather than counting them. The reasons existed on every run since M3.2 and never reached a reader.

## Definition of Done

```
pnpm --filter @qai/core test behavioral
```

**Corrected 2026-08-16.** These commands previously carried a `--` before the filter
names. pnpm forwards that `--` to the script, so vitest is invoked as
`vitest run "--" "<name>"` and reads what follows as passthrough arguments rather
than as filename filters, which runs the whole core suite and passes for the wrong
reason. Without it the filter applies. `pnpm --filter @qai/core exec vitest run <name>`
is the explicit equivalent.

**The second command was removed at M5.7, and here is what replaced it.** It read
`pnpm --filter @qai/core test behavioral --no-playwright`. That is not a vitest option;
pnpm forwards it and vitest exits with `Unknown option --no-playwright`, so the command
could never have passed. Verified 2026-08-16.

No flag replaced it, and no environment variable either. Core never reads the
environment, per rule R6, so a switch would have to be read by the test and handed in,
which is what the tests already do: `run.test.ts` drives the absent path by configuring
no launcher, and drives the present path by injecting one. The absent path is not
simulated in the ordinary case, because this repository genuinely does not have
Playwright installed and `loadLauncher` is exercised against that. A test asserts that
premise, so the day the dependency is added, the suite says the premise changed rather
than passing over a path it stopped covering.

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
- **Coverage gaps recorded at M5.8-pre2, when the fixture spec was rewritten into both
  vocabularies.** Thirteen of sixteen criteria plan. The three that do not, and the two
  that plan only because a clause was dropped, are listed here so the reduction is
  reviewable rather than buried in a YAML comment.

  | Criterion | What cannot be expressed | How it stands now |
  |---|---|---|
  | AC-002-01 | A per-row comparison of a field against a caller attribute | **Closed at M5.10.** Both forms were approved and added, and the criterion now checks what the prose said |
  | AC-011-01 | A caller holding a token belonging to no user | **Closed at M5.13** by configuring the actor, not by adding a form |
  | AC-003-01 | "and the invoice is unchanged", which needs before and after state | **Closed at M5.11.** The clause is restored and the criterion asserts it |
  | AC-009-01 | The same clause | **Closed at M5.11**, same form |
  | AC-013-01 | A comparison against the status another request returns | **Closed at M5.12.** The criterion claims indistinguishability again, not a literal |
  | AC-014-01 | A universal over every endpoint and every actor | **Closed at M5.12b and M5.12c**, both axes, unevaluable without a probe |

  The table is closed. Every criterion this file narrowed or could not read at M5.8-pre2
  says what it originally said, and all 16 plan. That was not the plan: the gaps were
  recorded as permanent-looking coverage losses, and closing them one at a time turned out
  to be five assertion forms, one config field, and one configured actor.

  The last one is the one worth remembering, because it was never a vocabulary problem.
  AC-011-01 needed a caller holding a credential that belongs to nobody, and no such actor
  existed. Adding forms would never have closed it. A spec can only ask about identities
  the target is configured to present, which is a limit on coverage that no grammar
  reaches, and the honest signal was that the criterion stayed unplannable and said which
  half it could not read.
- **Resolved 2026-08-17 as M2.8:** `TargetConfig` now carries `stateActor`, validated to name a configured actor, with no default. Raised here at M5.11 because two assertion forms read persisted state and every caller was choosing an identity for itself. The field is M2's and the edit is recorded in that module; this note stays so the reason it exists is readable from the side that needed it.
- **Raised at M5.11: an accepted write in `fixtures/ledger` now actually writes.** It did not before, which made D3's catalog line only half true and meant a criterion saying the invoice is unchanged could never be false. The request carries no body, since the vocabulary issues none, so the applied change is a fixed increment to the total. If the catalog intended D3 to be an accepted write that changes nothing, this is a fixture change worth reverting, and the criterion should go back to asserting the status alone.
- **The real fuzzy path is still unexercised, decided at the S5 boundary 2026-08-17.** Every capture test drives an injected launcher, which defines the shape this code expects rather than proving Playwright provides it, and no judge has ever been backed by a model. The stage exit criterion was restated rather than met with a scripted judge, since a run labeled model assisted with no model in it is exactly the false green this tool exists to stop. The first run against a real browser with a real judge needs two things this repository does not have: Playwright installed, which is approved and merely absent, and a model SDK, which is not approved. See `05-BUILD-ORDER.md` under S5.
- **AC-005-02 is the one fuzzy criterion in the fixture,** added at M5.8-pre2 because the
  S5 exit criterion needs a fuzzy criterion to run and the spec had none. It asks whether
  the index page offers an administrative or debug route. `planBehavioralChecks` currently
  refuses every fuzzy criterion with `capability-unavailable`, which is the right answer
  when Playwright is absent and the wrong one when it is present. M5.7 owns that.
- **Raised at M5.4, decided here, worth confirming.** The task says to implement `Judge` in `llm/`, and rule R1's lint enforcement forbids anything under `checks/` importing `llm/` by path with `allowTypeImports: false`. The fuzzy runner is a check and needs the type, so a `Judge` declared in `llm/` is unimportable by its only consumer. The interface therefore lives in `checks/behavioral/judge.ts`, beside the consumer, and `llm/` holds the implementations that satisfy it. Neither rule was weakened. The alternative was relaxing `allowTypeImports`, which is not a local decision.
- **Resolved 2026-08-16, the `when` gap raised at M5.2.** Nothing turned a criterion's `when` clause into a request. Three options were put up: a `when` vocabulary mirroring the `then` table, reusing the requirement's access rules, or adding structured fields to the criterion, which would be a contract change. The decision was the vocabulary, now in Implementation notes above and implemented by M5.9. No contract changed.
- **Resolved at M5.7:** `--no-playwright` is not a vitest option and the command was removed rather than replaced. No environment variable was introduced either, since rule R6 keeps core out of the environment; the launcher is injected by the caller, absent by default, and this repository's genuine lack of Playwright is what exercises the absent path. See the note under Definition of Done.
- **Raised at M5.7, worth confirming.** `planBehavioralChecks` used to refuse every fuzzy criterion with `capability-unavailable`, which made the S5 exit criterion unreachable: a criterion that never plans can never run under Playwright. Fuzzy criteria now plan through the `when` vocabulary with no assertions, and the capability decision moved to the runner, where the browser either is or is not there. The task list gives M5.7 "graceful degradation" and gives planning to M5.9, so this crosses a task boundary by one function.
- **Raised at M5.7, a judgment call in the report's numbers.** A fuzzy criterion skipped for a missing browser is recorded with `deterministic: false`, so it counts toward `modelAssistedCheckCount` even though no model was consulted. The alternative claims a deterministic check produced the result, which is equally untrue and misleads in the dangerous direction. Overstating how much of a run was not deterministic is the safe error for a tool whose trust argument is invariant I1.
