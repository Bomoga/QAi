# p10-catalog-prisma-strict

**Prompt:** P10, a product catalog with drafts. The first application from that prompt.

**Intended correctness:** correct.

**Why it exists:** it is the only application in the corpus with a `schema.prisma`, so it
is the only one whose entities are read from a model rather than inferred from a response.
Until it existed, every observation in the corpus had `origin: inferred` on every entity,
which meant the structural diff's schema path never ran: the rule added at S8.6, that a
declared field is only reported missing when the observed field list came from a schema,
was untested by the corpus that motivated it.

**The rows are in memory and the schema is not connected to a database.** The schema is
the data model as the generator wrote it and the handlers serve fixture rows, which is an
ordinary state for a generated application part way through. What it exercises is the
adapter reading a model, not Prisma at runtime, and pretending otherwise would be worse
than saying so here.

**Generator choices worth knowing, none of them named in the prompt:**

- A session cookie rather than a bearer token or a header, which is the credential style
  least represented in the corpus.
- A draft belonging to another team answers 404 rather than 403, so a refusal does not
  confirm the draft exists.
- Published products are readable by anybody including a caller with no credential, which
  is what the prompt asks for and is why `anonymous` has an allow rule as well as a deny.
- `Team` is in the schema and no route serves it, so it should appear as specified and not
  observed at low severity. That is correct: the spec declares it and the application has
  no endpoint for it.

**What a run should find:** the `Team` entity, and the two noise routes. No failed check.
This is the half of the pair that carries the weight.
