import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';

/**
 * P2, support tickets. Generated from the prompt, not from any spec.
 *
 * Every decision is made in the handler, one `if` at a time, which is the way most of
 * this gets written when nobody has decided on a pattern yet. `p2-tickets-query-filter`
 * is the same prompt done as a query filter, which is the comparison worth having.
 *
 * A ticket somebody else opened answers 404 rather than 403. A support queue leaks a
 * surprising amount through the difference between "not yours" and "no such ticket",
 * because ticket numbers are sequential and a requester can count.
 *
 * Closing is an agent action. A requester patching their own ticket is refused, since
 * the prompt gives closing to agents and gives requesters nothing else to change.
 */

interface Account {
  readonly token: string;
  readonly id: string;
  readonly agent: boolean;
}

interface Ticket {
  readonly id: string;
  readonly opened_by: string;
  readonly subject: string;
  state: string;
}

const ACCOUNTS: readonly Account[] = [
  { token: 'tickets-rae-token', id: 'rae', agent: false },
  { token: 'tickets-ravi-token', id: 'ravi', agent: false },
  { token: 'tickets-ada-token', id: 'ada', agent: true },
];

const TICKETS: Ticket[] = [
  { id: 'T-100', opened_by: 'rae', subject: 'printer jams on duplex', state: 'open' },
  { id: 'T-200', opened_by: 'rae', subject: 'vpn drops at noon', state: 'open' },
  { id: 'T-300', opened_by: 'ravi', subject: 'laptop will not charge', state: 'open' },
];

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function accountOf(request: IncomingMessage): Account | undefined {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) return undefined;
  return ACCOUNTS.find((one) => one.token === header.slice('Bearer '.length));
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const method = request.method ?? 'GET';

  if (path === '/') {
    send(response, 200, { name: 'tickets', routes: ['/api/tickets', '/api/tickets/{id}'] });
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
    send(response, 401, { error: 'sign in first' });
    return;
  }

  if (path === '/api/tickets' && method === 'GET') {
    const mine = account.agent
      ? TICKETS
      : TICKETS.filter((ticket) => ticket.opened_by === account.id);
    send(response, 200, { tickets: mine });
    return;
  }

  const match = /^\/api\/tickets\/([^/]+)$/.exec(path);
  if (match !== null) {
    const ticket = TICKETS.find((one) => one.id === match[1]);

    // Not yours and not there give the same answer. Ticket numbers are sequential and a
    // requester who can tell the two apart can count their way through the queue.
    if (ticket === undefined || (!account.agent && ticket.opened_by !== account.id)) {
      send(response, 404, { error: 'not found' });
      return;
    }

    if (method === 'GET') {
      send(response, 200, ticket);
      return;
    }

    if (method === 'PATCH') {
      if (!account.agent) {
        send(response, 403, { error: 'closing a ticket is for agents' });
        return;
      }
      ticket.state = 'closed';
      send(response, 200, ticket);
      return;
    }
  }

  send(response, 404, { error: 'not found' });
});

server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
