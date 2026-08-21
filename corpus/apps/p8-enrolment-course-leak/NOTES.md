# p8-enrolment-course-leak

**Prompt:** P8, course enrolment. The second application from that prompt.

**Intended correctness:** subtly wrong, in one place, and correct everywhere else.

**The defect:** the course detail view embeds the enrolments behind the course, so a
course page can render a roster in one request, and the embedded records are whole
enrolment rows with grades on them. Any signed in student can read any course and comes
away with everybody's grade.

**Why that shape:** every rule the prompt states about enrolments is enforced correctly
on the routes that serve enrolments. A student reads their own and nobody else's, the
listing is scoped, an unsigned caller gets 401. The grades leave through a different
route entirely, which is the shape of leak that survives a review of the access rules,
because the access rules are right.

**What that asks of the tool:** the enrolment access rules all pass, and the requirement
that catches this has to be a field level claim about a route that serves a different
entity. `body omits field Enrolment.grade` against a read of `Course` is the only form in
the spec vocabulary that can state it.

**Generator choices worth knowing:**

- Bearer tokens, resolved once at the top, with the decisions inside the handlers.
- 403 for another student's enrolment, since the enrolment exists and the caller is known.
- The course list carries no enrolments at all. Only the detail view embeds them, so the
  defect is on one route rather than on the entity.
