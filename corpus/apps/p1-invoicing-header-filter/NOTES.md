# p1-invoicing-header-filter

**Prompt:** P1, invoicing per organization. The second application from that prompt.

**Intended correctness:** correct.

**Generator choices worth knowing:**

- An **identity header** rather than a token, the shape a gateway that has already
  authenticated the caller would use. Nothing in the application verifies a credential,
  because by the time a request arrives the header is the credential.
- Scoping is done **inside the query**. `visibleTo` is the only function that reads the
  invoice table and it takes the account, so there is no unscoped set for a handler to
  leak. `p1-invoicing-middleware` enforces the same rule in a middleware, which is the
  point of having both: one prompt, two enforcement styles, and the tool should be
  equally quiet about each.
- An invoice belonging to another organization is **not found rather than refused**, and
  a listing that filters everything out is an empty list rather than an error. A caller
  with no header at all gets 401, so not signed in and not entitled are distinguishable.
- The private note is on the record and is left out of the listing projection. The detail
  view carries it, which is what makes it a private note rather than a secret. That is
  also the shape that produced a false positive before S8.6: a probe reaching only the
  listing used to report the note as a field the application never provided.

**Why it is in the corpus:** one prompt built twice, differing on credential, enforcement
site, and refusal shape, is the cleanest way to ask whether the tool is reacting to the
application or to the way it was written.
