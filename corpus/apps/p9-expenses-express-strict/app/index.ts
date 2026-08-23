import express, { type Request, type Response } from 'express';
import process from 'node:process';

/**
 * P9, expense reports. Generated from the prompt, not from any spec.
 *
 * Written on Express, which is the first thing in this corpus a source adapter can read.
 * Every other application here is a hand-written `node:http` server, so nothing in the
 * corpus ever exercised the source half of the probe.
 *
 * Bearer tokens, and every rule is enforced inside the route handler where a reader can
 * see it. This is the correct one of the pair.
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

function callerOf(request: Request): Person | undefined {
  const header = request.headers.authorization;
  if (header === undefined) return undefined;

  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || token === undefined) return undefined;

  return PEOPLE.find((person) => person.token === token);
}

function expenseOf(id: string): Expense | undefined {
  return EXPENSES.find((expense) => expense.id === id);
}

/** A single route parameter always arrives as a string; the array arm is for wildcards. */
function idOf(request: Request): string {
  const id = request.params['id'];
  return typeof id === 'string' ? id : '';
}

const app = express();

app.get('/', (_request: Request, response: Response) => {
  response.json({ name: 'expenses', routes: ['/api/expenses', '/api/expenses/{id}'] });
});

app.get('/health', (_request: Request, response: Response) => {
  response.json({ status: 'ok' });
});

app.get('/api/expenses', (request: Request, response: Response) => {
  const caller = callerOf(request);
  if (caller === undefined) {
    response.status(401).json({ error: 'sign in first' });
    return;
  }

  // An approver sees everything. Everybody else sees their own, filtered here rather
  // than after the fact, so nothing leaves the handler that should not.
  const visible = caller.approver
    ? EXPENSES
    : EXPENSES.filter((expense) => expense.submitted_by === caller.id);

  response.json({ expenses: visible });
});

app.get('/api/expenses/:id', (request: Request, response: Response) => {
  const caller = callerOf(request);
  if (caller === undefined) {
    response.status(401).json({ error: 'sign in first' });
    return;
  }

  const expense = expenseOf(idOf(request));
  if (expense === undefined) {
    response.status(404).json({ error: 'no such expense' });
    return;
  }

  // A 404 rather than a 403, so a refusal does not confirm that the record exists.
  if (!caller.approver && expense.submitted_by !== caller.id) {
    response.status(404).json({ error: 'no such expense' });
    return;
  }

  response.json(expense);
});

app.post('/api/expenses/:id/approve', (request: Request, response: Response) => {
  const caller = callerOf(request);
  if (caller === undefined) {
    response.status(401).json({ error: 'sign in first' });
    return;
  }

  if (!caller.approver) {
    response.status(403).json({ error: 'approvers only' });
    return;
  }

  const expense = expenseOf(idOf(request));
  if (expense === undefined) {
    response.status(404).json({ error: 'no such expense' });
    return;
  }

  expense.approved = true;
  response.json(expense);
});

app.use((_request: Request, response: Response) => {
  response.status(404).json({ error: 'no such route' });
});

const port = Number(process.env['PORT'] ?? 47810);
app.listen(port, () => {
  console.log(`expenses listening on ${port}`);
});
