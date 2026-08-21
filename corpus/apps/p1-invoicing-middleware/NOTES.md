# p1-invoicing-middleware

**Prompt:** P1, invoicing per organization.

**Intended correctness:** correct. Everything the prompt asks for is implemented as asked.

**Generator choices worth knowing, none of them named in the prompt:**

- Access is enforced in a middleware in front of every `/api` route, not in each handler.
- Scoping happens once, in `visibleTo`, and every handler reads through it.
- A record outside the caller's organization answers **404, not 403**, so a refusal does
  not confirm that the record exists.
- The private note is dropped in a projection used by every response, not just by the
  listing.

**Why it is in the corpus:** a finding against this application is a false positive. The
rate this stage produces is mostly decided by how the tool behaves on code that is right,
and enforcement in a middleware is exactly the shape a source-blind probe cannot see.
