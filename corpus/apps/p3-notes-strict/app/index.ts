import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';

/**
 * P3, private notes. Generated from the prompt, not from any spec.
 *
 * The shared flag is the whole difficulty of this prompt, and it is handled by having
 * two queries rather than one branch. `ownedBy` answers what is mine, `readableBy`
 * answers what I may open, and the caller is resolved before either of them runs.
 * `p3-notes-shared-flag` is the same prompt with one branch that returns a shared note
 * before the caller has been resolved at all, which is where its leak lives.
 *
 * A note that is not yours and is not shared answers 404. A private note is not
 * something a stranger is entitled to learn the existence of.
 */

interface Person {
  readonly session: string;
  readonly id: string;
}

interface Note {
  readonly id: string;
  readonly owner_id: string;
  readonly title: string;
  body: string;
  readonly shared: boolean;
}

const PEOPLE: readonly Person[] = [
  { session: 'notes-dara-session', id: 'dara' },
  { session: 'notes-remy-session', id: 'remy' },
];

const NOTES: Note[] = [
  {
    id: 'NOTE-A',
    owner_id: 'dara',
    title: 'moving house',
    body: 'the landlord has not returned the deposit',
    shared: false,
  },
  {
    id: 'NOTE-S',
    owner_id: 'dara',
    title: 'reading list',
    body: 'three books worth passing on',
    shared: true,
  },
  {
    id: 'NOTE-R',
    owner_id: 'remy',
    title: 'invoices to send',
    body: 'two outstanding',
    shared: false,
  },
];

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

/** A session cookie named `session`, and nothing else identifies a caller. */
function personOf(request: IncomingMessage): Person | undefined {
  const header = request.headers.cookie;
  if (header === undefined) return undefined;

  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'session') return PEOPLE.find((one) => one.session === rest.join('='));
  }

  return undefined;
}

/** What is mine. A listing is about ownership, not about what I happen to be able to open. */
function ownedBy(person: Person): Note[] {
  return NOTES.filter((note) => note.owner_id === person.id);
}

/** What I may open. Mine, plus anything its owner marked shared. */
function readableBy(person: Person): Note[] {
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

  // Resolved first, always. A shared note is shared with people who are signed in, and
  // that is a fact about the caller, so there is nothing to answer until there is one.
  const person = personOf(request);
  if (person === undefined) {
    send(response, 401, { error: 'sign in first' });
    return;
  }

  if (path === '/api/notes' && method === 'GET') {
    send(response, 200, { notes: ownedBy(person) });
    return;
  }

  const match = /^\/api\/notes\/([^/]+)$/.exec(path);
  if (match !== null) {
    if (method === 'GET') {
      const note = readableBy(person).find((one) => one.id === match[1]);
      if (note === undefined) {
        send(response, 404, { error: 'not found' });
        return;
      }
      send(response, 200, note);
      return;
    }

    if (method === 'PATCH' || method === 'DELETE') {
      // Changing and deleting are about ownership, and being able to read a shared note
      // is not being able to edit it.
      const note = ownedBy(person).find((one) => one.id === match[1]);
      if (note === undefined) {
        send(response, 404, { error: 'not found' });
        return;
      }

      if (method === 'DELETE') {
        NOTES.splice(NOTES.indexOf(note), 1);
        response.writeHead(204);
        response.end();
        return;
      }

      send(response, 200, note);
      return;
    }
  }

  send(response, 404, { error: 'not found' });
});

server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
