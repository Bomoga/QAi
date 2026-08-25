/**
 * The mutation table: an edit to a corpus application, and what it must do to the findings.
 *
 * ## Why this exists
 *
 * `corpus/ledger.json` says a finding is a true positive because the author read it and
 * agreed with it. `corpus/RESULTS.md` says plainly that the author is the same agent that
 * wrote the tool, the application, and the spec, and calls that the largest single limit
 * on the number. Reading the ledger again cannot lift that limit, because the second
 * reading comes from the place the first one did.
 *
 * A mutation can. **Repair the defect a finding claims to be about, and the finding must
 * stop being produced.** That is not an opinion about whether the finding is correct, it
 * is a fact about whether the finding tracks the defect. A finding that survives the
 * repair of the thing it names was never about that thing, whatever its ledger note says,
 * and no amount of confidence in the note changes the result.
 *
 * The `expect` list is therefore the interesting part of each entry: those exact finding
 * ids, keyed the way `findingsOf` keys them, must flip.
 *
 * ## What a failure here means
 *
 * - A finding that does not disappear on repair is either misattributed in the ledger or
 *   the repair is wrong. Both are worth knowing and neither is visible from a review.
 * - A finding that appears or disappears **without being listed** is collateral. The
 *   runner reports it separately, because a repair that silently moves an unrelated
 *   finding says the two were coupled in a way nobody wrote down.
 *
 * ## Rules for adding one
 *
 * The edit must be a repair or a break that a person would actually make, not a change
 * shaped to move a finding. Writing `return false` to make a check pass would prove
 * nothing except that the tool responds to the application changing, which is not in
 * doubt. Every entry below is the smallest honest version of the fix the application's
 * own `NOTES.md` says is missing.
 */

import type { Mutation } from './lib/mutation.ts';

export type { Mutation };

export const MUTATIONS: readonly Mutation[] = [
  {
    id: 'p6-dm-participant-check',
    app: 'p6-messages-dm-leak',
    description:
      'A direct message becomes readable only by its participants, which is the check NOTES.md says was never written.',
    intent: 'repair',
    file: 'app/index.ts',
    find: `  // A direct message has no team, so the team comparison below could never be true for
  // one. Rather than write the participant check, this lets it through.
  if (message.team_id === null) return true;`,
    replace: `  if (message.team_id === null) return message.participants.includes(person.id);`,
    // Three findings on one read of MSG-3. Two access, from AR-002-01 which is the defect
    // NOTES.md names and from AR-001-01, whose rule carries an identical condition because
    // an access rule has nowhere to say which channel it means. One behavioral, AC-002-01,
    // making the same claim about the body.
    //
    // The third was missing from this list on the first run and the runner reported it as
    // collateral, which is the whole reason collateral is reported rather than ignored.
    expect: ['CHK-33b07dd6da85', 'CHK-97537a59037c', 'CHK-deb64e1d07f5'],
  },
  {
    id: 'p9-detail-route-ownership',
    app: 'p9-expenses-express-middleware-gap',
    description:
      'The detail route asks whether the expense is the caller-s, which its own list route already does.',
    intent: 'repair',
    file: 'app/index.ts',
    find: `app.get('/api/expenses/:id', requireSignIn, (request: Request, response: Response) => {
  const expense = EXPENSES.find((candidate) => candidate.id === request.params.id);
  if (expense === undefined) {
    response.status(404).json({ error: 'no such expense' });
    return;
  }

  response.json(expense);
});`,
    replace: `app.get('/api/expenses/:id', requireSignIn, (request: Signed, response: Response) => {
  const person = request.person;
  const expense = EXPENSES.find((candidate) => candidate.id === request.params.id);
  if (expense === undefined) {
    response.status(404).json({ error: 'no such expense' });
    return;
  }

  // A 404 rather than a 403, so a refusal does not confirm that the record exists.
  if (person?.approver !== true && expense.submitted_by !== person?.id) {
    response.status(404).json({ error: 'no such expense' });
    return;
  }

  response.json(expense);
});`,
    // The access finding and the behavioral criterion are both about this one read, so a
    // repair that clears one and not the other means they were never the same claim.
    expect: ['CHK-1c057d817d25', 'CHK-4f10ca8e34b3'],
  },
  {
    id: 'p10-listing-draft-filter',
    app: 'p10-catalog-prisma-draft-leak',
    description:
      'The listing filters through visibleTo, which the detail route beside it already calls.',
    intent: 'repair',
    file: 'app/index.ts',
    find: `app.get('/api/products', (_request: Request, response: Response) => {
  response.json({ products: PRODUCTS });
});`,
    replace: `app.get('/api/products', (request: Request, response: Response) => {
  const team = teamOf(request);
  response.json({ products: PRODUCTS.filter((product) => visibleTo(product, team)) });
});`,
    // The structural field mismatch on Product.discontinued_at is deliberate and is not
    // about the listing, so it must survive this repair untouched. If it moves, the
    // structural diff is reading something it should not be.
    expect: ['CHK-90059f8d3ab8'],
  },
];
