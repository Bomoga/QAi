# M3: Access Checks

**Status:** not started
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

**List actions, pending Q5.** For `action: list`, the assertion is the absence of foreign rows, not an empty response. Resolve ownership by the field named in the rule's condition. If no row is identifiable as foreign, the verdict is `inconclusive` with reason recorded, never `pass`.

**Resource targeting.** A rule names a resource, not a URL. Resolution order: an endpoint in the Observation whose `responseShape.entity` matches, then a configured route override, then `inconclusive` with reason `unsupported-condition`. Never guess a URL by pluralizing an entity name and hoping.

**Instance identification.** Deny checks need a real record owned by someone else. Fixtures seed these. If no foreign instance can be identified, the check is `inconclusive` with reason `probe-incomplete`, because testing access control against a record that does not exist proves nothing.

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
pnpm --filter @qai/core test -- access
pnpm --filter @qai/cli exec qai check --config fixtures/ledger/qai.config.yaml
```

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
