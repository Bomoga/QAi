# The corpus result

Twenty-four generated applications, each with a hand-written spec, run through the tool and
with every finding reviewed by hand and classified. This is the number the project has to
be able to defend, and the limits on it are part of the result rather than a footnote
under it. **The limits section applying to the current number is the one above the rule,
not the one at the foot of the document**, which is the S8 era record and is scoped as
such.

Run `20260821130520`, re-run as `20260822041919` after the recall fixes, and re-run again
on 2026-08-23 with four applications added; the re-run is the second section below and
everything after it is the original. Reproduce with
`pnpm build`, then `node --experimental-strip-types corpus/run.ts`, then
`node --experimental-strip-types corpus/review.ts`. The classifications
live in `corpus/ledger.json` and are keyed by the finding's content hash, so re-running the
corpus only asks about findings that are genuinely new.

## Expanded to four frameworks' worth of source, 2026-08-23

Four applications were added, taking the corpus to twenty-four, and they exist to remove
the largest structural gap in the number rather than to make it bigger. Every application
before them is a hand-written `node:http` server, so **no source adapter had ever run
against a corpus application**: every observation was black box, every entity was inferred
from a response, and two of the three adapters the tool ships were measured by one fixture.

| Application                          | Framework          | Intent       | What it exercises                                      |
| ------------------------------------ | ------------------ | ------------ | ------------------------------------------------------ |
| `p9-expenses-express-strict`         | Express            | correct      | the Express adapter on an application that is right    |
| `p9-expenses-express-middleware-gap` | Express            | subtly wrong | a middleware that authenticates and does not authorize |
| `p10-catalog-prisma-strict`          | Express and Prisma | correct      | entities read from a schema rather than inferred       |
| `p10-catalog-prisma-draft-leak`      | Express and Prisma | subtly wrong | a field the spec declares and the model does not have  |

|             | False positive rate | Judged |
| ----------- | ------------------- | ------ |
| access      | 0.0%                | 10     |
| behavioral  | 0.0%                | 14     |
| structural  | 0.0%                | 31     |
| **overall** | **0.0%**            | **55** |

**Twelve new findings, twelve true positives, and the rate holds.** Fifty-five judged where
the S8 run judged thirty-eight.

**A corpus finding cites a file for the first time.** `p9-expenses-express-middleware-gap`
hands any signed in person somebody else's expense, and the finding names the line:

```
GET /api/expenses/EXP-1 as actor colleague returned 200 with Expense fields
amount_cents, approved, id, memo, submitted_by.
Source: index.ts:102
```

Line 102 is `app.get('/api/expenses/:id', requireSignIn, ...)`, the route whose middleware
answers whether the caller is signed in and never asks whether the record is theirs. The
list route on the line above filters correctly and passes, which is the shape that says the
tool read the two routes separately.

**The structural diff's schema path ran for the first time.** `p10-catalog-prisma-strict`
observes two entities with `origin: schema` and high confidence, where every other
application in the corpus reports `inferred`. Its broken sibling declares
`Product.discontinued_at`, which `prisma/schema.prisma` does not have, and the diff reports
it:

```
fieldMismatches: [{ entity: 'Product', specifiedNotObserved: ['discontinued_at'] }]
```

That rule was added at S8.6, to stop a field the crawl never requested being reported as
missing, and **it could not fire for any application in the corpus that motivated it**,
because none had a schema for the observed field list to come from.

### What the expansion found in the tool

**A real false positive, in name matching.** `singular('expenses')` returned `expens`, so
`/api/expenses/:id/approve` matched no entity and the structural diff reported an endpoint
the spec plainly covers. The rule strips `es` after s, x, z, ch, or sh, which is right for
`buses` and wrong for `expenses`: both end in `ses` and nothing separates `bus` plus `es`
from `expense` plus `s`. Every noun the corpus had used until then happened to dodge it,
`invoices` included, because `c` is not in that set.

`namesMatch` now compares two small candidate sets rather than one chosen singular, and
`Expense` still does not match `Expenditure`. **It was found by adding one noun**, which is
the argument for varying the corpus rather than enlarging it.

**It is classified in the ledger rather than deleted from it**, marked `false-positive` and
held aside as `absent`, the same treatment the four false positives S8.6 repaired receive.
That is deliberate: an entry the latest run no longer produces is excluded from the rate,
and keeping it is the only evidence that fixing a cause moved the number rather than the
number simply never having noticed. **Five of the six findings held aside are repaired
false positives**, which is the honest reading of "0.0%": not that the tool has never been
wrong, but that nothing it currently produces is.

**A spec authoring trap worth knowing, hit twice while writing these.** A boolean is written
`'false'` in an access rule condition and `false` in an acceptance criterion. Both are
right: a condition compares against a configured instance attribute and configuration can
only hold strings, while a criterion compares against the JSON the application returned.
The grammars refuse the wrong one rather than guessing, which is how both mistakes surfaced
immediately, but a spec author writing both in one file has to know the difference.

### What this still does not cover

**Next.js is not here, and pretending otherwise was the alternative.** The adapter reads
`app/**/route.ts`, and a tree of those files served by anything other than Next is a Next
shaped fiction rather than a Next application. Running a real one means the framework, a
build step, and a boot time the corpus runner is not built for. So the corpus does not
measure the Next adapter and `fixtures/next-routes` does instead, by booting Next and
requesting every URL the adapter derives. That is the claim the corpus cannot make, made
somewhere the framework can settle it.

**Four applications is not a framework survey.** Twenty of twenty-four are still
`node:http`, so the source path is measured across four applications and the schema path
across two.

## The aggregate 06-TESTING asks for, current

**How many applications had at least one access rule specified and not enforced.**

**Six of twenty-four**, established by review: `p3-notes-delete-open`,
`p3-notes-shared-flag`, `p4-bookings-open`, `p6-messages-dm-leak`, `p7-inventory-open`, and
`p9-expenses-express-middleware-gap`.

**The tool now reports a failed access check on all six.** At the S8 run it reported two of
five that way, caught two more only through a behavioral criterion, and missed one
entirely. The recall fixes closed that gap and the sixth application was added after them.

Three further applications are broken and are correctly absent from this list, because
every access rule they state is enforced and the defect is elsewhere:
`p5-files-listed-contents`, `p8-enrolment-course-leak`, and `p10-catalog-prisma-draft-leak`
all leak through a listing or a field rather than through a rule the spec wrote down. The
tool reports each of them through a behavioral criterion, which is the check family that
covers what an access rule cannot say.

## The limits on this number, which are part of it

Current as of 2026-08-24, over twenty-four applications and fifty-five judged findings.

**The corpus was generated by the same model that wrote the checker.** Both sides share
that model's habits, so a pattern the checker is blind to is a pattern the generator is
unlikely to produce, and the rate reads better than one measured against applications
written by strangers. The prompt set in `corpus/prompts.md` was fixed before the corpus was
built and deliberately names enforcement styles, refusal shapes, and credential kinds that
push against this. It cannot remove the bias.

**The review was performed by the same agent that wrote the tool and the corpus.** Step
four of the procedure in `06-TESTING.md` exists to be independent and this one was not.
This is still the largest single limit on the number, and it is worse than a reviewer being
generous to their own work. For any one application the same agent wrote the application,
the spec that says the application is wrong, the check that looks for it, the wording of
the finding, and the verdict that the finding is correct. Those are not five judgements
agreeing. They are one belief counted five times, and a belief that is wrong makes all five
wrong in the same direction, where they will still agree with each other.

**That is not hypothetical, and the corpus itself is what showed it.** The `expenses`
reading as `expens` false positive survived a full review pass. It was not caught by
reviewing more carefully; it was caught by adding a noun the name matcher had never seen,
which is an external perturbation rather than a judgement. Every classification carries a
written reason in `corpus/ledger.json` so a second reader can disagree with a specific one
rather than with the total, and a second reader disagreeing once is a better outcome for
this document than a second reader agreeing throughout.

**Twenty-four is above the lower bound the procedure names and is not a large sample.** The
rate has a denominator of fifty-five findings, and one contested classification would move
it by 1.8 points. Nine of the twenty-four applications were written to be broken, which is
a much higher proportion than a real population would have, and that inflates the true
positive count without saying anything about precision.

**Twenty of the twenty-four are still a small `node:http` server.** No framework, no ORM,
no database, so the observation is a black box crawl and every entity is inferred. The
source path is measured across the four Express applications and the schema path across the
two with Prisma beside them, which is enough for those paths to have run at all and is not
enough to call either one measured.

**Half the findings are the same finding.** The route index at `/` and `/health` accounts
for twenty-eight of the fifty-five, all correctly rated `info`. Removing them leaves
twenty-seven findings, still no false positives, and a rate over a denominator half the
size.

**Six earlier findings are held aside and the rate does not see them.** They are marked
`absent` in the ledger because the tool no longer produces them, and five of the six were
false positives that were repaired rather than suppressed. The honest reading of 0.0% is
therefore not that the tool has never been wrong. It is that nothing it currently produces
is known to be wrong, which is a different and smaller claim.

---

## Re-run on 2026-08-22, after the recall fixes

Everything below this section is the S8 run and is left as the record of it. This section
is a second run of the same twenty applications against a tool that had changed, and the
reason for re-running is that the changes were made to recall and to a verdict rule.
**A rate measured against the old behaviour says nothing about the new behaviour**, and
invariant I2 puts the burden on the change rather than on the reader.

What changed between the two runs: a denied delete is settled by reading the record rather
than by the response alone; a non-mutating deny rule is tried against every instance it
denies rather than the first; a reset now actually runs, where no caller had ever supplied
one; and a behavioral finding on a requirement tagged `access-control` or `data-exposure`
is `high` rather than `medium`.

|             | False positive rate | Judged | Unclear |
| ----------- | ------------------- | ------ | ------- |
| access      | 0.0%                | 9      | 1       |
| behavioral  | 0.0%                | 12     | 0       |
| structural  | 0.0%                | 22     | 0       |
| **overall** | **0.0%**            | **43** | **1**   |

**Six findings are new, five are true positives, and one could not be settled.** The rate
holds at 0.0% and the access family more than doubled what it judges, from four findings
to nine.

**The application the S8 run missed entirely is caught.** `p3-notes-delete-open` lets
anybody signed in delete anybody's note, and S8 reported nothing about it. It now fails:

```
DELETE /api/notes/N-1 as actor stranger returned 200 with no Note fields, and Note N-1
was readable before the request and is absent after it. Request: DELETE /api/notes/N-1.
Evidence: EV-00000b.
```

That is the verdict rule change doing exactly what it was decided for. The response was a
200 carrying nothing, which is undecidable on its own; the record is what settled it.

**The aggregate moved, and this is the headline.** S8 reported that five of twenty
applications failed to enforce an access rule they specified, and that the access family
found two of them, a behavioral criterion found two more while every access check passed,
and one was missed. **All five now produce a failed access check**, and nothing is found
only by a behavioral criterion.

|                                                      | S8  | Re-run |
| ---------------------------------------------------- | --- | ------ |
| Applications failing to enforce a stated access rule | 5   | 5      |
| Reported by a failed access check                    | 2   | **5**  |
| Reported only by a behavioral criterion              | 2   | 0      |
| Missed entirely                                      | 1   | **0**  |

**Two of the new findings come from the instance sweep, and both were invisible before for
the same reason.** `p3-notes-shared-flag` refuses `NOTE-1` correctly and hands `NOTE-2` to
an anonymous caller, and `p6-messages-dm-leak` refuses `MSG-1` correctly and hands `MSG-3`,
a direct message, to any signed in caller. In both cases the first configured instance is
the one the application gets right, which is precisely the shape S8 described and could not
catch.

**One finding was `unclear`, and the spec owner has since settled it.** On
`p3-notes-shared-flag`, actor `other` read `NOTE-2`, which belongs to somebody else and is
marked shared. REQ-004 says a shared note is readable by anyone signed in, so the
application was doing what its spec intends. AR-001-01 denied that actor reading any note
whose owner is not them, with no exception for shared, so the rule as written was violated
and the report was accurate about it. The disagreement was between two requirements of one
spec rather than between the spec and the application, which is why neither classification
was honest.

**Resolved 2026-08-23: REQ-004 is correct and AR-001-01 was under-specified.** The rule now
reads `Note.owner_id != actor.user_id and Note.shared == 'false'`, and the instances carry
the `shared` attribute it needs, since a condition can only read what an instance declares.
`NOTE-2` is no longer a record the rule denies, so it is no longer a candidate, and the
finding is gone. It stays in the ledger marked `absent`.

**This is a spec fix and not a check being disabled, and the difference is checkable
rather than a matter of trust.** The application's own `NOTES.md` says what a run should
find, "the anonymous read of NOTE-2", and adds that the owner checks coming back clean is
what says the tool is not simply flagging everything. Both are now true:

|                                           | Before       | After                                                      |
| ----------------------------------------- | ------------ | ---------------------------------------------------------- |
| REQ-001, the owner rule, on a shared note | failed       | **passes**, tested against `NOTE-1` and refused with 403   |
| REQ-004, the anonymous read of `NOTE-2`   | failed       | **still fails**, on both the access rule and the criterion |
| Overall false positive rate               | 0.0% over 43 | 0.0% over 43                                               |

The real defect is still caught, at high on both sides. What went away is a report about a
rule that did not say what its author meant.

**The condition grammar refused to guess on the way through, which is worth recording.**
The corrected rule was first written `Note.shared == false` and the parser rejected it:
`bare identifier "false", expected actor.<field> or <Entity>.<field>`. That is D20 working
as decided, since `Invoice.org_id == admin` is far more likely a mistyped reference than a
literal. The quoted form parses, and it matches the attribute type, because configuration
can only hold strings.

**`unclear` is now printed in the rate table rather than only excluded from it.** It was
being left out of the fraction, correctly, and out of the output as well, which is the same
defect S8.6 recorded about reviews the latest run no longer produces: a rate that quietly
narrows its own denominator is the most flattering thing this file could do.

**One expectation in a corpus application's notes no longer holds, and it is worth
recording rather than adjusting.** `p6-messages-dm-leak/NOTES.md` predicts REQ-001 passing
while REQ-002 fails, "because it says the team rule works and the direct message rule was
never written". Both fail now. The two requirements carry the identical rule condition,
because an access rule has nowhere to name which channel, and the predicted shape depended
on only one instance being tried. The note is left as written; the prediction was about a
tool that stopped at the first instance.

---

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

## The aggregate as it stood at the S8 run

Superseded by the section of the same name above the rule. Left unaltered as the record of
that run, and it is worth reading for the three ways the tool reached the number rather
than for the number.

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

## The limits as they stood at the S8 run

Superseded by the section of the same name above the rule, and left here unaltered because
everything below the re-run line is the record of that run. The counts in it are the S8
counts: twenty applications, thirty-eight findings, and no application on a framework. Read
the current one instead.

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
