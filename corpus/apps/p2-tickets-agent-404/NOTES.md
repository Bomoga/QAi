# p2-tickets-agent-404

**Prompt:** P2, support tickets. The second application from that prompt.

**Intended correctness:** correct.

**Generator choices worth knowing:**

- Every decision is made **in the handler**, one condition at a time, which is how this
  gets written before anybody has settled on a pattern. `p2-tickets-query-filter` is the
  same prompt done as a query filter, and the pair is the comparison worth having.
- A ticket somebody else opened answers **404 rather than 403**, and so does a ticket
  that does not exist. Ticket numbers are sequential, and a requester who can tell the
  two apart can count their way through the queue.
- Closing answers **403 to a requester who owns the ticket**, since being refused an
  action on your own record is a different fact from the record not being yours, and the
  application is in a position to say so.

**Why it is in the corpus:** the agent is the first actor in the set who is legitimately
allowed to read everything. A spec has to be able to say that without the tool reading it
as the scoping rule failing, and this is what asks the question.
