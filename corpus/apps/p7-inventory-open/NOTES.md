# p7-inventory-open

**Prompt:** P7, inventory per warehouse.

**Intended correctness:** obviously wrong, in three separate ways.

**The defects:**

1. The write path has no credential check at all, so anyone can adjust a stock level.
2. The listing returns every warehouse rather than the caller's.
3. The cost price is returned to everyone, because one projection was written for the
   manager view and reused everywhere.

**Generator choices worth knowing:**

- Bearer tokens, checked inside each handler rather than in a middleware, which is why
  the write path could be added without one.
- A stock line in another warehouse is readable, so the cross warehouse read is a leak
  rather than a refusal.

**Why it is in the corpus:** an application this broken is what says the tool still finds
things. A corpus of well behaved applications measures the false positive rate and nothing
else, and a rate is only meaningful next to a tool that fires when it should.
