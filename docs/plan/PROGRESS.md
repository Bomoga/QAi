# Progress

Updated: 2026-08-15T09:09:00Z
Current stage: S0
Next task: S0.2

## S0. Skeleton

- [x] S0.1 repo, workspaces, tooling (commit backfilled below)
- [ ] S0.2 package skeletons for core, cli, action
- [ ] S0.3 CI running typecheck, lint, test
- [ ] S0.4 fixtures/ledger boots with one seeded defect
- Exit criterion: `pnpm test` green in GitHub Actions, and `fixtures/ledger` serves an endpoint that leaks a record across owners

## S1. Spec and contracts (M1)

- [ ] not started

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

## Blocked

- none
