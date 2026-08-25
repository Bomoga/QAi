# Publication

Draft, started 2026-08-24. This is not a release and it does not authorize one. It is the
plan for one, and more usefully it is the list of things that are not true yet.

Every stage in `05-BUILD-ORDER.md` is complete. That is what makes this document possible
and it is not the same as being publishable. Publishing is outward facing: it puts a name
in a public namespace, it makes a licence claim, and it invites strangers to run this
against their own applications. None of those are decisions an agent makes, so this
document ends in questions rather than in a command.

## The state today, verified against the repository on 2026-08-24

| Thing                          | State                                                  |
| ------------------------------ | ------------------------------------------------------ |
| Stages S0 to S9                | complete and merged                                    |
| Tests                          | 1736 passing, none touching the network                |
| Corpus                         | 24 applications, 55 judged findings, 0 false positives |
| `qai` on npm                   | **taken by somebody else since 2019**                  |
| LICENSE file                   | MIT, since 2026-08-25                                  |
| `main` branch                  | **does not exist**                                     |
| Package versions               | `0.0.0`, all three `private: true`                     |
| The GitHub Action, end to end  | exercised as an action since 2026-08-25                |
| The action from a fresh checkout | **still fails, because `dist/` is gitignored**        |

## Seven things that block it

These are ordered by how badly they break, not by how hard they are to fix.

### 1. The name `qai` belongs to somebody else

Verified by lookup: `qai` exists on the public registry at `0.0.1-beta.1`, created
2019-12-17. It is dormant and that does not help, because a dormant name is still a taken
name and the registry does not reassign one on request.

This used to be worse than a naming inconvenience, because `packages/action/action.yml`
hardcoded the resolution:

```
npx --yes qai check
```

**Published in that state, in a stranger's repository, that line installs and runs a
package this project has never seen**, with `--yes` meaning nothing prompts. It was the
single most dangerous line in the repository and it was dangerous only once the action
became reachable, which is the one thing publication does.

**Fixed 2026-08-25, and it did not need the name settled.** A GitHub Action is distributed
by checking out the repository that holds it, so `packages/cli` already arrives beside
`packages/action` and there was never anything to download. The action now resolves
`${{ github.action_path }}/../cli/bin/qai.js` and refuses, loudly and by name, when it is
missing or unbuilt. Proved by running all three branches: found and built, present and
unbuilt, absent.

**The name is still unsettled.** What is gone is the hazard, not the question. Q22 remains
open and now decides only what a human types to install the CLI, which is a smaller
question than it was when the answer was also a live risk.

The `@qai` scope returned a 404 for `@qai/core`, which says that package does not exist
and says nothing about who owns the scope. Scope ownership cannot be read without
attempting to claim it.

### 2. There was no LICENSE file

**Closed 2026-08-25 by Q23, answered MIT.**

There was no `LICENSE` and no `license` field in any of the four manifests. Under default
copyright that meant nobody had permission to use, copy, or modify any of it: the registry,
the action, and the corpus applications alike, since those are committed source in the same
tree.

`LICENSE` now holds the MIT text and all four manifests carry `"license": "MIT"`. The text
is the canonical one, copied rather than written, and checked against a reference copy
shipped by a dependency rather than trusted from memory. **Nothing in it is customized.** A
license with a word changed is a license no tool recognizes and every downstream reader has
to actually read, which is the opposite of what picking a standard one is for.

The one line that is not boilerplate is the copyright holder, `2026 Adrian Morton`.

### 3. `main` does not exist

Only `dev` and stage branches are pushed. `PROGRESS.md` recorded this at S7 and it is still
true. `README.md` opens with the headline install:

```yaml
- uses: Bomoga/QAi/packages/action@main
```

That reference cannot resolve. The first thing a reader is told to copy is the first thing
that fails.

### 4. The action had never been run as an action

**Closed 2026-08-25.**

`.github/workflows/qai.yml` checked the fixture on every push, which is a real dogfood and
was not this. It reimplemented the action's steps against a local build, borrowing one
line of its `dist` to read the report. So `action.yml` itself, its input wiring, its exit
code handling, and the `npx` step above had no test and no execution behind them. **The
artifact most exposed by publication was the artifact with the least evidence.**

That workflow now calls `uses: ./packages/action` instead, with `continue-on-error` because
the fixture is deliberately defective and the action is supposed to fail the step. The
assertions moved to the end of the job and grew: exit code 1, a `sarif-file` output naming
a file that exists, and `findings-total`, `findings-error`, and `coverage-percent` all
numeric with the first two above zero. Every one of those is produced by `packages/action`,
so an empty one now means the report reader broke while the CLI stayed fine, which is
exactly the failure the hand written steps could not see.

The duplication is gone with it. There is one path to a SARIF report in this repository and
it is the one that ships.

### 5. `packages/action/dist` is gitignored and uncommitted

`dist/` is in `.gitignore` and `git ls-files packages/action/dist` returns nothing.

A GitHub Action is consumed by checking out the ref. **Nothing builds it on the way in.**
The "Read the report" step runs `node "${{ github.action_path }}/dist/index.js"` against a
file that will not be there, and after the blocker 1 fix the same is true of
`packages/cli/dist`. Either the built output is committed on the release branch, or a
release workflow builds and commits it, or the steps stop depending on a build artifact.
That is a real design choice and it belongs to whoever picks the release mechanism.

**This is now the blocker that actually stops a release**, and it is the reason blocker 1's
fix is a defusing rather than a completion. The action fails on a fresh checkout, by
design, with a message naming this section. That is the correct behaviour for something
unpublishable and it is not a substitute for publishing it.

Worth stating plainly: the workflow added at blocker 4 builds before it calls the action,
so **it proves the action works and does not prove a checkout of it works.** Those are
different claims and only the second one matters to a stranger.

### 6. Every package is `private: true` at version `0.0.0`

Deliberate, from S0.2 onward, and recorded here so nothing on this list is mistaken for an
oversight. `packages/cli/bin/qai.js` says it plainly: the `bin` entry was withheld until it
did something, because `npx qai` should not resolve until it does.

Note the mismatch that publication forces into the open: the package is named `@qai/cli` and
the binary it installs is `qai`. Those can differ, and the action currently calls the
binary name, which is the name that is taken.

### 7. The manifests carry no `repository` or `homepage`

`license` was the third item here and landed with blocker 2. The rest is small and becomes
visible the moment a package page exists.

## Three open questions that are not an agent's call

Q23 is answered and is kept below with its answer, because a plan that deletes a question
once it is settled loses the reason the answer was picked.

Nothing here has a right answer that can be derived from the repository. Each one is
recorded so the plan can proceed once it is answered, and each unanswered one is a stop.

They are numbered `Q` because they are open. `07-DECISIONS.md` holds them in its open
questions table, and answering one turns it into a `D` entry there, which is the same
protocol every other decision in this project followed.

**Q22. The published name.** Three shapes, and they are not equally good:

- Publish `@qai/cli` and `@qai/core` under the `@qai` scope, if the scope can be claimed,
  and have the binary keep the name `qai`. The action then calls `npx --yes @qai/cli`,
  which resolves to something this project controls. Smallest change to what exists.
- Pick an unscoped name that is free, and rename the binary to match it. Larger blast
  radius: the README, the action, the docs, and every example.
- Do not publish to the registry at all. Ship the action and the clone instructions only.
  The action still needs a resolvable CLI, so this shape requires the action to install
  from the repository rather than from the registry.

**Q23. The licence. Answered MIT on 2026-08-25**, and recorded as D22 in `07-DECISIONS.md`.
Apache-2.0 was the alternative and carries an express patent grant and a change notice
requirement, which buys protection that matters most with corporate contributors and patent
risk in play. Neither is true here yet, and MIT is what the ecosystem this ships into
defaults to. Revisiting it later means relicensing, which needs every copyright holder to
agree, so it is cheap now and expensive once anybody else has contributed.

**Q24. Whether the repository becomes public, and when.** It contains the corpus, which
contains 24 deliberately broken applications and the specs describing exactly how they are
broken. That is a teaching asset and it is also a directory of working access control
defects. Publishing it is defensible and it should be a decision rather than a side effect
of flipping repository visibility.

**Q25. How the corpus number is stated in public.** `corpus/RESULTS.md` says 0.0% over 55
judged findings, and says in the same document that the review was performed by the agent
that wrote the tool and the corpus. **Any public statement of the rate that does not carry
that sentence with it is a misrepresentation**, because the number reads as an independent
measurement and is not one. The honest public form is the one the document already reaches:
nothing the tool currently produces is known to be wrong. Whether to seek an independent
review before publishing anything is part of this decision.

## The sequence, once those are answered

Phases, with the gate that ends each one. Nothing in a later phase starts early.

**Phase 0. Decide.** Q22 through Q25. Recorded in `07-DECISIONS.md` like every other
decision this project has made.

**Phase 1. Licence and metadata.** Half done on 2026-08-25: `LICENSE` is at the root and
all four manifests carry `"license": "MIT"`. **Remaining: `repository`, `homepage`, and
`author`**, which are small and become visible the moment a package page exists.
Gate, half met: the licence text lives in exactly one place and every manifest points at it
by SPDX identifier rather than restating it.

**Phase 2. Make the action true.** Mostly done ahead of Phase 0, on 2026-08-25, because two
thirds of it turned out not to need any decision. The `npx --yes qai` line is gone and
`qai.yml` consumes `./packages/action` with `uses:` and asserts the outputs.
Gate, met: the action passes in this repository as an action rather than as copied steps.
**Remaining: the `dist` question from blocker 5**, which is the half that needs a release
mechanism chosen and is therefore the half that waits.

**Phase 3. Honesty pass on the README.** The status line still says the report emitters and
the command surface are the current work; they were finished at S7 and S6. The `npx qai`
caveat has to change to match Q22 either way. The corpus claim, if it appears at all,
carries its limit per Q25.
Gate: every command in the README has been run, from a clean clone, in the form written.

**Phase 4. `main`.** Create it from `dev`. Protect it. Point the action reference at a tag
rather than a branch, because `@main` moves under consumers and a moving action reference
is how a passing pipeline breaks without a commit.
Gate: `main` exists, CI runs on it, and the README reference resolves.

**Phase 5. Version and tag.** `0.1.0` across the workspace, not `1.0.0`. A changelog that
starts here rather than one reconstructed from 28 merged pull requests. Tag `v0.1.0`.
Gate: the tag names a commit that CI passed.

**Phase 6. Publish.** Only if Q22 chose the registry. `@qai/core` and `@qai/cli` together,
since `workspace:*` resolves at pack time and one without the other installs nothing.
Gate: **the stranger's rehearsal**, below.

## The definition of done

S9.4 rehearsed a cold install from a clone. That is not this. The rehearsal that ends this
plan starts from a position nobody in this project has ever occupied:

1. A machine that has never held this repository.
2. A target application that is not `fixtures/ledger` and not a corpus application.
3. The README, followed literally, with nothing inferred and nothing corrected on the way.
4. A GitHub repository that is not this one, running the action by its published reference,
   producing findings inline on a pull request.

If any step needs knowledge that is not written down, the plan is not finished, and the
missing knowledge goes into the README rather than into the operator.

## What an agent does not do here

Stated plainly because this document is a plan for exactly the actions an agent must not
take on its own initiative.

- Do not publish to any registry.
- Do not create `main`.
- Do not tag a release.
- Do not change repository visibility.
- Do not claim a name or a scope in a public namespace.
- Do not state the corpus rate anywhere public without the limit attached.

Drafting this, filling in Phase 1 and Phase 2, and preparing a tag for a human to push are
all ordinary work. The six above are not, and being asked to do the surrounding work is not
authorization for them.
