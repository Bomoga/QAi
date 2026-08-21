# p8-enrolment-middleware

**Prompt:** P8, course enrolment.

**Intended correctness:** correct.

**Generator choices worth knowing:**

- Authorization is a **middleware chain**, not a check inside each handler. A request
  walks a list of rules, the first match decides whether it continues, and the handlers
  hold no credential logic at all. A route nothing in the chain matches is refused,
  which is the opposite default from the applications that decide inside the handler.
- Bearer tokens, with two roles rather than one. Every other application in the corpus
  has a single kind of signed in caller; here a teacher and a student reach the same
  record through different rules, and only one of them by owning it.
- Refusals are **403 where the caller is known and 401 where they are not**, so the two
  are distinguishable, which is not true of the applications answering 404 for both.
- The course list is public, because the prompt calls it the public course list. It is
  the only route in the corpus that answers without a credential on purpose.

**Why it is in the corpus:** the grade rule is the first in the set where two different
actors are legitimately allowed to read one record for two different reasons. A spec can
say that with two allow rules and the tool has never been pointed at one.
