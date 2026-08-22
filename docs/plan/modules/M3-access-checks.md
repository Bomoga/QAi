# M3: Access Checks

**Status:** complete
**Owns:** `packages/core/src/checks/access/`, `packages/core/src/checks/registry.ts`
**Depends on:** M1, M2
**Optionally consumes:** M4 Observation for resource resolution. Runs without it at reduced precision, falling back to configured route overrides.
**Depended on by:** M5 (registry), M7
**Read alongside:** `03-CONTRACTS.md`, `06-TESTING.md`

## Purpose

Turn access rules into attempted actions and deterministic verdicts. This is the sharpest finding the tool produces and the first demonstrable version of the product. No model is involved at any point.

## Inputs

- Spec with parsed access rules and their condition ASTs.
- `TargetContext` with at least two actor sessions.
- Observation, when available, to resolve which endpoint serves a resource. Absent an Observation, fall back to configured resource routes.

## Outputs

- `CheckResult[]` of `type: "access"`, each deterministic, each carrying evidence.

## Public API

```ts
export function planAccessChecks(spec: Spec, obs: Observation | null, ctx: TargetContext): AccessCheckPlan[];
export function runAccessCheck(plan: AccessCheckPlan, ctx: TargetContext): Promise<CheckResult>;
```

## Implementation notes

**The core move.** For a `deny` rule, act as an actor who should be refused and require refusal. For an `allow` rule, act as an actor who should succeed and require success. A deny rule that passes is silence; a deny rule that fails is the headline finding.

**Verdict table, deny rules:**

| Observed | Verdict | Severity |
|---|---|---|
| 401, 403, or 404 with no resource fields in body | pass | n/a |
| 2xx with any field belonging to the protected resource | fail | high |
| 2xx with an empty or unrelated body | inconclusive | n/a |
| 5xx | inconclusive | n/a |
| Network error or timeout | inconclusive | n/a |

The 2xx-with-empty-body case is deliberately inconclusive rather than pass. An endpoint returning 200 with nothing may be correctly refusing or may be leaking under a different shape, and guessing here is exactly the false positive that costs a user.

**One exception, decided 2026-08-22 after the corpus run: a denied `delete`.** The corpus
missed a real deletion three times, on two applications, because the row above is right
for a read and wrong for a destroy: `DELETE /api/notes/N-1 as actor stranger returned 200
with no recognizable fields` was the tool declining to guess while the record was being
destroyed. For a `delete` the response is not the evidence and the record is.

| Observed | Record before | Record after | Verdict |
|---|---|---|---|
| 2xx with no resource fields | readable | absent | **fail**, high |
| 2xx with no resource fields | readable | still readable | pass |
| 2xx with no resource fields | not readable, or no state actor, or no read route | n/a | inconclusive, as before |

Three rules keep this from being a way to guess. The record is read as the configured
`stateActor` and never as the acting actor, for the reason M5.11 gives: a deny check acts
as the identity the rule says must be refused, so reading as that actor would report a
scoping rule as a state fact. Only a 2xx counts as present and only a 404 counts as gone,
since the state actor being unable to read something says more about that actor than about
the record. And the reading happens before the action as well as after, because a record
can only be shown to have been destroyed by having been there first.

Only `delete` is covered. An `update` that returns 2xx with no fields is a different
question, whether the record changed rather than whether it survived, and that comparison
is M5.11's rather than this table's.

**List actions, pending Q5.** For `action: list`, the assertion is the absence of foreign rows, not an empty response. Resolve ownership by the field named in the rule's condition. If no row is identifiable as foreign, the verdict is `inconclusive` with reason recorded, never `pass`.

**Resource targeting.** A rule names a resource, not a URL. Resolution order: an endpoint in the Observation whose `responseShape.entity` matches, then a configured route override, then `inconclusive` with reason `unsupported-condition`. Never guess a URL by pluralizing an entity name and hoping.

**Instance identification.** Deny checks need a real record owned by someone else. Fixtures seed these. If no foreign instance can be identified, the check is `inconclusive` with reason `probe-incomplete`, because testing access control against a record that does not exist proves nothing.

**Every instance the rule denies, not just the first. Corrected 2026-08-22 after the corpus
run.** Selection used to stop at the first configured instance the condition held for, and
the corpus found what that costs twice: an application enforced the rule on the instance
the tool picked and leaked a different one, so the access family reported a pass and a
behavioral criterion caught the defect instead. Enforcing on one record and not another is
the shape of a scoping bug, and it is invisible to a check that stops at the first refusal.

A non-mutating deny rule is now tried against every matching instance. The first failure
ends the sweep, since the finding is made and further requests cannot change the verdict.
A pass requires every instance to have been refused and states how many that was, so a
reader can see the scope of the claim. Any instance that came back undecided, with none
failing, makes the check inconclusive.

**Mutating rules are not swept**, and the reason is not squeamishness: a delete tried
against four records destroys four records, and the reset between checks runs between
them rather than inside one. One instance, as before.

**Evidence.** Every access check captures the full request and response pair, per invariant I3 and rule R7. The finding's `detail` names the actor, the method, the path, the status, and the fields observed in the body. It never uses a vulnerability class name.

**Determinism.** All access checks are non-mutating in the MVP except `create`, `update`, and `delete` rules, which run last, serially, inside the fixture boundary, and only when the disposability gate from M2 permits.

## Tasks

1. **M3.1** Define `CheckResult` construction helpers and the check registry with type dispatch.
2. **M3.2** Implement rule to plan expansion, including actor selection and resource resolution.
3. **M3.3** Implement condition AST evaluation against a candidate record, to decide which seeded instance satisfies "belongs to someone else".
4. **M3.4** Implement the deny verdict table exactly as written above, with one test per row.
5. **M3.5** Implement allow rule verification.
6. **M3.6** Implement `list` handling per Q5, with the foreign-row assertion and the inconclusive fallbacks.
7. **M3.7** Implement mutating rule handling behind the disposability gate, serial, with reset between.
8. **M3.8** Implement severity assignment and finding text generation per the output style in `04-CONVENTIONS.md`.
9. **M3.9** Integration test against `fixtures/ledger` covering defects D1, D2, D3 and negative controls N1, N2.

## Definition of Done

```
pnpm --filter @qai/core test access
pnpm --filter @qai/cli exec qai check --config fixtures/ledger/qai.config.yaml
```

**Corrected 2026-08-16.** This command previously carried a `--` before the filter
names. pnpm forwards that `--` to the script, so vitest is invoked as
`vitest run "--" "<name>"` and reads what follows as passthrough arguments rather
than as filename filters, which runs the whole core suite and passes for the wrong
reason. Without it the filter applies. `pnpm --filter @qai/core exec vitest run <name>`
is the explicit equivalent.

- D1, D2, D3 each produce exactly one high severity finding with request and response evidence.
- N1 and N2 produce no findings. This is the gate that matters most.
- Toggling the fixture app to its fixed configuration produces zero findings and exit code 0.
- No check in this module imports anything from `packages/core/src/llm/`.

## Do Not

- Do not name vulnerability classes in output strings. Describe the request and the response.
- Do not treat an empty 200 body as a pass.
- Do not attempt any action against a target lacking `disposable: true` when the action mutates.
- Do not add a heuristic that infers an access rule the spec did not state. This tool reports divergence from a stated intent, and inventing intent breaks that contract.

## Open questions

- Q5: list semantics. Proposal implemented above.
  **Implemented as proposed.** A deny rule on `list` asserts the absence of foreign rows. Rows must be present and identifiable for a pass; an empty list is inconclusive, and a row whose ownership cannot be judged also blocks a pass. Q5 can be marked resolved by a human.

### Raised during implementation, needs a human decision

- **The Definition of Done and the S3 exit criterion both need `qai check`**, which M8 owns and S6 delivers. The same coupling stopped S1's criterion being met as written. The behavior is demonstrated through `packages/core/scripts/check-ledger.ts`: defective ledger gives 3 failures and exit 1, fixed gives 0 and exit 0. Smallest correction: restate both against the check engine, or pull `qai check` into S3.

- **The allow verdict table was designed here.** This document tables the deny case and states the allow case in one line of prose. Implemented as: any 2xx passes, since the assertion is only that the actor was let through and a 204 on a permitted update is a success with nothing to return; 401, 403, and 404 fail; everything else is inconclusive, because a finding on an allow rule claims a legitimate user is being refused and a 400 cannot be told apart from a request the tool malformed itself. Confirm or table it here.

- **A refusal status that still returns the record is treated as a failure.** The deny table's first row reads "401, 403, or 404 with no resource fields in body", and that qualifier is read as load bearing. An endpoint answering 404 while handing back the invoice has not refused anything. Confirm.

- **Action to method mapping is not stated anywhere.** Implemented as read and list to GET, create to POST, update to PATCH, delete to DELETE. PATCH over PUT for update is the one worth confirming.

- **`TargetConfig` gained a `resources` section**, holding route templates and seeded instances, which M2 owns. It is here because a rule names a resource and this module refuses to guess a URL, while M4 lands a stage later. When the probe arrives the Observation takes precedence and this stays as the documented fallback.

- **A suggested fix lives inside `CheckResult.detail`.** The contract has no field for one and adding it would be a contract change. If a report should render suggestions separately, that is the contract question.

- **`HttpClient` has no teardown.** Calling `process.exit` with undici's pool open trips a libuv assertion on Windows and reports a crash code rather than the exit code the run reached. M8 will need a way to close the pool before exiting.
