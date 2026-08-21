import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';

/**
 * P1, invoices per organization, called bills here. Generated from the prompt, not from
 * any spec.
 *
 * The organization has exactly one seeded set of bills, so a caller from anywhere else
 * gets an empty list rather than a refusal. That is the refusal shape `corpus/prompts.md`
 * lists and nothing else in the corpus produces: not an error, not a filtered subset, but
 * a 200 with nothing in it.
 *
 * A single bill belonging to another organization answers 404, because the listing has
 * already told that caller the bill does not exist as far as they are concerned, and two
 * routes disagreeing about that is how somebody enumerates.
 *
 * The memo is on the record and out of the listing projection.
 */

interface Account {
  readonly session: string;
  readonly id: string;
  readonly org: string;
}

interface Bill {
  readonly id: string;
  readonly org: string;
  readonly payer: string;
  total: number;
  readonly memo: string;
}

const ACCOUNTS: readonly Account[] = [
  { session: 'bills-ida-session', id: 'ida', org: 'ORG-7' },
  { session: 'bills-omar-session', id: 'omar', org: 'ORG-8' },
];

const BILLS: Bill[] = [
  { id: 'BL-70', org: 'ORG-7', payer: 'Trellis', total: 92000, memo: 'disputed line item' },
  { id: 'BL-71', org: 'ORG-7', payer: 'Halberd', total: 15500, memo: 'pays on the last day' },
];

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function accountOf(request: IncomingMessage): Account | undefined {
  const header = request.headers.cookie;
  if (header === undefined) return undefined;

  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'billing') return ACCOUNTS.find((one) => one.session === rest.join('='));
  }

  return undefined;
}

/** A row in a listing: no memo, because the prompt says a listing must not reveal it. */
function listingRow(bill: Bill): Record<string, unknown> {
  return { id: bill.id, org: bill.org, payer: bill.payer, total: bill.total };
}

/**
 * The middleware. It establishes the caller and the organization scope once, and the
 * handlers below never look at a credential again.
 */
function withScope(
  request: IncomingMessage,
  response: ServerResponse,
  handle: (account: Account, scoped: Bill[]) => void,
): void {
  const account = accountOf(request);
  if (account === undefined) {
    send(response, 401, { error: 'sign in first' });
    return;
  }

  handle(
    account,
    BILLS.filter((bill) => bill.org === account.org),
  );
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const method = request.method ?? 'GET';

  if (path === '/') {
    send(response, 200, { name: 'billing', routes: ['/api/bills', '/api/bills/{id}'] });
    return;
  }

  if (path === '/health') {
    send(response, 200, { status: 'ok' });
    return;
  }

  if (!path.startsWith('/api/')) {
    send(response, 404, { error: 'not found' });
    return;
  }

  if (path === '/api/bills' && method === 'GET') {
    withScope(request, response, (_account, scoped) => {
      send(response, 200, { bills: scoped.map(listingRow) });
    });
    return;
  }

  const match = /^\/api\/bills\/([^/]+)$/.exec(path);
  if (match !== null) {
    withScope(request, response, (_account, scoped) => {
      const bill = scoped.find((one) => one.id === match[1]);
      if (bill === undefined) {
        send(response, 404, { error: 'not found' });
        return;
      }

      if (method === 'GET' || method === 'PATCH') {
        // A patch with no body names nothing to change and returns the record as it is.
        send(response, 200, bill);
        return;
      }

      send(response, 405, { error: 'method not allowed' });
    });
    return;
  }

  send(response, 404, { error: 'not found' });
});

server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
