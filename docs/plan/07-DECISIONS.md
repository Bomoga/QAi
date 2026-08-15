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

---

## Open questions, unresolved

These are known gaps. An agent encountering one stops and reports rather than deciding.

| Id | Question | Blocks | Needed by |
|---|---|---|---|
| Q1 | Which frameworks do source adapters support at MVP? Proposal: Next.js route handlers, Express routers, Prisma schema. | M4 | Week 4 |
| Q2 | How are actor credentials supplied? Proposal: config file references environment variables, never literal secrets. | M2 | Week 2 |
| Q3 | How is fixture state reset between mutating checks? Proposal: target declares a reset command; refuse mutating checks if absent. | M2, M5 | Week 2 |
| Q4 | What is the condition grammar's exact supported subset? Proposal: equality, inequality, membership, and conjunction over `actor.*` and `<Entity>.*`. | M1 | Week 2 |
| Q5 | Does a `list` action deny rule assert zero rows, or absence of foreign rows? Proposal: absence of foreign rows, since empty lists are ambiguous. | M3 | Week 3 |
