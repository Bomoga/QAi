import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';

/**
 * P1, invoicing per organization. Generated from the prompt, not from any spec.
 *
 * Access is enforced in a middleware rather than in each handler, and a caller asking for
 * something outside their organization gets 404 rather than 403, so a refusal does not
 * confirm that the record exists. Both are ordinary choices and neither is named in the
 * prompt.
 */

interface User {
  readonly token: string;
  readonly id: string;
  readonly orgId: string;
}

interface Invoice {
  readonly id: string;
  readonly org_id: string;
  amount_cents: number;
  readonly private_note: string;
}

const USERS: readonly User[] = [
  { token: 'inv-alice-token', id: 'alice', orgId: 'org-1' },
  { token: 'inv-bob-token', id: 'bob', orgId: 'org-2' },
];

const INVOICES: Invoice[] = [
  { id: 'INV-100', org_id: 'org-1', amount_cents: 250_00, private_note: 'chase the PO number' },
  { id: 'INV-101', org_id: 'org-1', amount_cents: 480_00, private_note: 'net 30 agreed' },
  {
    id: 'INV-200',
    org_id: 'org-2',
    amount_cents: 990_00,
    private_note: 'renewal, do not discount',
  },
];

function send(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(text);
}

/** Resolves the caller. Anything it cannot resolve is refused before a handler runs. */
function authenticate(request: IncomingMessage): User | undefined {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) return undefined;
  return USERS.find((user) => user.token === header.slice('Bearer '.length));
}

/** The caller's invoices, and nothing else. Scoping happens here, once. */
function visibleTo(user: User): Invoice[] {
  return INVOICES.filter((invoice) => invoice.org_id === user.orgId);
}

function listing(invoice: Invoice): Record<string, unknown> {
  // The private note is never part of a listing.
  return { id: invoice.id, org_id: invoice.org_id, amount_cents: invoice.amount_cents };
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (path === '/') {
    send(response, 200, {
      name: 'invoicing',
      routes: ['/api/invoices', '/api/invoices/{id}'],
    });
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

  // Every /api route is behind the credential check, so no handler below has to
  // remember to do it.
  const user = authenticate(request);
  if (user === undefined) {
    send(response, 401, { error: 'authentication required' });
    return;
  }

  if (path === '/api/invoices' && request.method === 'GET') {
    send(response, 200, { invoices: visibleTo(user).map(listing) });
    return;
  }

  const match = /^\/api\/invoices\/([^/]+)$/.exec(path);
  if (match !== null) {
    const id = match[1];
    // Looked up within what the caller can see, so something in another organization is
    // indistinguishable from something that does not exist.
    const invoice = visibleTo(user).find((one) => one.id === id);

    if (invoice === undefined) {
      send(response, 404, { error: 'not found' });
      return;
    }

    if (request.method === 'GET') {
      send(response, 200, listing(invoice));
      return;
    }

    if (request.method === 'PATCH') {
      invoice.amount_cents += 1;
      send(response, 200, listing(invoice));
      return;
    }

    if (request.method === 'DELETE') {
      send(response, 405, { error: 'invoices are not deleted' });
      return;
    }
  }

  send(response, 404, { error: 'not found' });
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, '127.0.0.1');
