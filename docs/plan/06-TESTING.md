# Testing Strategy

The tool makes claims about other people's software. It has to be more trustworthy than what it inspects, which means its own test discipline is a product feature, not hygiene.

## Layers

| Layer | Runs against | Speed | Gate |
|---|---|---|---|
| Unit | Pure functions, recorded fixtures | Fast | Every commit |
| Contract | Zod schemas against golden JSON files | Fast | Every commit |
| Integration | `fixtures/ledger` and `fixtures/ledger-express` on localhost | Medium | Every PR |
| Corpus | Twenty to fifty real generated applications | Slow, manual review | Week 8, once |

No test reaches an external host, per rule R9.

## The fixture applications

There are two, and they are one application served twice. `fixtures/ledger` is a deliberately defective invoicing application over `node:http` and is the primary integration target. `fixtures/ledger-express` serves the same API on Express and is the demo subject.

Requirements, and both meet them:

- Minimal stack, one process, boots in under three seconds. Measured 2026-08-21: 0.88s for `pnpm --filter ledger dev` and 0.84s for `pnpm --filter ledger-express dev`.
- Seeded with two organizations and two users, so cross-actor access is testable.
- `fixtures/ledger` ships a `spec/ledger.spec.yaml` of roughly fifteen requirements that describes the app as intended, not as built. **The repository holds exactly one spec and the twin has none of its own**, because both servers implement the same requirements and a second copy would be a second thing to keep in step. A run against either target is pointed at that file; the demo copies it into a project directory, which is what a user writing their own spec produces.
- Every defect is toggleable by environment variable so a single run can exercise both a failing and a passing configuration.
- Includes at least one endpoint that exists but appears in no requirement, and one entity specified but never implemented, so structural diff has something to find.

### Why there are two, added at S9.3

A finding ends with a file reference when source is available, and M4's adapters read Next.js, Express, and Prisma. `fixtures/ledger` is a hand-written `node:http` server, chosen at S0 so the fixture needed no runtime dependencies, and every one of the twenty corpus applications is the same shape. **No adapter recognizes any of them**, so the source path was the one thing nothing exercised and step 3 of the definition of success could not be demonstrated. `fixtures/ledger-express` is a route table an adapter reads, and the line each route is declared on is what a finding cites.

`express` is a dependency of that fixture and of nothing else. `04-CONVENTIONS.md` governs what the product may depend on; a fixture depends on whatever framework it is a fixture of.

### Two transports, one application

This is the rule that makes a second fixture safe rather than a second oracle:

- **Every decision lives in `fixtures/ledger/src/handlers.ts`, which both servers call.** `app.ts` and `routes.ts` hold routing and nothing else. Two copies of a seeded defect would drift, and a defect that behaved differently depending on which server was running would make every finding about it unreadable, including the ones in this catalog.
- **`fixtures/ledger-express/test/parity.test.ts` is the guard.** It sends the same requests to both servers in both defect states and compares status and body. It is a matrix rather than a handful of cases, because a routing difference hides behind whichever requests nobody wrote down. It caught two real divergences while being written, both from Express comparing paths more loosely than `url.pathname === ...` does.
- A deliberate difference between the two is recorded in the catalog below and asserted in both directions, never left as a silent divergence for the matrix to trip over later.

### Defect catalog

Each defect has an identifier, an expected finding, and an expected severity. This table is the integration test's oracle. The last column says which servers carry the defect, because one of them does not carry all of it.

| Id | Defect | Expected check | Expected severity | Served by |
|---|---|---|---|---|
| D1 | Invoice readable across organizations by id | access, deny rule AR-014-01 | high | both |
| D2 | Invoice list endpoint returns unscoped rows | access, deny rule on `list` | high | both |
| D3 | Mutation endpoint accepts unauthenticated requests | access, deny rule on `update` | high | both |
| D4 | Sensitive field returned in a response that should omit it | behavioral, deterministic | high | both |
| D5 | Undeclared debug endpoint present | structural, observed not specified | medium | **`ledger` only** |
| D6 | Specified audit entity never implemented | structural, specified not observed | low | both, by being absent from both |
| D7 | Requirement with no checks defined | unverified, `no-checks-defined` | info | neither, it is a spec fact |

**D4's expected severity moved from medium to high at Q8, on 2026-08-22.** A behavioral
finding took its severity from one constant, `medium`, while the default failure threshold
is `high`, so a criterion that caught a real leak reported it correctly and the run exited
0. Four corpus applications did that. Severity now comes from the requirement's tags: a
criterion on a requirement tagged `access-control` or `data-exposure` fails at `high`, and
everything else stays `medium`. REQ-004 is tagged `data-exposure`, so D4 is high. The
fixture's severity counts moved from `high 3, medium 6` to `high 8, medium 1` and no
verdict changed.

**D5 is the one defect the Express twin does not serve, and `LEDGER_DEFECT_D5` is forced off there rather than ignored.** A source adapter reads text, so a route registered behind a runtime condition is still declared in the file. With the defect switched off the twin would report an endpoint it refuses to serve, which is a finding about a variable rather than about an application. Fixing that defect means deleting the route, which an environment variable cannot model. Three tests hold the difference: the twin refuses the route and omits it from its own route index whatever the switch says, and `fixtures/ledger` still serves it, so the switch cannot quietly stop meaning anything.

A consequence worth knowing before reading a run: **a check against the twin reports 8 verified, 5 failed, 2 unverified where the same spec against `fixtures/ledger` reports 7, 6, 2.** The whole difference is D5.

Two negative controls are mandatory and are as important as the defects themselves:

| Id | Correct behavior | Expected result |
|---|---|---|
| N1 | Owner reads own invoice successfully | allow rule passes, no finding |
| N2 | Endpoint correctly refuses a cross-org write | no finding |

A change that makes N1 or N2 produce a finding is a false positive and blocks merge, per invariant I2. Both hold on both servers, and the parity matrix is what says so rather than a second pair of assertions.

## Golden files

Store canonical `RunResult` JSON for `fixtures/ledger` in both defective and fixed configurations. **The goldens are captured against that server only.** An observation of the twin carries source endpoints, handler references, and hybrid confidence, so a golden of it would pin the Express adapter's reading as well as the report's shape, and a route moving down a file by one line would fail an emitter test. What the twin is for is demonstrating the source path end to end, which the integration tests and the demo do directly. Emitter tests render from these fixtures rather than from live runs, which keeps report work decoupled from check work.

Regenerate goldens only with an explicit command, reviewing the diff by hand. Never regenerate in bulk to make a suite pass; a golden diff is either an intended product change or a regression, and it must be classified by a human.

Determinism requirements that make goldens viable, per rule R6: injected clock, injected identifier generation, stable check identity hashing, and sorted output ordering everywhere a collection is serialized.

## The corpus run, week 8

Purpose: produce a defensible number and calibrate false positives before anyone else sees the tool.

Procedure:

1. Collect twenty to fifty generated applications. Sources, in order of preference: applications generated specifically for this purpose from a fixed prompt set, open source projects that state they were AI generated, and applications built by classmates who consent.
2. For each, hand-write a shallow spec of five to ten requirements focused on access rules, which is the check family with the most signal.
3. Run the tool. Record every finding.
4. Manually review every single finding and classify it as true positive, false positive, or unclear. This is the expensive step and it is not optional.
5. Compute per-check false positive rate. Disable any check above five percent before the demo.
6. Publish the aggregate: how many applications had at least one access rule that was specified and not enforced.

A limit on the published number, recorded here because it is a property of the corpus rather than of the run: **every one of the twenty applications is a hand-written `node:http` server, so the whole corpus was probed black box.** The rate says nothing about findings derived from source, because none was produced. `fixtures/ledger-express` is the only place the source path is exercised at all, and a future corpus wanting to measure it has to be generated on a framework an adapter reads.

Ethics and scope: only applications the author owns or has explicit permission to inspect. No third party production systems, no reconnaissance of applications belonging to others, no publication of any finding tied to an identifiable third party application without consent. The tool is pointed at consenting targets only, and the corpus documentation states this plainly.

## What is not tested

Browser-driven fuzzy checks get thin coverage by design; they are the least deterministic part and the least load bearing. Do not spend week 5 building an elaborate harness for them.
