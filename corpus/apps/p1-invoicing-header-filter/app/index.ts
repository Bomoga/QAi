import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';

/**
 * P1, invoices per organization. Generated from the prompt, not from any spec.
 *
 * The caller is an `x-account` header, which a gateway would normally set. Scoping is
 * done by the query: `visibleTo` is the only function that reads the invoice table, and
 * it takes the account, so there is no unscoped set for a handler to leak.
 *
 * An invoice belonging to another organization is therefore not refused, it is simply
 * not there. The read answers 404 and the listing answers with the rows that survived
 * the filter, which for a caller with none is an empty list rather than an error.
 *
 * The private note is on the record and is left out of the listing projection. The
 * detail view carries it, which is what makes it a private note rather than a secret.
 */

interface Account {
  readonly id: string;
  readonly org: string;
}

interface Invoice {
  readonly id: string;
  readonly org: string;
  readonly customer: string;
  amount_cents: number;
  readonly private_note: string;
}

const ACCOUNTS: readonly Account[] = [
  { id: 'acct-mira', org: 'ACME' },
  { id: 'acct-rex', org: 'BYTE' },
];

const INVOICES: Invoice[] = [
  {
    id: 'INV-A1',
    org: 'ACME',
    customer: 'Northwind',
    amount_cents: 412000,
    private_note: 'chase the purchase order before invoicing again',
  },
  {
    id: 'INV-A2',
    org: 'ACME',
    customer: 'Initech',
    amount_cents: 98000,
    private_note: 'pays late, every time',
  },
  {
    id: 'INV-B7',
    org: 'BYTE',
    customer: 'Umbrella',
    amount_cents: 250000,
    private_note: 'do not discuss the discount',
  },
];

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function accountOf(request: IncomingMessage): Account | undefined {
  const header = request.headers['x-account'];
  const id = Array.isArray(header) ? header[0] : header;
  return id === undefined ? undefined : ACCOUNTS.find((one) => one.id === id);
}

/**
 * The query. Every read of the invoice table goes through it, so the scoping rule is
 * written once and a handler cannot hold a row it was not entitled to.
 */
function visibleTo(account: Account): Invoice[] {
  return INVOICES.filter((invoice) => invoice.org === account.org);
}

/** A row in a listing: everything except the note the prompt says a listing must not show. */
function listingRow(invoice: Invoice): Record<string, unknown> {
  return {
    id: invoice.id,
    org: invoice.org,
    customer: invoice.customer,
    amount_cents: invoice.amount_cents,
  };
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const method = request.method ?? 'GET';

  if (path === '/') {
    send(response, 200, { name: 'invoicing', routes: ['/api/invoices', '/api/invoices/{id}'] });
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

  const account = accountOf(request);
  if (account === undefined) {
    // Nobody is asking, which is a different fact from asking for something that is not
    // yours, and the two get different answers on purpose.
    send(response, 401, { error: 'no account header' });
    return;
  }

  if (path === '/api/invoices' && method === 'GET') {
    send(response, 200, { invoices: visibleTo(account).map(listingRow) });
    return;
  }

  const match = /^\/api\/invoices\/([^/]+)$/.exec(path);
  if (match !== null) {
    const invoice = visibleTo(account).find((one) => one.id === match[1]);
    if (invoice === undefined) {
      send(response, 404, { error: 'not found' });
      return;
    }

    if (method === 'GET') {
      send(response, 200, invoice);
      return;
    }

    if (method === 'PATCH') {
      // An empty patch changes nothing and says so by returning the record as it stands.
      // A body would name the fields to change; none of them is the organization.
      send(response, 200, invoice);
      return;
    }
  }

  send(response, 404, { error: 'not found' });
});

server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
