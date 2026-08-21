# p3-notes-shared-flag

**Prompt:** P3, personal notes.

**Intended correctness:** subtly wrong.

**The defect:** a note marked shared is returned before the caller is resolved, so a
caller presenting no credential can read it. The prompt says a shared note is readable by
anyone signed in; the application read that as anyone. Everything else, including the
owner checks on update and delete, is correct.

**Generator choices worth knowing, none of them named in the prompt:**

- The caller is identified by an `x-user-id` header rather than a bearer token.
- A note that is not shared and not yours answers 403, which does confirm the note exists.
- The listing returns only ids and the shared flag, never the body.

**What a run should find:** the anonymous read of NOTE-2. Anything else is worth a close
look, and the owner checks coming back clean is what says the tool is not simply flagging
everything.
