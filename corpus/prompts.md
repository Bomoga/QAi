# The prompt set

Every application in `corpus/apps/` was generated from one of these. The set is fixed
before the corpus is built, so an application cannot be quietly shaped around a check
after seeing what that check reports. That is the whole reason to write the prompts down.

## How an application is generated

A prompt names a domain, the resources, and who may see what. It never names an HTTP
status code, a header, a route shape, or a place to enforce anything. Those are the
generator's choices, and they are where the interesting disagreements come from: an
application that enforces access in a middleware, or answers 404 where the reviewer
expected 403, or filters in a database query rather than in a handler, is the case that
produces a false positive, and a corpus with none of those measures nothing.

The spec is written from the **prompt**, not from the code. Writing it from the code would
produce a spec that agrees with whatever was built, and every run would come back clean.

## The variation the set is built to produce

A corpus of twenty applications that differ only in their nouns is one application
measured twenty times. The set varies four things on purpose:

| Axis                     | Values                                                          |
| ------------------------ | --------------------------------------------------------------- |
| Credential               | bearer token, an identity header, a session cookie, none at all |
| Where access is enforced | in the handler, in a middleware, inside the data query, nowhere |
| Refusal shape            | 403, 404, 401, an empty list, a filtered list                   |
| Correctness              | correct, subtly wrong, obviously wrong                          |

**The correct applications carry the most weight.** A finding against an application that
does what its spec says is a false positive, and the rate this stage produces is mostly
decided by how the tool behaves on code that is right.

## The bias this cannot escape

These applications and the checker were written by the same model, so they share its
habits. A pattern the checker is blind to is a pattern the generator is unlikely to
produce, and the rate will read better than one measured against applications written by
strangers. The prompts push against it by naming enforcement styles the checker has never
been pointed at, and the limit is reported as part of the result rather than as a footnote
under it.

## The prompts

### P1. Invoicing, per organization

An API for invoices belonging to organizations. A user belongs to one organization and can
read and list only that organization's invoices. Editing an invoice requires being signed
in. Invoices carry a private note that no listing should reveal.

### P2. Support tickets, per requester

An API for support tickets. A requester sees only the tickets they opened. An agent sees
every ticket. Anyone signed in can add a comment to a ticket they can see. Closing a ticket
is for agents only.

### P3. Personal notes

An API for private notes. A note belongs to one person and nobody else can read, change, or
delete it. Notes can be marked shared, and a shared note is readable by anyone signed in.

### P4. Room bookings

An API for booking meeting rooms. Anyone signed in can see which rooms are free and can
book one. A booking can be cancelled only by the person who made it. The list of who booked
what is visible to everyone in the same office.

### P5. File storage, per project

An API for files attached to projects. A person is a member of some projects and can
download files only from those. Uploading needs membership. A file's contents are never
listed in a directory response, only its name and size.

### P6. Team messages

An API for messages in team channels. A person reads only channels their team owns. Sending
a message needs membership of that channel. A direct message is readable by its two
participants and nobody else.

### P7. Inventory, per warehouse

An API for stock levels across warehouses. A staff member sees the stock of their own
warehouse. Adjusting a stock level needs a signed in staff member of that warehouse. Cost
prices are internal and are never returned to a caller who is not a manager.

### P8. Course enrolment

An API for courses and enrolments. A student sees their own enrolments and the public
course list. Enrolling is for the signed in student themselves. Grades are visible to the
student they belong to and to the teacher of that course.
