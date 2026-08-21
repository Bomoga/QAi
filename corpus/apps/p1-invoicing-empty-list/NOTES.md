# p1-invoicing-empty-list

**Prompt:** P1, invoicing per organization. The third application from that prompt.

**Intended correctness:** correct.

**Generator choices worth knowing:**

- The refusal shape is an **empty list**, which is the one value in the
  `corpus/prompts.md` table nothing else in the corpus produces. The seeded data belongs
  to one organization, so a caller from anywhere else gets a 200 with nothing in it: not
  an error, not a filtered subset, an empty result that is indistinguishable from an
  organization that simply has no bills.
- A session cookie named `billing`, and the scope resolved once **in a middleware** that
  hands the handlers a list already narrowed to the caller's organization. Neither
  handler looks at a credential.
- A single bill belonging to another organization answers **404**, matching what the
  listing already implied. Two routes disagreeing about whether a record exists is how
  somebody enumerates.

**What this is here to ask.** A deny list rule against an empty list is the case
`03-CONTRACTS.md` and M3.6 argue about: rows have to be present and identifiable before
correct scoping can be claimed, so an empty list is `inconclusive` rather than a pass.
This application should produce that, and an inconclusive is the right answer rather than
a gap in the tool. It is worth having a corpus application that lands there on purpose,
because otherwise the only way anybody meets that verdict is by accident.
