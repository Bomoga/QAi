# p2-tickets-query-filter

**Prompt:** P2, support tickets.

**Intended correctness:** correct.

**Generator choices worth knowing, none of them named in the prompt:**

- A session cookie identifies the caller, not a bearer token.
- Scoping is a filter applied where rows are selected, the way it would be written against
  a database, rather than a check inside each handler. An agent's filter is wider rather
  than absent, so there is exactly one place visibility is decided.
- A ticket the caller may not see answers **404**, because it is selected out before the
  handler ever knows it exists.
- Closing is refused with 403, since the caller is known and simply not permitted.

**Why it is in the corpus:** a correct application whose enforcement is invisible to a
black box probe, with a legitimately broad reader in the agent. A tool that treats a wide
role as a leak would fire here, and a finding against this application is a false positive.
