# QAi Implementation Plan: Index and Reading Order

**Status:** draft, MVP scope frozen at milestone level, details subject to change
**Audience:** Claude Code agents implementing this project, and the human reviewing their PRs
**This directory is the single source of truth.** If code and these documents disagree, the documents are wrong and must be corrected in the same PR that changes the code.

## What this project is, in one sentence

A CLI and CI tool that takes a machine-readable spec and a target application, determines what the application actually contains, checks that against what was specified, and reports disagreements with evidence and deterministic verdicts.

## How to use this plan

1. Read `01-PRODUCT.md` once, at the start of any session. It defines scope and the invariants that override local convenience.
2. Read `04-CONVENTIONS.md` once, at the start of any session. It defines how to write code here.
3. Read `03-CONTRACTS.md` before touching any type, schema, or serialized output.
4. Read exactly one file from `modules/` for the task at hand. Do not read all module files; they are independent by design.
5. Read `05-BUILD-ORDER.md` only when deciding what to do next, not when executing an assigned task.

Do not read the entire plan on every task. Each module file states its own dependencies and is intended to be sufficient on its own alongside `03-CONTRACTS.md` and `04-CONVENTIONS.md`.

## File map

| File | Contains | Read when |
|---|---|---|
| `00-INDEX.md` | This file. Naming, reading order, change protocol. | First contact |
| `01-PRODUCT.md` | Audience, scope, invariants, MVP demo definition | Every session |
| `02-ARCHITECTURE.md` | Package layout, dependency rules, data flow | Structural work |
| `03-CONTRACTS.md` | Spec, Observation, RunResult shapes; exit codes | Any typed or serialized change |
| `04-CONVENTIONS.md` | Coding standards, task protocol, definition of done | Every session |
| `05-BUILD-ORDER.md` | Nine week milestones with exit criteria | Planning next work |
| `06-TESTING.md` | Fixture app, defect catalog, golden files, corpus run | Writing tests |
| `07-DECISIONS.md` | Decisions made, volatility, blast radius of reversal | Before proposing a change |
| `modules/M1-spec.md` | Spec schema, loader, validation | Assigned M1 |
| `modules/M2-target.md` | Target config, actors, credentials, fixtures, reset | Assigned M2 |
| `modules/M3-access-checks.md` | Access rule verification (the sharpest finding) | Assigned M3 |
| `modules/M4-probe.md` | Observation of what the app actually contains | Assigned M4 |
| `modules/M5-behavioral-checks.md` | Acceptance criteria verification, browser path | Assigned M5 |
| `modules/M6-store-delta.md` | Run persistence and run to run comparison | Assigned M6 |
| `modules/M7-report.md` | Text, JSON, SARIF, JUnit emitters | Assigned M7 |
| `modules/M8-cli-ci.md` | Command surface, config resolution, GitHub Action | Assigned M8 |
| `modules/M9-extraction.md` | Prose to spec extraction, deferred | Assigned M9 |

## Naming

The product name is confirmed: **QAi**, quality assurance with AI. `QAi` is the display form used in prose and documentation; `qai` is the lowercase token used in every identifier, path, and command. Every occurrence is derived from that one token so any future rename stays mechanical.

| Concept | Value | Notes |
|---|---|---|
| Display name | `QAi` | Prose, documentation, and headings only |
| Identifier token | `qai` | Lowercase, used in every identifier, path, and command |
| Binary | `qai` | Invoked as `npx qai` |
| Package scope | `@qai/` | `core`, `cli`, `action` |
| Config file | `qai.config.yaml` | Project root |
| Spec file default | `spec/*.spec.yaml` | Multiple files allowed |
| State directory | `.qai/` | SQLite database, evidence, cached runs; git ignored |

To rename later: change this table, then run a repository wide replace of the token `qai`. Do not introduce a second name anywhere, including in prose, comments, or test fixtures.

## Change protocol

Any of the following requires editing this plan in the same PR as the code:

- Adding, removing, or renaming a field in any contract in `03-CONTRACTS.md`
- Changing a CLI command, flag, or exit code
- Changing module boundaries or adding a package
- Reversing anything listed in `07-DECISIONS.md`

If a task cannot be completed without violating an invariant in `01-PRODUCT.md`, stop and report the conflict rather than working around it. Invariants are the product; local convenience is not.

## Vocabulary

Use these terms exactly and consistently in code, output strings, comments, and documents.

- **Spec**: the machine-readable statement of intent. Input only. Never mutated by a run.
- **Target**: the application under inspection.
- **Actor**: a configured identity used to interact with the target. At least two are required for meaningful access checking.
- **Probe**: the read-only process of discovering what the target actually contains.
- **Observation**: the structured output of a probe.
- **Check**: a single verification attempt producing one verdict.
- **Finding**: a failed check surfaced to the user, carrying severity.
- **Verdict**: `verified`, `failed`, or `unverified` at requirement level; `pass`, `fail`, or `inconclusive` at check level.
- **Evidence**: the recorded artifact proving a check's verdict.
- **Run**: one full execution producing one RunResult.
- **Delta**: the comparison of two runs.
- **Module** (`M1` to `M9`): a unit of code ownership, documented in `modules/`.
- **Stage** (`S0` to `S9`): a schedule milestone in `05-BUILD-ORDER.md`. Stages and modules use separate numbering and do not correspond.

Do not use: audit, scan, test suite, lint, vulnerability, exploit. They carry expectations this tool does not meet.
