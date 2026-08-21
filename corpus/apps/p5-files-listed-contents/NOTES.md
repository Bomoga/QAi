# p5-files-listed-contents

**Prompt:** P5, file storage per project. The second application from that prompt.

**Intended correctness:** subtly wrong, in one place, and correct everywhere else.

**The defect:** the prompt says a file's contents are never listed in a directory
response, only its name and size. There is one `documentView`, it was written for the
download route where the contents are the point, and the directory route calls it too.
Every file in a project is therefore handed over in full to anyone who lists the
directory.

**Why that shape:** it is the defect that arrives by reuse rather than by carelessness.
Nothing about the access rules is wrong, the membership check is in one place and is
correct, and only members ever see the response. A reviewer scanning for a missing
authorization check finds nothing, because there is nothing missing. That is what makes
it worth having: the finding has to come from the field level rather than from the
access level.

**Generator choices worth knowing:**

- Membership is a **field on the account** rather than a table, so a person belongs to
  one project and the check is an equality. `p5-files-membership` uses a membership list,
  which is the same prompt with a different data model and no defect.
- The entity is called `Document` rather than `File`, which is worth noting on its own:
  the spec and the routes agree with each other and neither agrees with the prompt's
  word. Nothing in the tool should mind, and the corpus should contain a case where the
  domain word and the model name differ.
