# The corpus result

Twenty generated applications, each with a hand-written spec, run through the tool once,
with every finding reviewed by hand and classified. This is the number the project has to
be able to defend, and the limits on it are part of the result rather than a footnote
under it.

Run `20260821130520`. Reproduce with `pnpm build`, then `node --experimental-strip-types
corpus/run.ts`, then `node --experimental-strip-types corpus/review.ts`. The classifications
live in `corpus/ledger.json` and are keyed by the finding's content hash, so re-running the
corpus only asks about findings that are genuinely new.

## The false positive rate

|             | False positive rate | Judged |
| ----------- | ------------------- | ------ |
| access      | 0.0%                | 4      |
| behavioral  | 0.0%                | 12     |
| structural  | 0.0%                | 22     |
| **overall** | **0.0%**            | **38** |

Thirty-eight findings, thirty-eight true positives, no false positives, and nothing
unreviewed. Invariant I2 puts the ceiling at five percent per check, so no check is above
it and none was disabled.

Four earlier reviews are held in the ledger and excluded from this rate, marked `absent`,
because the tool no longer produces them. All four were false positives in the structural
diff and all four were fixed at S8.6 rather than suppressed. Before that fix the structural
rate was 36.4% over eleven judged. The three causes are recorded in
`docs/plan/modules/M4-probe.md`.

## Per application

Correct means the application does what its spec says. Broken means at least one
requirement is deliberately not met. Findings are failed checks plus structural
disagreements, which is what `renderSarif` treats as a finding.

| Application                | Intent               | Reqs    | ver / fail / unv | Checks  | pass / fail / inc | Findings | TP     | FP    |
| -------------------------- | -------------------- | ------- | ---------------- | ------- | ----------------- | -------- | ------ | ----- |
| p1-invoicing-middleware    | correct              | 6       | 6 / 0 / 0        | 11      | 11 / 0 / 0        | 1        | 1      | 0     |
| p1-invoicing-header-filter | correct              | 7       | 7 / 0 / 0        | 12      | 12 / 0 / 0        | 1        | 1      | 0     |
| p1-invoicing-empty-list    | correct              | 6       | 6 / 0 / 0        | 11      | 10 / 0 / 1        | 1        | 1      | 0     |
| p2-tickets-query-filter    | correct              | 6       | 6 / 0 / 0        | 11      | 11 / 0 / 0        | 1        | 1      | 0     |
| p2-tickets-agent-404       | correct              | 6       | 6 / 0 / 0        | 11      | 11 / 0 / 0        | 1        | 1      | 0     |
| p2-tickets-header-agent    | correct              | 6       | 6 / 0 / 0        | 12      | 12 / 0 / 0        | 1        | 1      | 0     |
| p3-notes-strict            | correct              | 6       | 6 / 0 / 0        | 12      | 12 / 0 / 0        | 1        | 1      | 0     |
| p3-notes-shared-flag       | broken               | 6       | 5 / 1 / 0        | 10      | 9 / 1 / 0         | 2        | 2      | 0     |
| p3-notes-delete-open       | broken               | 6       | 5 / 0 / 1        | 13      | 10 / 0 / 3        | 1        | 1      | 0     |
| p4-bookings-cookie         | correct              | 8       | 8 / 0 / 0        | 16      | 16 / 0 / 0        | 2        | 2      | 0     |
| p4-bookings-open           | broken               | 5       | 1 / 4 / 0        | 10      | 3 / 5 / 2         | 6        | 6      | 0     |
| p5-files-membership        | correct              | 5       | 5 / 0 / 0        | 9       | 9 / 0 / 0         | 1        | 1      | 0     |
| p5-files-listed-contents   | broken               | 6       | 5 / 1 / 0        | 9       | 8 / 1 / 0         | 2        | 2      | 0     |
| p6-messages-strict         | correct              | 8       | 7 / 0 / 1        | 14      | 14 / 0 / 0        | 1        | 1      | 0     |
| p6-messages-guard          | correct              | 6       | 6 / 0 / 0        | 13      | 13 / 0 / 0        | 1        | 1      | 0     |
| p6-messages-dm-leak        | broken               | 5       | 3 / 1 / 1        | 8       | 6 / 1 / 1         | 3        | 3      | 0     |
| p7-inventory-manager-only  | correct              | 7       | 7 / 0 / 0        | 14      | 14 / 0 / 0        | 1        | 1      | 0     |
| p7-inventory-open          | broken               | 6       | 2 / 4 / 0        | 9       | 2 / 7 / 0         | 8        | 8      | 0     |
| p8-enrolment-middleware    | correct              | 9       | 9 / 0 / 0        | 15      | 15 / 0 / 0        | 1        | 1      | 0     |
| p8-enrolment-course-leak   | broken               | 6       | 5 / 1 / 0        | 10      | 9 / 1 / 0         | 2        | 2      | 0     |
| **Total**                  | 13 correct, 7 broken | **126** | 111 / 12 / 3     | **230** | 207 / 16 / 7      | **38**   | **38** | **0** |

**No correct application produced a single failed check.** Thirteen of them, across four
credential kinds, four enforcement styles, and four refusal shapes, and the access and
behavioral families did not fire once on any of them. That is what a 0.0% rate has to mean
before it means anything.

The fourteen findings against correct applications are all structural and all benign: one
route index per application at `info`, plus `Booking.cancelled` on `p4-bookings-cookie`,
which is a field the application returns and the spec does not declare. Every one is
literally true.

## The aggregate 06-TESTING asks for

**How many applications had at least one access rule specified and not enforced.**

**Five of twenty**, established by review: `p3-notes-shared-flag`, `p3-notes-delete-open`,
`p4-bookings-open`, `p6-messages-dm-leak`, and `p7-inventory-open`. The other two broken
applications, `p5-files-listed-contents` and `p8-enrolment-course-leak`, are wrong at the
field level with every access rule correctly enforced.

The tool did not establish that number on its own, and the difference is the useful part:

- **Two of the five** were reported by a **failed access check**: `p4-bookings-open` and
  `p7-inventory-open`.
- **Two more** were reported by a **failed behavioral criterion** while every access check
  passed: `p3-notes-shared-flag` and `p6-messages-dm-leak`. In both cases the access check
  ran against a seeded instance the application does refuse, and the violation is on a
  different instance. That is candidate selection working as specified and finding the
  wrong record.
- **One was missed entirely.** `p3-notes-delete-open` lets anybody signed in delete
  anybody's note, and the tool reported no finding for it. See below.

## What the corpus found out about the tool

These are recall problems rather than precision problems, so none of them moves the rate.
They are the most valuable thing this run produced.

**A successful destructive request that returns no fields is inconclusive, not a
failure.** `DELETE /api/notes/N-1 as actor stranger returned 200 with no recognizable
fields, which may be a refusal or a response in a shape this check does not recognize.`
The record was destroyed. The verdict table treats a 2xx carrying no resource fields as
undecidable, which is the right call for a read and costs a finding on a delete. It
happened three times: twice on `p4-bookings-open` and once on `p3-notes-delete-open`.

**A destructive check changes the application under the checks that follow it.** On
`p3-notes-delete-open` the access check deleted the note, so the acceptance criterion that
would have caught the same defect reported `Note N-1 did not exist before the action, so
nothing could change`. On `p4-bookings-open` an anonymous delete then **passed** with a 404
because the previous check had already removed the record. The disposability gate worked
and the target declared itself disposable; what is missing is a reset between checks, and
a corpus whose applications hold state in memory cannot provide one from outside.

**Nothing was reported as verified when it was not.** `p3-notes-delete-open` came back with
REQ-003 `unverified`, not `verified`. The tool did not claim the rule held; it said it
could not tell. That is invariant I4 doing exactly what it is for, and it is the difference
between a miss and a lie.

**`check-error` is reported when nothing errored, for the fourth time.** `2 check(s) ran and
none reached a verdict` is not an error, and the closed reason set in `03-CONTRACTS.md` has
no member for it. A contract question, recorded and not resolved here.

**A real data leak can be reported at `medium` and not fail the run.** Behavioral findings
are medium and the default threshold is high, so `qai check` exited 0 against
`p6-messages-dm-leak`, `p3-notes-shared-flag`, `p5-files-listed-contents`, and
`p8-enrolment-course-leak`. Each piece is defensible and the combination is not. A product
decision, recorded and not resolved here.

## The limits on this number, which are part of it

**The corpus was generated by the same model that wrote the checker.** Both sides share
that model's habits, so a pattern the checker is blind to is a pattern the generator is
unlikely to produce, and the rate reads better than one measured against applications
written by strangers. The prompt set in `corpus/prompts.md` was fixed before the corpus was
built and deliberately names enforcement styles, refusal shapes, and credential kinds that
push against this. It cannot remove the bias.

**The review was performed by the same agent that wrote the tool and the corpus.** Step
four of the procedure in `06-TESTING.md` exists to be independent and this one was not.
This is the largest single limit on the number. A reviewer who wrote the check being judged
knows what it was trying to do, and knowing that makes a borderline finding easier to read
as correct. Every classification carries a written reason in `corpus/ledger.json` so that a
second reader can disagree with a specific one rather than with the total.

**Twenty is the lower bound the procedure names, not a large sample.** The rate has a
denominator of thirty-eight findings, and one contested classification would move it by
2.6 points. Seven of the twenty applications were written to be broken, which is a much
higher proportion than a real population would have, and that inflates the true positive
count without saying anything about precision.

**Every application is a small `node:http` server.** No framework, no ORM, no database.
That means no source adapter ran, every observation is a black box crawl, and every entity
is inferred rather than read from a schema. The structural diff's schema path is therefore
untested by this corpus, and the crawl's coverage is the ceiling on what any field level
structural finding could see.

**One finding per application is the same finding.** The route index at `/` accounts for
twenty of the thirty-eight, all correctly rated `info`. Removing them leaves eighteen
findings, still no false positives, and a rate over a smaller denominator.
