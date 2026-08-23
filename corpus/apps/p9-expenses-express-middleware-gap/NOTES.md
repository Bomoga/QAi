# p9-expenses-express-middleware-gap

**Prompt:** P9, expense reports. The second application from that prompt.

**Intended correctness:** subtly wrong.

**The defect:** access is enforced in a middleware, and the middleware answers the wrong
question. `requireSignIn` establishes who the caller is and stops there; nothing asks
whether this expense is theirs. The list route filters correctly on top of it, which is
what makes the pair look consistent, and the detail route hands any signed in person
anybody's memo.

**Why that shape:** it is the ordinary way a middleware gap happens. Authentication and
authorization get written as one step because the first one is the one you notice missing,
and the route that reads a single record is the one that ends up trusting it.

**Generator choices worth knowing, none of them named in the prompt:**

- The middleware is attached per route rather than mounted on the path with
  `app.use('/api/expenses', ...)`, so adding a route means remembering to attach it. The
  approve route remembers; the detail route does not.
- The refusal for an expense that does not exist is a 404, and there is no 403 anywhere on
  the read path, because the check that would produce one is missing.

**What a run should find:** the colleague reading EXP-1. REQ-003, the list, should pass
while REQ-001 fails, which is the interesting shape: it says the scoping works where it
was written and was never written on the other route. The source adapter should let the
finding name the line the detail route is declared on.
