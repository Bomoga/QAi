import express, { type NextFunction, type Request, type Response } from 'express';
import process from 'node:process';

/**
 * P9, expense reports. The second application from that prompt.
 *
 * Written on Express, and access is enforced in a middleware rather than in the handlers,
 * which is one of the styles corpus/prompts.md varies on purpose. The middleware is
 * mounted per route rather than on the path, which is where this one goes wrong.
 */

interface Expense {
  readonly id: string;
  readonly submitted_by: string;
  readonly amount_cents: number;
  readonly memo: string;
  approved: boolean;
}

interface Person {
  readonly id: string;
  readonly token: string;
  readonly approver: boolean;
}

const PEOPLE: readonly Person[] = [
  { id: 'rosa', token: 'expenses-rosa-token', approver: false },
  { id: 'theo', token: 'expenses-theo-token', approver: false },
  { id: 'mira', token: 'expenses-mira-token', approver: true },
];

const EXPENSES: Expense[] = [
  {
    id: 'EXP-1',
    submitted_by: 'rosa',
    amount_cents: 12_400,
    memo: 'client dinner, receipt attached',
    approved: false,
  },
  {
    id: 'EXP-2',
    submitted_by: 'theo',
    amount_cents: 3_150,
    memo: 'taxi from the airport',
    approved: false,
  },
];

interface Signed extends Request {
  person?: Person;
}

function personOf(request: Request): Person | undefined {
  const header = request.headers.authorization;
  if (header === undefined) return undefined;

  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || token === undefined) return undefined;

  return PEOPLE.find((person) => person.token === token);
}

/** Signed in, or nothing further happens. */
function requireSignIn(request: Signed, response: Response, next: NextFunction): void {
  const person = personOf(request);
  if (person === undefined) {
    response.status(401).json({ error: 'sign in first' });
    return;
  }

  request.person = person;
  next();
}

const app = express();

app.get('/', (_request: Request, response: Response) => {
  response.json({ name: 'expenses', routes: ['/api/expenses', '/api/expenses/{id}'] });
});

app.get('/health', (_request: Request, response: Response) => {
  response.json({ status: 'ok' });
});

app.get('/api/expenses', requireSignIn, (request: Signed, response: Response) => {
  const person = request.person;
  const visible =
    person?.approver === true
      ? EXPENSES
      : EXPENSES.filter((expense) => expense.submitted_by === person?.id);

  response.json({ expenses: visible });
});

/**
 * The detail route takes `requireSignIn` and stops there.
 *
 * Signing in is not the same question as being allowed to see this one, and the second
 * question is asked nowhere: any signed in person reads any expense, including somebody
 * else's memo. The list above scopes correctly, which is what makes it look right.
 */
app.get('/api/expenses/:id', requireSignIn, (request: Request, response: Response) => {
  const expense = EXPENSES.find((candidate) => candidate.id === request.params.id);
  if (expense === undefined) {
    response.status(404).json({ error: 'no such expense' });
    return;
  }

  response.json(expense);
});

app.post(
  '/api/expenses/:id/approve',
  requireSignIn,
  (request: Signed, response: Response): void => {
    if (request.person?.approver !== true) {
      response.status(403).json({ error: 'approvers only' });
      return;
    }

    const expense = EXPENSES.find((candidate) => candidate.id === request.params.id);
    if (expense === undefined) {
      response.status(404).json({ error: 'no such expense' });
      return;
    }

    expense.approved = true;
    response.json(expense);
  },
);

app.use((_request: Request, response: Response) => {
  response.status(404).json({ error: 'no such route' });
});

const port = Number(process.env['PORT'] ?? 47810);
app.listen(port, () => {
  console.log(`expenses listening on ${port}`);
});
