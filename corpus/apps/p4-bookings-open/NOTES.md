# p4-bookings-open

**Prompt:** P4, room bookings. The second application from that prompt.

**Intended correctness:** obviously wrong. There is no authentication at all.

**The defects:** everything the prompt restricts is open. Anyone can list the bookings,
book a room, and cancel anybody's booking, because nothing in the application can tell
one caller from another.

**Why that shape:** it was written as an internal tool for one office, where everybody on
the network is a colleague and the sign in was going to be added later. That is the most
common way a generated application ends up with no authorization: not a check written
wrongly, but a decision deferred and then shipped.

**Generator choices worth knowing:**

- No credential, and nowhere for a rule to live. Those are the two axis values in
  `corpus/prompts.md` that nothing else in the corpus covers, which is the reason this
  application exists.
- The config still declares two signed in actors, presenting a header the application
  never reads. A spec can only ask about identities the target is configured to present,
  and here the target presents the same face to all of them.

**Why it is in the corpus:** a rate measured only against applications that authenticate
would say nothing about the case a reviewer most wants caught. This one should produce a
failed access check for every deny rule in its spec, and if it does not, the tool has a
much larger problem than a false positive.
