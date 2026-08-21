# QAi

Checks that an application does what its spec said it would, and reports where they disagree.

You write down what the application is meant to do. QAi works out what it actually
contains, checks the two against each other, and tells you where they differ, with the
request and the response that proves each claim.

It is built for engineers who generated an application with an AI tool and now have to
establish that it does what was intended before it ships. The problem it targets is silent
divergence: endpoints that exist but were never asked for, access rules that were
specified but not enforced, requirements that regressed on a regeneration with nobody
noticing.

## In a GitHub workflow

Three lines, which is the point:

```yaml
- uses: Bomoga/QAi/packages/action@main
```

Findings appear inline on the pull request, sourced from SARIF, and the step summary says
what the run found.

A fuller version, with the target running first:

```yaml
name: qai
on: [pull_request]

permissions:
  contents: read
  security-events: write # required to upload SARIF

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22

      - run: npm ci
      - run: npm start &
      - run: npx wait-on http://localhost:3000/health

      - uses: Bomoga/QAi/packages/action@main
        with:
          fail-on: high
        env:
          QAI_OWNER_TOKEN: ${{ secrets.QAI_OWNER_TOKEN }}
          QAI_OUTSIDER_TOKEN: ${{ secrets.QAI_OUTSIDER_TOKEN }}
```

### Action inputs

They mirror the command line flags, because a flag and an input that meant different
things would be two surfaces to learn.

| Input                | Default            | Meaning                                                   |
| -------------------- | ------------------ | --------------------------------------------------------- |
| `spec`               | `spec/*.spec.yaml` | Spec files or globs                                       |
| `config`             | `qai.config.yaml`  | Path to the target configuration                          |
| `fail-on`            | `high`             | Lowest finding severity that fails the run                |
| `fail-on-unverified` | `false`            | Treat a requirement nobody could check as a failure       |
| `concurrency`        | unset              | How many checks to run at once                            |
| `working-directory`  | `.`                | Directory to run in                                       |
| `upload-sarif`       | `true`             | Upload findings so they appear inline on the pull request |

### Action outputs

| Output                    | Meaning                                                     |
| ------------------------- | ----------------------------------------------------------- |
| `findings-total`          | Every finding the run surfaced                              |
| `findings-error`          | Findings at severity high                                   |
| `findings-warning`        | Findings at severity medium                                 |
| `findings-note`           | Findings at severity low or info                            |
| `coverage-percent`        | Requirements with at least one check that reached a verdict |
| `requirements-unverified` | Requirements nobody could check                             |
| `model-assisted-checks`   | Checks that were not fully deterministic                    |
| `exit-code`               | The code `qai check` returned                               |
| `sarif-file`              | Where the report was written                                |

`coverage-percent` is coverage, not a pass rate. It counts requirements that reached a
verdict, and a requirement whose check failed still counts: the requirement was
established, it just came out badly.

## On the command line

**QAi is not published to a registry yet, so `npx qai` does not resolve.** Clone this
repository, install, build, and run the binary directly:

```bash
node packages/cli/bin/qai.js init
```

That writes `qai.config.yaml`, a starter spec at `spec/app.spec.yaml`, and a `.gitignore`
entry for `.qai/`. It never overwrites anything.

The table below writes `qai` for the command. Read it as `node <clone>/packages/cli/bin/qai.js`
until there is a package to install.

| Command                   | What it does                                                     |
| ------------------------- | ---------------------------------------------------------------- |
| `qai init`                | Scaffold a config, a starter spec, and the gitignore entry       |
| `qai validate [paths...]` | Load the specs and report what they contain and what is wrong    |
| `qai probe [paths...]`    | Describe what the target actually contains, judging nothing      |
| `qai check [paths...]`    | Probe, run the checks, and report where target and spec disagree |

Global flags: `--config <path>`, `--format text|json|sarif|junit`, `--out <path>`,
`--fail-on high|medium|low`, `--fail-on-unverified`, `--concurrency <n>`, `--no-color`,
`--verbose`.

### Exit codes

| Code | Meaning                                                       |
| ---- | ------------------------------------------------------------- |
| 0    | The run completed with no findings at or above the threshold  |
| 1    | The run completed with findings at or above the threshold     |
| 2    | The spec or the configuration is invalid, and no run happened |
| 3    | The target could not be reached, or the run aborted           |

Nothing that failed to start returns 1. That code means a completed run found something,
and a misspelled flag reporting it would tell CI the application has findings.

## What it will not do

- No language model decides a verdict. Verdicts come from deterministic assertions on
  responses, schemas, and state. A model may summarize or suggest; it may never decide
  `pass`, `fail`, `verified`, or `failed`.
- Nothing that could not be checked is reported as passing. "Unverified" is its own
  verdict with its own section and a stated reason, in every output format.
- No unredacted request or response is written anywhere, including into SARIF message
  text.
- It never modifies your source, and it refuses to run destructive fixtures against a
  target not marked disposable.

## Status

Pre-release, built in stages against a plan in `docs/plan/`. The report emitters and the
command surface are the current work.
