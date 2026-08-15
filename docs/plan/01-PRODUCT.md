# Product Definition

## Audience

Software engineers who have generated application code with an AI tool, a coding agent, or an app builder platform, and now have to establish that it does what was intended before it ships. They read code competently. Their problem is volume and trust, not comprehension.

Non-audience for the MVP: non-technical builders. No plain language translation layer, no onboarding wizard, no hosted dashboard. The output should be readable, but the reader is assumed to know what an HTTP status code is.

## The problem, stated precisely

AI generated applications are produced faster than they can be reviewed. The generator optimizes for the feature working, not for the feature being the only thing that works. The specific failure class this tool targets is silent divergence between intent and artifact: endpoints that exist but were never requested, access rules that were specified but not enforced, requirements that regressed on a regeneration without anyone noticing.

## What the tool does

1. Reads a spec that states intent in a machine-readable form.
2. Probes the target to build an Observation of what actually exists.
3. Diffs Observation against Spec, producing structural findings before any check runs.
4. Runs access checks and behavioral checks derived from the same spec.
5. Emits a report: what exists, what was asked for, where they disagree, what could be proven, with evidence attached to every claim.
6. Compares runs so that change between builds is visible at a semantic level.

## Invariants

These override convenience, schedule, and any local design decision. A PR that violates one is rejected regardless of what else it accomplishes.

**I1. No language model in the verdict path.** Verdicts are produced by deterministic assertions on responses, schemas, and state. A model may extract a spec from prose, summarize a diff, or phrase a suggested fix. A model may never decide `pass`, `fail`, `verified`, or `failed`. The single exception is a behavioral criterion explicitly marked `mode: fuzzy` in the spec, which produces at most `inconclusive` when the model is uncertain and is always reported as model assisted. Enforced structurally, see `04-CONVENTIONS.md`.

**I2. Precision over recall.** A check that can fire wrongly is not shipped. When in doubt, emit `inconclusive` and place it in the unverified bucket. Two false positives lose the user permanently. Cutting a check is always an acceptable resolution.

**I3. Every claim carries evidence.** A finding without a recorded request, response, file reference, or artifact is not a finding. Evidence is stored, addressable, and reproducible.

**I4. Unverified is a first-class verdict.** Never collapse "could not be tested" into pass or fail. It appears in its own section of every report, with a stated reason.

**I5. The spec is never mutated by a run.** Spec is input. Verdicts and evidence live in the RunResult. This is what makes runs comparable and specs reviewable.

**I6. Assertions bind to semantics and data, never to DOM structure or generated markup.** Selectors use roles, labels, and test identifiers. A regeneration that preserves behavior must not break the suite.

**I7. Read-only by default.** The tool never modifies target source, never writes to a target it was not told it may write to, and refuses to run destructive fixtures against a target not marked as disposable.

## MVP scope

In scope:

- YAML spec authored by hand, validated against a published schema
- Source-first probing with black box fallback
- Access checks derived from access rules
- Deterministic behavioral checks over HTTP
- Fuzzy behavioral checks over a browser, optional dependency
- Structural diff of Observation against Spec
- Text, JSON, SARIF, and JUnit output with meaningful exit codes
- Run persistence and run to run delta
- A GitHub Action wrapping the CLI

Out of scope for the MVP, and to be actively refused if a task drifts toward it:

- Code transformation, ejection, refactoring, or automated fixes
- Hosted service, accounts, multi-tenancy, or a web dashboard
- Plain language mode for non-technical users
- Spec recovery from an application that never had a spec
- Support for frameworks beyond those listed in `modules/M4-probe.md`
- Any integration with a specific app builder platform's private API

## Definition of success

The MVP is successful when this sequence runs unassisted, end to end, in under five minutes on a machine that has never seen the project:

1. `npx qai init` in a repository containing a generated application
2. A hand-written spec of roughly fifteen requirements is validated
3. `npx qai check` exits non-zero with at least one access finding carrying a file reference and a request and response pair
4. The finding is fixed
5. `npx qai check` exits zero
6. `npx qai diff` shows the requirement moving from failed to verified between the two runs

Everything in `05-BUILD-ORDER.md` exists to make that sequence real. Work that does not serve it is out of scope by default.
