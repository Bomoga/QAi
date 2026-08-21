# p3-notes-strict

**Prompt:** P3, personal notes. The second application from that prompt.

**Intended correctness:** correct, and deliberately the counterpart of
`p3-notes-shared-flag`, which is the same prompt with the shared branch broken.

**Generator choices worth knowing:**

- The shared flag is handled by **two queries rather than one branch**. `ownedBy` answers
  what is mine and `readableBy` answers what I may open, and the caller is resolved
  before either runs. `p3-notes-shared-flag` returns a shared note before resolving the
  caller at all, which is exactly where its leak lives.
- Changing and deleting go through `ownedBy`, never `readableBy`. Being able to read a
  shared note is not being able to edit it, and the two queries are what keep that from
  being one forgotten condition.
- A **session cookie named `session`**, a second cookie shape after `sid`, so the
  redaction and the credential handling are exercised on more than one name.
- A note that is not yours and is not shared answers **404**. A private note is not
  something a stranger is entitled to learn the existence of.

**Why it is in the corpus:** a conditional visibility rule is the hardest thing in the
prompt set to state in a spec, since the condition is on the record rather than on the
caller. `Note.shared == "true"` is the only rule in the corpus of that shape.
