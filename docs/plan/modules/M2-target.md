# M2: Target, Actors, Fixtures, Evidence

**Status:** not started
**Owns:** `packages/core/src/target/`, `packages/core/src/evidence/`
**Depends on:** M1
**Depended on by:** M3, M4, M5
**Read alongside:** `03-CONTRACTS.md`

## Purpose

Everything required to interact with the target safely and to record what happened. Configuration resolution, authenticated actor sessions, fixture seeding and reset, and evidence capture with redaction. This module is where the tool's safety posture lives, so it is built before anything that touches the target in anger.

## Inputs

- `qai.config.yaml` from the project root, overridable by flag.
- Environment variables referenced by the config, never literal secrets in the file.
- The loaded Spec, for the `sensitive` field list used by redaction.

## Outputs

- `TargetContext`, carrying resolved base URL, optional source root, actor sessions, and capability flags.
- `ActorSession` per configured actor, each with an authenticated request function.
- `Evidence` records written to `.qai/evidence/`, redacted at capture.

## Public API

```ts
export function loadConfig(path?: string): { config: TargetConfig } | { error: ConfigError };
export function createTargetContext(config: TargetConfig, spec: Spec, deps: Deps): Promise<TargetContext>;
export interface ActorSession {
  readonly id: string;
  request(req: RequestSpec): Promise<{ response: CapturedResponse; evidenceId: string }>;
}
export function seedFixtures(ctx: TargetContext): Promise<SeedResult>;
export function resetFixtures(ctx: TargetContext): Promise<ResetResult>;
```

## Implementation notes

**Config shape**, proposed, pending Q2 and Q3:

```yaml
target:
  baseUrl: http://localhost:3000
  sourceRoot: .
  disposable: true            # required true before any mutating check runs
  resetCommand: "pnpm --filter ledger db:reset"
  seedCommand: "pnpm --filter ledger db:seed"
actors:
  - id: owner
    auth:
      kind: bearer            # bearer | cookie | header | none
      tokenEnv: LEDGER_OWNER_TOKEN
  - id: outsider
    auth:
      kind: bearer
      tokenEnv: LEDGER_OUTSIDER_TOKEN
redaction:
  extraPatterns: ["(?i)api[_-]?key"]
```

**Two actors are a hard requirement for access checking.** If fewer than two are configured, access checks are not run and every access-derived requirement is `unverified` with reason `actor-unavailable`. Say this clearly at startup rather than producing a quiet green run, since a quiet green run is the single most dangerous output this tool can produce.

**Never store a secret.** Config holds environment variable names. Resolved values live in memory only, are never logged, never serialized, and never written to evidence.

**Evidence capture is a wrapper around undici**, not an afterthought. The request function captures request line, headers, and body, and response status, headers, and body, applies redaction, writes the record, and returns the evidence id alongside the response. Bodies above a size threshold, default 256 KB, are truncated with `truncated: true`.

**Redaction rules, applied in order:** authorization and cookie headers always; any configured `extraPatterns`; any field marked `sensitive: true` on any entity in the Spec, matched by field name at any depth. Every alteration is listed in `redactions`, because an unmarked absence reads as a fact.

**Disposability gate.** `seedFixtures` and any mutating check refuse to run unless `target.disposable` is `true` and a `resetCommand` is configured. This implements invariant I7 and is not overridable by flag.

## Tasks

1. **M2.1** Define `TargetConfig` as a Zod schema; implement `loadConfig` with clear errors naming the YAML path.
2. **M2.2** Implement environment variable resolution with an error listing every missing variable at once, not one at a time.
3. **M2.3** Implement the undici-based request layer with injected clock and identifier generator, per rule R6.
4. **M2.4** Implement evidence capture, redaction, and writing. Test that a sensitive spec field never appears in a written record.
5. **M2.5** Implement `ActorSession` for `bearer`, `cookie`, `header`, and `none` auth kinds.
6. **M2.6** Implement seed and reset command execution with timeout, captured output, and the disposability gate.
7. **M2.7** Implement the startup capability report: which actors resolved, whether source is present, whether fixtures are available. This is what gets printed before a run.

## Definition of Done

```
pnpm --filter @qai/core test
pnpm --filter @qai/core test -- target evidence
```

- Two actors authenticate against `fixtures/ledger` and issue distinct requests.
- A written evidence record contains no authorization header value and no field marked sensitive.
- Running with one actor configured produces a startup warning and marks access-derived requirements `unverified` with reason `actor-unavailable`.
- A target without `disposable: true` refuses seeding with an actionable message.

## Do Not

- Do not put verification logic here. This module never decides a verdict.
- Do not write an unredacted body to disk at any point, including temporary files and test snapshots.
- Do not accept literal secrets in the config file; reject them with an error suggesting an environment variable.
- Do not implement retry with backoff yet; a flaky target should surface as `inconclusive`, not be hidden.

## Open questions

- Q2: credential supply mechanism. Proposal implemented above.
- Q3: reset strategy. Proposal is a target-declared command. If the target cannot provide one, mutating checks stay off and are reported as `unverified`.
