# p6-messages-dm-leak

**Prompt:** P6, messages in team channels.

**Intended correctness:** obviously wrong, in the way features get added.

**The defect:** channels were built first and direct messages were added afterwards as
another kind of channel. A direct message has no team, so the team comparison the whole
check is built on could never be true for one, and rather than write the participant check
the author let it through. **Any signed in person can read anyone's direct message.**

**Generator choices worth knowing:**

- Bearer tokens, one visibility function used by both the listing and the detail route,
  which is why the same defect appears twice.
- A message from another team answers 403, which is correct and is what makes the direct
  message case stand out: the tool has a working refusal to compare against.

**What a run should find:** the outsider reading MSG-3. REQ-001 passing while REQ-002 fails
is the interesting shape, because it says the team rule works and the direct message rule
was never written.
