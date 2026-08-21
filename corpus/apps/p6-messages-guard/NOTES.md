# p6-messages-guard

**Prompt:** P6, team messages. The third application from that prompt.

**Intended correctness:** correct.

**Generator choices worth knowing:**

- Team ownership is resolved once into a **set of room ids the caller may reach**, and
  every query starts from that set. A post is reachable when its room is, so the post
  routes inherit the rule rather than restating it. `p6-messages-dm-leak` restates it for
  direct messages and gets it wrong in the restatement, which is the argument for
  resolving once.
- Everything unreachable answers **404**, on rooms and on posts alike. A room belonging
  to another team is not something this caller is entitled to learn the existence of.
  `p6-messages-strict` answers 403 to the same question, on the grounds that channel
  names in a workspace are not a secret. Both are defensible and the corpus should
  contain both, because a check that assumed either would be wrong half the time.
- Two entities where the rule lives on the first and is inherited by the second, which is
  the join the spec has to describe without a join. `Post.room_id == "RM-A"` is a
  condition on a literal rather than on an actor attribute, and it is the only rule of
  that shape in the corpus besides `Note.shared`.

**Why it is in the corpus:** three applications from P6 now, one wrong and two right in
different ways, with the two right ones disagreeing about the refusal status. If the tool
is quiet on both, that says something a single application cannot.
