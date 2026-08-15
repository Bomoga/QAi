# Contracts

Three shapes carry everything. They are defined once in `packages/core/src/contracts/`, using Zod, with TypeScript types derived by inference and JSON Schema generated for editor support. There is no second definition of these shapes anywhere in the repository.

Any change here requires updating this file in the same PR. Additive changes bump the minor version of `specVersion` or `resultVersion`; removals or renames bump the major and require an entry in `07-DECISIONS.md`.

## Identifier conventions

| Prefix | Applies to | Example |
|---|---|---|
| `REQ-` | Requirement | `REQ-014` |
| `AR-` | Access rule | `AR-014-01` |
| `AC-` | Acceptance criterion | `AC-014-01` |
| `CHK-` | Check result | `CHK-a91f2c` |
| `EV-` | Evidence record | `EV-7d10b3` |
| `RUN-` | Run | `RUN-20260814-0931` |

Requirement identifiers are authored by hand and are stable. Access rule and acceptance criterion identifiers are derived from their parent requirement and their ordinal position, assigned at load time if absent. Check and evidence identifiers are content-hashed at runtime so that the same check on the same target produces the same identifier across runs, which is what makes the delta in M6 possible.

## 1. Spec

Input only. Never mutated by a run. See `modules/M1-spec.md` for the loader.

```yaml
specVersion: "0.1"
name: "Invoicing app"
actors:
  - id: owner
    description: "Authenticated user belonging to organization 1"
  - id: outsider
    description: "Authenticated user belonging to organization 2"
entities:
  - name: Invoice
    ownedBy: Organization
    fields:
      - name: org_id
        type: string
      - name: total_cents
        type: number
      - name: notes
        type: string
        sensitive: true
requirements:
  - id: REQ-014
    statement: "A user can only view invoices belonging to their own organization"
    entities: [Invoice, Organization]
    fields: [Invoice.org_id]
    tags: [access-control]
    accessRules:
      - id: AR-014-01
        actor: outsider
        action: read
        resource: Invoice
        condition: "Invoice.org_id != actor.org_id"
        effect: deny
    acceptanceCriteria:
      - id: AC-014-01
        mode: deterministic
        given: "an invoice belonging to organization 2"
        when: "actor owner requests that invoice by id"
        then: "the response status is 403 or 404 and the body contains no Invoice fields"
```

Field rules:

- `actors[].id` must be referenced by at least one access rule, or loading emits a warning.
- `entities[].name` is the canonical name used by probe adapters when matching discovered models. Matching is case-insensitive and singular or plural tolerant; the match confidence is recorded on the Observation, never silently assumed.
- `fields[].sensitive: true` marks a field that must never appear in evidence output. Redaction reads this list.
- `accessRules[].action` is one of `read`, `create`, `update`, `delete`, `list`.
- `accessRules[].effect` is `allow` or `deny`. A `deny` rule is verified by attempting the action and requiring refusal. An `allow` rule is verified by attempting it and requiring success. Deny rules are the higher severity class.
- `accessRules[].condition` is a restricted expression over `actor.*` and `<Entity>.*`, parsed into an AST at load time. It is not evaluated as JavaScript and never passed to `eval`. The supported grammar is defined in `modules/M1-spec.md`; anything outside it is a load error, not a silent skip.
- `acceptanceCriteria[].mode` is `deterministic` or `fuzzy`. Deterministic criteria assert on status codes, headers, response fields, and persisted state. Fuzzy criteria are model assisted and constrained by invariant I1.
- A requirement with neither access rules nor acceptance criteria loads successfully and is reported as `unverified` with reason `no-checks-defined`. This is deliberate; it makes coverage gaps visible instead of hiding them.

## 2. Observation

Output of the probe. Describes what exists, never what should exist. See `modules/M4-probe.md`.

```jsonc
{
  "observationVersion": "0.1",
  "observedAt": "2026-08-14T09:31:02Z",
  "mode": "hybrid",              // "source" | "blackbox" | "hybrid"
  "target": { "baseUrl": "http://localhost:3000", "sourceRoot": "./" },
  "entities": [
    {
      "name": "Invoice",
      "origin": "schema",         // "schema" | "inferred"
      "confidence": "high",       // "high" | "medium" | "low"
      "fields": [{ "name": "org_id", "type": "string", "origin": "schema" }],
      "evidence": ["EV-7d10b3"]
    }
  ],
  "endpoints": [
    {
      "id": "GET /api/invoices/:id",
      "method": "GET",
      "path": "/api/invoices/:id",
      "origin": "source",
      "handlerRef": "app/api/invoices/[id]/route.ts:12",
      "authRequired": "unknown",   // true | false | "unknown"
      "responseShape": { "entity": "Invoice", "fields": ["id", "org_id", "total_cents"] },
      "actorVisibility": { "owner": "untested", "outsider": "untested" },
      "evidence": ["EV-91aa04"]
    }
  ],
  "notes": [{ "level": "warn", "message": "2 route files could not be parsed", "refs": ["EV-33cc12"] }]
}
```

Rules:

- `authRequired` is `"unknown"` unless positively determined. Never default it to `true`.
- `origin` and `confidence` are mandatory on every entity and endpoint. A report may not present a low-confidence inference as fact.
- `actorVisibility` is filled by checks, not by the probe, and is `untested` in a probe-only run.

## 3. RunResult

The public interface. Every emitter and every future surface is a projection of this. See `modules/M7-report.md`.

```jsonc
{
  "resultVersion": "0.1",
  "runId": "RUN-20260814-0931",
  "toolVersion": "0.1.0",
  "startedAt": "2026-08-14T09:31:00Z",
  "finishedAt": "2026-08-14T09:33:41Z",
  "spec": { "hash": "sha256:...", "specVersion": "0.1", "files": ["spec/invoicing.spec.yaml"] },
  "target": { "baseUrl": "http://localhost:3000", "sourceRoot": "./", "commit": "a1b2c3d" },
  "observation": { "ref": "OBS-20260814-0931" },
  "requirements": [
    {
      "requirementId": "REQ-014",
      "verdict": "failed",                 // "verified" | "failed" | "unverified"
      "reason": "1 of 2 checks failed",
      "checkIds": ["CHK-a91f2c", "CHK-b02d55"]
    }
  ],
  "checks": [
    {
      "checkId": "CHK-a91f2c",
      "type": "access",                    // "access" | "behavioral" | "structural"
      "requirementId": "REQ-014",
      "ruleId": "AR-014-01",
      "verdict": "fail",                   // "pass" | "fail" | "inconclusive"
      "deterministic": true,
      "severity": "high",                  // "high" | "medium" | "low" | "info"
      "title": "Invoice readable by user outside owning organization",
      "detail": "GET /api/invoices/42 as actor outsider returned 200 with fields id, org_id, total_cents",
      "locationRef": "app/api/invoices/[id]/route.ts:12",
      "evidence": ["EV-7d10b3", "EV-7d10b4"]
    }
  ],
  "structural": {
    "specifiedNotObserved": [{ "kind": "entity", "name": "AuditLog", "requirementIds": ["REQ-021"] }],
    "observedNotSpecified": [{ "kind": "endpoint", "id": "POST /api/debug/reset", "severity": "medium" }],
    "fieldMismatches": [{ "entity": "Invoice", "specifiedNotObserved": [], "observedNotSpecified": ["internal_notes"] }]
  },
  "summary": {
    "requirements": { "total": 15, "verified": 9, "failed": 3, "unverified": 3 },
    "checks": { "total": 41, "pass": 33, "fail": 4, "inconclusive": 4 },
    "coverage": 0.8,
    "findingsBySeverity": { "high": 1, "medium": 3, "low": 0, "info": 2 },
    "modelAssistedCheckCount": 2
  },
  "unverifiedReasons": [
    { "requirementId": "REQ-021", "reason": "no-checks-defined" },
    { "requirementId": "REQ-030", "reason": "actor-unavailable", "detail": "actor admin not configured" }
  ]
}
```

Rules:

- `coverage` is requirements with at least one non-inconclusive check divided by total requirements. It is not a pass rate and must never be labeled as one.
- A requirement is `verified` only if it has at least one check and all its checks passed. Any fail makes it `failed`. Checks that are all inconclusive, or no checks at all, make it `unverified`.
- `unverifiedReasons` uses a closed set: `no-checks-defined`, `actor-unavailable`, `target-unreachable`, `probe-incomplete`, `check-error`, `unsupported-condition`, `model-inconclusive`, `capability-unavailable`. The last covers an optional dependency being absent, for example Playwright not installed, and is distinct from `model-inconclusive`, which means the model ran and was uncertain.
- `modelAssistedCheckCount` exists so the report can state plainly how much of the run was not deterministic. It is always displayed, including when zero.

## Evidence

```jsonc
{
  "id": "EV-7d10b3",
  "kind": "http",                 // "http" | "screenshot" | "file" | "log"
  "capturedAt": "2026-08-14T09:32:10Z",
  "actorId": "outsider",
  "request": { "method": "GET", "url": "/api/invoices/42", "headers": { "authorization": "[redacted]" } },
  "response": { "status": 200, "headers": {}, "bodyRef": ".qai/evidence/EV-7d10b3.json", "truncated": false },
  "redactions": ["request.headers.authorization", "response.body.notes"]
}
```

Redaction is applied at capture time, before any write, and covers: authorization and cookie headers, anything matching configured secret patterns, and any field marked `sensitive: true` in the spec. The `redactions` array names every path that was altered, so a reader can see that redaction occurred rather than mistaking an absence for a fact.

## Shared runtime types

These are not serialized contracts, but they cross module boundaries, so their owner is recorded here to keep module documents self-sufficient. A module using one of these reads only this table, not the owning module's document.

| Type | Owner | Purpose |
|---|---|---|
| `TargetContext` | M2 | Resolved target, actor sessions, capability flags |
| `ActorSession` | M2 | Authenticated request function returning a response and an evidence id |
| `CapturedResponse` | M2 | Status, headers, and body as captured for evidence |
| `CheckResult` | M3 | One verdict with severity, detail, and evidence ids |
| `CheckPlan` | M3 | A check resolved to a concrete action before execution |
| `Reporter` | M7 | Injected progress interface, since `core` produces no output |
| `Judge` | M5 | Model interface for fuzzy criteria, returning `satisfied`, `not-satisfied`, or `uncertain`, never a `Verdict` |
| `Store` | M6 | Run persistence interface |
| `Deps` | M2 | Injected clock and identifier generator, per rule R6 |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Run completed, no findings at or above the failure threshold |
| 1 | Run completed, findings at or above the failure threshold |
| 2 | Spec invalid or configuration error, no run performed |
| 3 | Target unreachable or fatal runtime error, run aborted |

The failure threshold defaults to `high` and is set by `--fail-on <severity>`. Inconclusive checks never by themselves produce exit code 1. `--fail-on-unverified` opts into treating coverage gaps as failure, and is off by default.
