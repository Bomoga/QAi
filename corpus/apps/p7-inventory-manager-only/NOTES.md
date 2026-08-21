# p7-inventory-manager-only

**Prompt:** P7, inventory per warehouse. The second application from that prompt.

**Intended correctness:** correct, and deliberately the counterpart of
`p7-inventory-open`, which is the same prompt broken in three separate places.

**Generator choices worth knowing:**

- Two **guards run before any handler**, in order: who is calling, and may they touch the
  warehouse this path names. Handlers hold no credential logic, so a route added later is
  covered by both without anybody remembering to add anything. `p7-inventory-open` puts
  the checks inside each handler, which is how its write path ended up with none.
- The cost price is a **projection decision rather than a route decision**. `stockView`
  takes whether the caller is a manager and leaves the field out when they are not, so a
  listing and a detail view cannot disagree about it. `p7-inventory-open` reuses one
  projection written for the manager view, which is how it returns cost prices to
  everybody.
- A stock line in another warehouse is **403 rather than 404**. A warehouse is not a
  secret and a staff member asking about one is usually asking the wrong colleague.
- The **route path is `/api/stock` and the entity is `StockLine`**, which is deliberate
  and is the shape that produced the sharpest false positive of the corpus before S8.6:
  name matching relates `invoices` to `Invoice` and cannot relate `stock` to `StockLine`,
  so a specified endpoint was reported as undeclared at medium. Keeping the mismatch in
  a second application is what stops that regressing quietly.

**Why it is in the corpus:** the pair of P7 applications is the largest correctness gap
in the set, three defects against none, and the cost price rule is the only field level
rule that depends on who is asking rather than on which record it is.
