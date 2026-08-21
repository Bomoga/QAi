import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';

/**
 * P3, private notes. Generated from the prompt, not from any spec.
 *
 * Reading, listing, and editing all resolve the note through `mine`, which scopes to the
 * caller. The delete route does not. It resolves by id from the whole table, because it
 * was written at a different time from the rest and the author was thinking about the
 * note rather than about who was asking.
 *
 * Everything else is correct, including the part that is easy to get wrong: a caller
 * with no credential reaches nothing at all.
 */

interface Person {
  readonly token: string;
  readonly id: string;
}

interface Note {
  readonly id: string;
  readonly owner_id: string;
  text: string;
  readonly shared: boolean;
}

const PEOPLE: readonly Person[] = [
  { token: 'keep-nora-token', id: 'nora' },
  { token: 'keep-sam-token', id: 'sam' },
];

const NOTES: Note[] = [
  { id: 'N-1', owner_id: 'nora', text: 'the combination is on the fridge', shared: false },
  { id: 'N-2', owner_id: 'nora', text: 'call the dentist', shared: false },
  { id: 'N-9', owner_id: 'sam', text: 'nothing interesting', shared: false },
];

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function personOf(request: IncomingMessage): Person | undefined {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) return undefined;
  return PEOPLE.find((one) => one.token === header.slice('Bearer '.length));
}

/** Scoped to the caller. Read, list, and edit all go through it. Delete does not. */
function mine(person: Person): Note[] {
  return NOTES.filter((note) => note.owner_id === person.id || note.shared);
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const method = request.method ?? 'GET';

  if (path === '/') {
    send(response, 200, { name: 'notes', routes: ['/api/notes', '/api/notes/{id}'] });
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

  const person = personOf(request);
  if (person === undefined) {
    send(response, 401, { error: 'sign in first' });
    return;
  }

  if (path === '/api/notes' && method === 'GET') {
    send(response, 200, { notes: mine(person) });
    return;
  }

  const match = /^\/api\/notes\/([^/]+)$/.exec(path);
  if (match !== null) {
    if (method === 'DELETE') {
      // Resolved from the whole table rather than from `mine`.
      const index = NOTES.findIndex((one) => one.id === match[1]);
      if (index === -1) {
        send(response, 404, { error: 'not found' });
        return;
      }
      NOTES.splice(index, 1);
      send(response, 200, { deleted: match[1] });
      return;
    }

    const note = mine(person).find((one) => one.id === match[1]);
    if (note === undefined) {
      send(response, 404, { error: 'not found' });
      return;
    }

    if (method === 'GET' || method === 'PATCH') {
      send(response, 200, note);
      return;
    }
  }

  send(response, 404, { error: 'not found' });
});

server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
