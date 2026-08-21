# p2-tickets-header-agent

**Prompt:** P2, support tickets. The third application from that prompt.

**Intended correctness:** correct.

**Generator choices worth knowing:**

- An **identity header** a gateway would set, with the role looked up in the application
  rather than trusted from the request. A header naming its own privileges is a header
  anybody can write. The gateway knows who somebody is; the application knows what they
  are allowed to do.
- Reaching an issue and being allowed to close it are **two separate questions**, decided
  in two places on purpose. An agent may close an issue they did not open, and a reporter
  may read an issue they may not close, so a single permission would be wrong in one
  direction or the other.
- A reporter reading somebody else's issue gets **404**, and a reporter trying to close
  their own gets **403**. That pairing is deliberate: not being able to see it and not
  being allowed to act on it are different facts, and the application is in a position to
  say which.

**Why it is in the corpus:** the three P2 applications differ on all three of the axes
that matter here. `p2-tickets-query-filter` uses a session cookie and a query filter,
`p2-tickets-agent-404` uses a bearer token and per handler conditions, and this one uses
an identity header with the visibility rule in one function and the role check in
another. Same prompt, same rules, three shapes.
