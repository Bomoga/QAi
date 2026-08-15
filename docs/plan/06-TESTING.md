# Testing Strategy

The tool makes claims about other people's software. It has to be more trustworthy than what it inspects, which means its own test discipline is a product feature, not hygiene.

## Layers

| Layer | Runs against | Speed | Gate |
|---|---|---|---|
| Unit | Pure functions, recorded fixtures | Fast | Every commit |
| Contract | Zod schemas against golden JSON files | Fast | Every commit |
| Integration | `fixtures/ledger` on localhost | Medium | Every PR |
| Corpus | Twenty to fifty real generated applications | Slow, manual review | Week 8, once |

No test reaches an external host, per rule R9.

## The fixture app

`fixtures/ledger` is a deliberately defective invoicing application. It is the primary integration target and the demo subject. Requirements:

- Minimal stack, one process, boots in under three seconds, `pnpm --filter ledger dev`.
- Seeded with two organizations and two users, so cross-actor access is testable.
- Ships a `spec/ledger.spec.yaml` of roughly fifteen requirements that describes the app as intended, not as built.
- Every defect is toggleable by environment variable so a single run can exercise both a failing and a passing configuration.
- Includes at least one endpoint that exists but appears in no requirement, and one entity specified but never implemented, so structural diff has something to find.

### Defect catalog

Each defect has an identifier, an expected finding, and an expected severity. This table is the integration test's oracle.

| Id | Defect | Expected check | Expected severity |
|---|---|---|---|
| D1 | Invoice readable across organizations by id | access, deny rule AR-014-01 | high |
| D2 | Invoice list endpoint returns unscoped rows | access, deny rule on `list` | high |
| D3 | Mutation endpoint accepts unauthenticated requests | access, deny rule on `update` | high |
| D4 | Sensitive field returned in a response that should omit it | behavioral, deterministic | medium |
| D5 | Undeclared debug endpoint present | structural, observed not specified | medium |
| D6 | Specified audit entity never implemented | structural, specified not observed | low |
| D7 | Requirement with no checks defined | unverified, `no-checks-defined` | info |

Two negative controls are mandatory and are as important as the defects themselves:

| Id | Correct behavior | Expected result |
|---|---|---|
| N1 | Owner reads own invoice successfully | allow rule passes, no finding |
| N2 | Endpoint correctly refuses a cross-org write | no finding |

A change that makes N1 or N2 produce a finding is a false positive and blocks merge, per invariant I2.

## Golden files

Store canonical `RunResult` JSON for the fixture app in both defective and fixed configurations. Emitter tests render from these fixtures rather than from live runs, which keeps report work decoupled from check work.

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

Ethics and scope: only applications the author owns or has explicit permission to inspect. No third party production systems, no reconnaissance of applications belonging to others, no publication of any finding tied to an identifiable third party application without consent. The tool is pointed at consenting targets only, and the corpus documentation states this plainly.

## What is not tested

Browser-driven fuzzy checks get thin coverage by design; they are the least deterministic part and the least load bearing. Do not spend week 5 building an elaborate harness for them.
