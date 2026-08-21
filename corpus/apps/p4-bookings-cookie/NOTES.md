# p4-bookings-cookie

**Prompt:** P4, room bookings.

**Intended correctness:** correct. Everything the prompt asks for is enforced, and the
application is here to measure what the tool says about code that is right.

**Generator choices worth knowing:**

- A session cookie, which is the credential style with the least in common with a bearer
  token: it arrives in a header the tool has to redact for a different reason.
- Access is enforced **inside the query**. `roomsFor` and `bookingsFor` take the caller
  and return what that caller may see, so a handler cannot forget to filter because it
  never holds the unfiltered set.
- A booking in another office answers **404 rather than 403**, including on a cancel. The
  caller is not entitled to learn that the booking exists, and the same answer covers a
  booking that is genuinely absent.
- Cancelling marks the booking rather than removing it. A room calendar that forgets a
  cancelled booking loses the record of who held the room, and the record staying
  readable is what lets the office visibility requirement mean anything afterwards.

**Why it is in the corpus:** P4 was the last unused prompt with a mutating verb at its
centre, and cancellation is the only place in the set where the rule is about who created
a record rather than which organization it belongs to. The corpus had no `delete` rule
before this one.
