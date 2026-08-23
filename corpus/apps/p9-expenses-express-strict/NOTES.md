# p9-expenses-express-strict

**Prompt:** P9, expense reports. The first application from that prompt.

**Intended correctness:** correct.

**Why it exists:** it is the first corpus application a source adapter can read. Every
other one is a hand-written `node:http` server, chosen at S8 because they needed no
dependencies, so the whole corpus was probed black box and the source half of the tool was
measured by one fixture and nothing else. This one is Express, its config sets
`sourceRoot`, and the observation of it is hybrid rather than black box.

**Generator choices worth knowing, none of them named in the prompt:**

- Bearer tokens, and every rule enforced in the route handler rather than in a middleware
  or a query, so the source adapter sees the routes and the checks sit visibly beside them.
- A refusal on somebody else's expense is a 404 rather than a 403, so it does not confirm
  the expense exists.
- An approver is a person with a flag, not a separate route, which is why REQ-006 is an
  allow rule against the same route REQ-001 denies to a colleague.

**What a run should find:** nothing. Every requirement should come back verified. This is
the half of the pair that carries the weight: a rate measured only against broken
applications says nothing about precision, and this one is here to be got right.
