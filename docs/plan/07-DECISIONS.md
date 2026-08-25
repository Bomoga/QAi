# Decisions

Decisions already made, with their volatility and what breaks if they reverse. Consult before proposing a change. Reversing anything marked **frozen** requires a human decision, not an agent's judgment call.

Format: decision, rationale, volatility, blast radius.

---

**D1. The spec is the oracle, not an input to generation.**
Generators do not accept structured contracts, so a spec fed forward would be flattened into prose. Its value is realized downstream instead, where one requirement becomes a test, a probe expectation, and a report row.
**Volatility:** frozen. **Blast radius:** the entire architecture. Everything else follows from this.

**D2. No language model in the verdict path.**
The audience is technical and will assume the tool is vibes checking vibes unless the boundary is structural and stated. A hallucination should cost a bad sentence, never a wrong verdict.
**Volatility:** frozen. **Blast radius:** invariant I1, rule R1, `llm/` isolation, the `modelAssistedCheckCount` field, and the entire trust argument.

**D3. CLI and CI first, no UI in the sprint.**
The engine is the part that makes defensible claims. A UI built against a moving schema gets rebuilt.
**Volatility:** low, revisit after week 6 only. **Blast radius:** small by construction, because RunResult is the boundary. A UI is a new package consuming existing JSON.

**D4. Local execution only, no hosted service.**
Users hand over credentials and repository access. Asking them to send those to a student project whose premise is that generated software mishandles credentials is not viable.
**Volatility:** low. **Blast radius:** removes auth, multi-tenancy, secret storage, and job infrastructure from scope. Reversing adds roughly four weeks.

**D5. Source-first probing, black box fallback.**
Engineers have the source. Parsing beats inferring on precision and on the ability to cite a file and line.
**Volatility:** medium. **Blast radius:** M4 only. The Observation contract already carries `origin` and `confidence` to absorb either mode.

**D6. Access checks before behavioral checks.**
They are deterministic, need no browser, and produce the sharpest finding. They also require no judge, which means stage S3 is demonstrable without any model integration.
**Volatility:** low. **Blast radius:** build order only.

**D7. Verdicts live in RunResult, not in the spec.**
Earlier drafts placed `status` and `evidence` on the requirement. That conflates input with output, breaks run comparison, and makes specs unreviewable.
**Volatility:** frozen. **Blast radius:** invariant I5, all three contracts, the delta feature in M6.

**D8. Precision over recall, five percent false positive ceiling.**
Two false positives lose an engineer permanently. The ceiling is enforced by the corpus run, not by intuition.
**Volatility:** frozen. **Blast radius:** invariant I2, the week 8 procedure, and the willingness to ship fewer checks.

**D9. TypeScript on Node 22, monorepo with core, cli, action.**
Existing fluency, best ecosystem for HTTP and browser work, natural for an `npx` distributed tool.
**Volatility:** frozen for the sprint. **Blast radius:** total.

**D10. SQLite for run storage.**
Run history is needed for the delta feature, and querying across runs gets awkward with files on disk.
**Volatility:** medium. **Blast radius:** M6 only, behind a store interface.

**D11. Hand-written specs for the MVP; extraction deferred.**
Checks must be proven before a model is trusted to author their input.
**Volatility:** medium, gated on stages S0 through S6 completing by week 6. **Blast radius:** M9 only.

**D12. Product name is QAi.**
Quality assurance with AI. Display form `QAi`, identifier token `qai`.
**Volatility:** frozen. **Blast radius:** naming table in `00-INDEX.md` only, by construction.

**D13. `RunResult` carries a summary of its own Observation. Q6, decided 2026-08-22.**
It carried `ref` alone, and three consumers needed what was behind it: the text report's
second section, which had to take the Observation as a caller option and so was not a
projection of a RunResult; `qai report`, which has only a stored run and printed the
reference instead of counts; and the half of M6.5's access loosening rule that fires when
an endpoint's `authRequired` moves away from `true`, which was never built. The summary
carries counts by origin and confidence, the probe mode, the probe's notes, and an
endpoint list of identity plus `authRequired`, and nothing else: no response shapes, no
evidence ids, no `actorVisibility`.
**Volatility:** low once set. **Blast radius:** `resultVersion` to 0.2, `assembleRun`, both
goldens, `renderText`, `diffRuns`, and `qai report`.

**D14. The unverified reason set gains `no-verdict-reached`. Q7, decided 2026-08-22.**
There was no member for "the checks ran and none reached a verdict", so `assembleRun` fell
back to `check-error` and the tool reported an error five times when it was declining to
guess, which is invariant I2 working. `check-error` keeps meaning that something threw.
`detail` carries the specifics, so one member covers both sub-cases.
**Volatility:** low. **Blast radius:** the enum, the fallback, both goldens, and the two
emitters that print the reason verbatim.

**D15. Behavioral severity comes from the requirement's tags. Q8, decided 2026-08-22.**
A behavioral finding was `medium` from a constant while the default failure threshold is
`high`, so a criterion that caught a real data leak reported it correctly and the run
exited 0, on four corpus applications. A criterion on a requirement tagged
`access-control` or `data-exposure` now fails at `high`. Rejected: lowering the default
threshold, which makes every weak criterion break a build and invites users to raise it
back, gaining nothing.
**Volatility:** medium, and worth revisiting when a larger corpus can say whether `high` is
noisy in practice. **Blast radius:** `behavioralSeverityFor`, both goldens, the Action's
output counts, and D4's row in the defect catalog.

**D16. A denied delete is settled by reading the record. Decided 2026-08-22.**
A 2xx carrying no resource fields is undecidable from the response, which is right for a
read and cost the corpus a finding on a delete three times. The record is read as the
configured `stateActor` before the action and again after, and only readable then absent
is a failure. Everything else keeps the existing inconclusive.
**Volatility:** low. **Blast radius:** M3's verdict table, `AccessRunContext`, and the
finding text. `update` is deliberately not covered.

**D17. Source adapters at MVP are Next.js App Router, Express, and Prisma. Q1, implemented as proposed.**
Read textually with globs and regex rather than through an AST, because the patterns in
generated code are regular and the alternative was a dependency. `@prisma/internals` was
put up for the schema and refused on 2026-08-16 in favour of reading `schema.prisma` the
same way the route adapters read source.
**Volatility:** low. Adding a fourth framework is additive and needs approval, per M4's Do Not.
**Blast radius:** `packages/core/src/probe/source/` only.

**D18. Actor credentials are named environment variables, never literals in config. Q2, implemented as proposed.**
`tokenEnv` and `valueEnv` are constrained to look like variable names, and a literal secret
in a config is rejected at load with a message that names the fix rather than reporting an
unrecognized key. An actor whose variable is unset is dropped rather than given a blank
credential, since a blank one produces a 401 that reads as a finding.
**Volatility:** frozen. **Blast radius:** M2's config schema and every fixture config.

**D19. A target declares its own reset command, and mutating checks are refused without one. Q3, implemented as proposed.**
The disposability gate requires both `disposable: true` and a `resetCommand`, and it is not
overridable by a flag: an interlock somebody in a hurry can reach past is not an interlock.
**Corrected 2026-08-22**: the runner had taken a reset since M3.7 and no caller ever supplied
one, so no real run reset anything. The CLI supplies it now and also runs one between the
access family and the behavioral family.
**Volatility:** low. **Blast radius:** M2's fixtures module, the access runner, and `check`.

**D20. The condition grammar is equality, inequality, membership, and conjunction. Q4, answered by use at M1.8.**
The proposed subset expressed every access rule the fixture spec needed, four conditions
across eight rules, and nothing wanted disjunction, ordering comparison, or negation. A rule
carrying no condition is an unconditional denial, which is a real shape rather than a gap.
**Volatility:** medium. Widening it is additive; a rule outside it is a load error rather than
a silent skip, so the failure mode of being too narrow is visible.
**Blast radius:** `spec/condition.ts` and the evaluator.

**D21. A deny rule on `list` asserts the absence of foreign rows, not an empty response. Q5, implemented as proposed.**
Rows must be present and identifiable for a pass. An empty list is inconclusive, because an
endpoint scoping correctly and a dataset that happens to be empty are indistinguishable from
outside, and a row whose ownership cannot be judged also blocks a pass.
**Volatility:** low. **Blast radius:** `checks/access/list.ts` and the list half of the verdict table.

---

## Open questions, unresolved

These are known gaps. An agent encountering one stops and reports rather than deciding.

**Four, all outward facing, raised 2026-08-24 while drafting `08-PUBLICATION.md`.** They are
stated in full there and summarized here, because this table is the one an agent reads to
decide whether to stop.

| Id | Question | Why it is not an agent's call |
|---|---|---|
| Q22 | What name does a stranger type to install this | `qai` on the public registry has belonged to somebody else since 2019, so `npx qai` cannot mean this project. Claiming a name in a public namespace is not an agent's action. |
| Q23 | MIT or Apache-2.0 | There is no LICENSE file, so no permission to use anything exists yet. A licence is a legal claim by the author. |
| Q24 | Does the repository become public, and when | It carries 24 deliberately broken applications and the specs describing how. Defensible to publish, and it should be a decision rather than a side effect. |
| Q25 | How the corpus rate is stated in public | 0.0% reads as an independent measurement and is not one. Any public form without that sentence attached misrepresents it. |

**Q22 no longer holds a live hazard, as of 2026-08-25.** It did: `packages/action/action.yml`
ran `npx --yes qai check`, which would have resolved to the stranger's package the moment
the action became reachable from another repository. The fix did not need the name, because
an action is distributed by repository checkout and the CLI was always going to arrive with
it. The action resolves `${{ github.action_path }}/../cli/bin/qai.js` and refuses loudly
when it is absent or unbuilt. Q22 now decides only what a human types to install the CLI
directly, which is worth answering and is no longer urgent.

**Cleared once before, on 2026-08-23**, and the note below is kept because the lesson holds.

Q1 through Q5 sat in this table until then and every one of them had shipped as proposed,
some of them stages earlier: Q4 was answered by use at M1.8, Q5's own module file said
"Q5 can be marked resolved by a human", and M2 recorded Q2 and Q3 as "implemented as
written". They are D17 to D21 above. Q6, Q7, and Q8 were raised later, decided on
2026-08-22, and are D13 to D15.

**Worth saying why this mattered rather than just fixing it.** This table is what an agent
reads to decide whether to stop, and a question listed as open when it was settled is an
instruction to stop for no reason. It overstated what was undecided by five entries for
most of the project. The rule that would have caught it: whoever implements a proposal
strikes the question in the same PR, the way a contract change is required to update
`03-CONTRACTS.md` in the same PR.

**Q6, Q7, and Q8 were resolved on 2026-08-22 and are recorded above as D13, D14, and D15.**
They were written up in full before being put to a human, each having been hit more than
once, and each is a contract or severity change that `04-CONVENTIONS.md` says an agent may
not settle. The fourth question decided that day, whether a denied delete that returns
nothing is a failure, is D16; it was a verdict rule, which the same document says never to
guess at.
