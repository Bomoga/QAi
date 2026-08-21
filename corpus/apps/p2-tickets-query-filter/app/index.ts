import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';

/**
 * P2, support tickets. Generated from the prompt, not from any spec.
 *
 * The caller is identified by a session cookie. Scoping is expressed as a filter applied
 * where the rows are selected rather than as a check in the handler, which is how it
 * would be written against a database, and an agent's filter is simply wider. A ticket a
 * requester may not see is not there as far as they are concerned, so it answers 404.
 */

interface Session {
  readonly sid: string;
  readonly userId: string;
  readonly role: 'requester' | 'agent';
}

interface Ticket {
  readonly id: string;
  readonly requester_id: string;
  readonly subject: string;
  status: 'open' | 'closed';
}

const SESSIONS: readonly Session[] = [
  { sid: 'sess-rita', userId: 'rita', role: 'requester' },
  { sid: 'sess-raj', userId: 'raj', role: 'requester' },
  { sid: 'sess-agnes', userId: 'agnes', role: 'agent' },
];

const TICKETS: Ticket[] = [
  { id: 'TCK-1', requester_id: 'rita', subject: 'cannot sign in', status: 'open' },
  { id: 'TCK-2', requester_id: 'rita', subject: 'billing question', status: 'open' },
  { id: 'TCK-3', requester_id: 'raj', subject: 'export is slow', status: 'open' },
];

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function sessionOf(request: IncomingMessage): Session | undefined {
  const cookie = request.headers.cookie;
  if (cookie === undefined) return undefined;

  const pair = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('sid='));
  if (pair === undefined) return undefined;

  return SESSIONS.find((one) => one.sid === pair.slice('sid='.length));
}

/**
 * The rows this session may see. An agent's filter is wider rather than absent, so there
 * is one place where visibility is decided.
 */
function selectTickets(session: Session): Ticket[] {
  if (session.role === 'agent') return TICKETS;
  return TICKETS.filter((ticket) => ticket.requester_id === session.userId);
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;

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

  const session = sessionOf(request);
  if (session === undefined) {
    send(response, 401, { error: 'sign in first' });
    return;
  }

  if (path === '/api/tickets' && request.method === 'GET') {
    send(response, 200, { tickets: selectTickets(session) });
    return;
  }

  const match = /^\/api\/tickets\/([^/]+)$/.exec(path);
  if (match !== null) {
    // Selected from what this session may see, so somebody else's ticket is not found
    // rather than forbidden.
    const ticket = selectTickets(session).find((one) => one.id === match[1]);
    if (ticket === undefined) {
      send(response, 404, { error: 'not found' });
      return;
    }

    if (request.method === 'GET') {
      send(response, 200, ticket);
      return;
    }

    if (request.method === 'PATCH') {
      // Closing is for agents only. Everything else about a ticket a requester owns is
      // theirs to change.
      if (session.role !== 'agent') {
        send(response, 403, { error: 'only an agent closes a ticket' });
        return;
      }
      ticket.status = 'closed';
      send(response, 200, ticket);
      return;
    }
  }

  send(response, 404, { error: 'not found' });
});

server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
