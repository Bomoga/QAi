# p6-messages-strict

**Prompt:** P6, team messages. The second application from that prompt.

**Intended correctness:** correct, and deliberately the counterpart of
`p6-messages-dm-leak`, which is the same prompt with the direct message rule broken.

**Generator choices worth knowing:**

- A direct message is **a channel with two members**, not a separate kind of thing. One
  question, `canReach`, answers both "may this person read this channel" and "may this
  person read this direct message". `p6-messages-dm-leak` has a separate branch for
  direct messages and that separate branch is exactly where its leak lives, which is
  worth having both applications to show.
- A caller who is not a member gets **403 rather than 404**. Channel names in a workspace
  are not a secret, and pretending a channel does not exist leaves somebody arguing with
  their own team about a typo.

**A spec limit found while writing this, not a defect in the application:** the prompt
says sending needs membership _of that channel_, and an access rule names an actor, an
action, and a resource with nowhere to name which channel. The channel scoped half of
that sentence cannot be written as a rule. REQ-005 states the part that holds for every
channel, that an unsigned caller sends nothing, and REQ-006 states the rest and carries
no check, so it is reported as a coverage gap rather than narrowed into a claim the
prompt did not make. That gap is the honest reading and it is what invariant I4 is for.

**Why it is in the corpus:** two applications from one prompt where one is right and one
is wrong in a single named place is the clearest evidence available that the tool is
reacting to the application rather than to the prompt.
