# p5-files-membership

**Prompt:** P5, files attached to projects.

**Intended correctness:** correct.

**Generator choices worth knowing, none of them named in the prompt:**

- Membership is a separate list on the caller rather than a field on the file, so every
  decision is a lookup through it rather than a comparison of two attributes.
- A signed in caller who is simply not a member gets **403**, not 404. The project is not
  a secret and hiding the file would not tell them anything useful. That is the opposite
  choice to the invoicing and tickets applications, on purpose.
- The directory projection omits contents; the detail route adds it.
- Editing is 405, because files are replaced rather than edited.

**Why it is in the corpus:** correct, and the refusal shape differs from the other correct
applications. A tool that only recognises one shape of refusal would fire on one of them.
