# M8: CLI and CI Action

**Status:** not started
**Owns:** `packages/cli/`, `packages/action/`
**Depends on:** M1, M2, M3, M4, M5, M7
**Optionally consumes:** M6, required only by the `diff` subcommand
**Depended on by:** nothing
**Read alongside:** `03-CONTRACTS.md` exit codes, `04-CONVENTIONS.md`

## Purpose

The surface. Command parsing, configuration resolution, progress reporting, process exit, and a GitHub Action wrapper. Contains no verification logic whatsoever; if a behavior can be tested without a terminal, it belongs in `core`.

## Inputs

- Command line arguments, `qai.config.yaml`, environment.

## Outputs

- Rendered output on stdout, progress and diagnostics on stderr, process exit codes per `03-CONTRACTS.md`.
- GitHub Action outputs and SARIF upload.

## Public API

The public API of this package is its command surface.

| Command | Purpose | Exits |
|---|---|---|
| `qai init` | Scaffold `qai.config.yaml`, a starter spec, and `.gitignore` entry for `.qai/` | 0, 2 |
| `qai validate [paths...]` | Load and validate specs, print a summary of requirements, rules, and criteria | 0, 2 |
| `qai probe` | Probe only, emit Observation | 0, 2, 3 |
| `qai check` | Full run: probe, check, assemble, report | 0, 1, 2, 3 |
| `qai report <runId>` | Re-render a stored run in any format | 0, 2 |
| `qai diff [--last 2] [runA runB]` | Render a RunDelta | 0, 2 |

Global flags: `--config <path>`, `--format text|json|sarif|junit`, `--out <path>`, `--fail-on high|medium|low`, `--fail-on-unverified`, `--concurrency <n>`, `--no-color`, `--verbose`.

Deferred to M9: `qai extract`.

## Implementation notes

**Configuration precedence**, highest first: command line flag, environment variable, config file, built-in default. Print the resolved configuration under `--verbose` so a confused user can see what was actually used.

**Startup capability report, before any work.** Print which actors resolved, whether source is available, whether Playwright is present, and whether fixtures are available. Then print any capability that will cause requirements to be `unverified`. A user should learn about a degraded run at the start, not by wondering why a suspiciously green report has low coverage.

**Progress reporting.** `core` receives an injected reporter, per rule R5. The CLI implements it with `@clack/prompts` for interactive terminals and plain line-oriented output when not a TTY, which is what CI needs.

**Exit code split.** `core` computes 0 or 1 from the finding policy and the CLI applies it without recomputing. Codes 2 and 3 are error paths the CLI owns, because they represent conditions under which no RunResult exists.

**Errors.** A configuration or spec error prints the file, the path within it, the reason, and one suggested fix, then exits 2. A stack trace appears only under `--verbose`. An unreachable target exits 3 with the URL attempted and the underlying error.

**The GitHub Action** is a thin composite action: install, run `qai check --format sarif --out results.sarif`, upload via `github/codeql-action/upload-sarif`, and set outputs for finding counts and coverage. Inputs mirror the global flags. It must work with a three line workflow snippet, which goes in the README.

**Windows compatibility.** Path handling, glob expansion, and command execution must work on Windows without a shell assumption, since the primary developer works there.

## Tasks

1. **M8.1** Scaffold `packages/cli` with Commander, the `qai` binary, and the reporter implementation.
2. **M8.2** Implement configuration precedence and `--verbose` resolved config output.
3. **M8.3** Implement `init` with scaffolding and the `.gitignore` entry.
4. **M8.4** Implement `validate`.
5. **M8.5** Implement `check`, including the startup capability report and exit code application.
6. **M8.6** Implement `probe` and `report`. The `diff` subcommand requires M6 and is implemented in stage S7, not with the rest of this task.
7. **M8.7** Implement error presentation for exit codes 2 and 3.
8. **M8.8** Implement the GitHub Action in `packages/action`, with SARIF upload and outputs.
9. **M8.9** End-to-end test: `init`, `validate`, `check` against `fixtures/ledger`, asserting exit codes in both defective and fixed configurations.

## Definition of Done

```
pnpm --filter @qai/cli test
pnpm --filter @qai/cli exec qai check --config fixtures/ledger/qai.config.yaml --fail-on high
```

- Exit code 1 in the defective configuration, 0 in the fixed one.
- A malformed spec exits 2 with a message naming file, path, reason, and a suggested fix, and no stack trace.
- The Action produces annotations visible in a pull request on the fixture repository.
- Every command works on Windows and on Linux.

## Do Not

- Do not put verification logic in this package.
- Do not recompute exit code policy here.
- Do not print progress to stdout; stdout carries the report only, so piping works.
- Do not add commands beyond the table without approval.

## Open questions

- **The Definition of Done names a config path that does not exist.** It runs
  `qai check --config fixtures/ledger/qai.config.yaml`, and this repository's target
  configuration lives at the root as `qai.config.yaml`. `fixtures/ledger/` holds the
  application and its spec, never a config. The command was run at M8.5 against the real
  path and both halves of the criterion hold: exit 1 with the defect switches on, exit 0
  with them off. Correct the path here, or move the config, but the two should agree.
- **M8.1 deviation, recorded rather than assumed.** `Reporter` is listed in
  `03-CONTRACTS.md` as a shared runtime type owned by M7, and M7 completed without
  building it, so M8.1 added it to `packages/core/src/report/`. Nothing in `core` accepts
  one yet: `probe`, `runAccessChecks`, and `runBehavioralChecks` report no progress at
  all, and threading one through them changes signatures owned by M4 and M5. The CLI
  implements the port and reports its own progress in the meantime.
- **M8.2 cross-module edit.** `TargetConfigSchema` gained a `defaults` section. The
  module states a precedence of flag, environment, config file, then built-in default,
  and the schema is strict, so without a section for these settings the config file layer
  could not exist: writing `format: sarif` was a load error.
- **M8.4 cross-module edit.** `LoadedSpec` gained `files`, the paths actually read.
  `RunResult.spec.files` needs exactly that list and nothing else could supply it, and
  `validate` has to name what it read or a user cannot tell a passing spec from a glob
  that matched the wrong directory.
- **M8 is branched from `feat/m7-report`, not from `dev`.** The one deviation from the
  branching rule in `04-CONVENTIONS.md`. M8 imports `renderSarif`, `renderJunit`, and
  `computeExitCode`, none of which exist on `dev` until PR #10 merges. PR #2 stacked the
  same way in S1. Rebase onto `dev` once #10 lands.
