# p3-notes-delete-open

**Prompt:** P3, personal notes. The third application from that prompt.

**Intended correctness:** subtly wrong, on exactly one verb.

**The defect:** reading, listing, and editing all resolve the note through `mine`, which
scopes to the caller. The delete route resolves it by id from the whole table, so anybody
signed in can delete anybody else's note.

**Why that shape:** it is the hardest defect in this class to see by reading. There is no
missing authentication, no unscoped listing, and no leaked field. Four routes are right
and one is wrong, and the wrong one is the destructive one. The delete handler was
written at a different time from the rest and the author was thinking about the note
rather than about who was asking.

**What that asks of the tool:** the read, list, and update deny rules all pass. Only the
delete rule fails, and the finding has to name the verb rather than the resource, or a
reader goes looking for a scoping bug that is not there.

**Why it is in the corpus:** a defect on one verb of four is the case where a per rule
result matters more than a per requirement one, and no other application in the set is
wrong in one place with three neighbours that are right.

**A corpus limit this application makes visible.** Exercising a delete rule against an
application that permits the delete removes the record, and the corpus reset command is a
no-op because the state is in memory and the runner cannot restart a server mid run. So
every check after that one sees a different application. Nothing here is wrong with the
tool: the disposability gate did its job and the target declared itself disposable. It
does mean a spec for a destructive defect should state its remaining requirements over
something the earlier check did not consume, which is why REQ-006 is about the listing
rather than about a record.
