# p10-catalog-prisma-draft-leak

**Prompt:** P10, a product catalog with drafts. The second application from that prompt.

**Intended correctness:** subtly wrong.

**The defect:** the listing returns the whole catalog. `visibleTo` exists and the route
that reads one product calls it, so the draft rule is written and is applied in one of the
two places it belongs. Anybody, including a caller with no credential, can list another
team's unreleased products.

**Why that shape:** the listing was written when everything in the catalog was published,
and the draft flag arrived later with the route that reads a single product. The check
lands wherever attention was at the time.

**Generator choices worth knowing, none of them named in the prompt:**

- Same session cookie and same schema as its correct sibling. The only difference is the
  missing filter on the listing, which is what makes the pair worth comparing.
- The detail route still answers 404 for a draft belonging to another team, so the two
  routes disagree with each other about the same rule.

**A second, deliberate divergence, and it is not a defect in the application.** The spec
declares `Product.discontinued_at` and `prisma/schema.prisma` has no such column. The
prompt asks for a product to be retired without deleting it and the model has no way to
say so. That is a specified field the data model does not have, and it is here because it
is the one structural path the corpus has never exercised: a declared field is only
reported missing when the observed field list came from a schema, which is the rule S8.6
added and which no corpus application could reach until this one had a schema.

**What a run should find:** the anonymous listing of PRD-2, and `Product.discontinued_at`
as specified and not observed. The detail route coming back clean is what says the tool is
reading the two routes separately rather than tarring the resource with one brush.
