import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';

/**
 * P3, personal notes. Generated from the prompt, not from any spec.
 *
 * The caller is identified by a header rather than a bearer token, and a note carries a
 * shared flag. The shared branch is checked before the caller is resolved, which is the
 * kind of ordering mistake that reads fine until somebody asks who "anyone" is.
 */

interface Note {
  readonly id: string;
  readonly owner_id: string;
  readonly shared: boolean;
  body: string;
}

const KNOWN_USERS = new Set(['dana', 'erin']);

const NOTES: Note[] = [
  { id: 'NOTE-1', owner_id: 'dana', shared: false, body: 'passport number is in the drawer' },
  { id: 'NOTE-2', owner_id: 'dana', shared: true, body: 'team offsite agenda' },
  { id: 'NOTE-3', owner_id: 'erin', shared: false, body: 'salary review notes' },
];

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function callerOf(request: IncomingMessage): string | undefined {
  const header = request.headers['x-user-id'];
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || !KNOWN_USERS.has(value)) return undefined;
  return value;
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;

  if (path === '/') {
    send(response, 200, { name: 'notes', routes: ['/api/notes', '/api/notes/{id}'] });
    return;
  }

  if (path === '/health') {
    send(response, 200, { status: 'ok' });
    return;
  }

  const caller = callerOf(request);

  if (path === '/api/notes' && request.method === 'GET') {
    if (caller === undefined) {
      send(response, 401, { error: 'sign in first' });
      return;
    }
    const mine = NOTES.filter((note) => note.owner_id === caller);
    send(response, 200, { notes: mine.map((note) => ({ id: note.id, shared: note.shared })) });
    return;
  }

  const match = /^\/api\/notes\/([^/]+)$/.exec(path);
  if (match !== null) {
    const note = NOTES.find((one) => one.id === match[1]);
    if (note === undefined) {
      send(response, 404, { error: 'not found' });
      return;
    }

    if (request.method === 'GET') {
      // A shared note is readable by anyone. The caller is never resolved on this
      // branch, so "anyone" turns out to include callers who are not signed in.
      if (note.shared) {
        send(response, 200, note);
        return;
      }
      if (caller === note.owner_id) {
        send(response, 200, note);
        return;
      }
      send(response, 403, { error: 'not yours' });
      return;
    }

    if (request.method === 'PATCH') {
      if (caller !== note.owner_id) {
        send(response, 403, { error: 'not yours' });
        return;
      }
      note.body = `${note.body}.`;
      send(response, 200, note);
      return;
    }

    if (request.method === 'DELETE') {
      if (caller !== note.owner_id) {
        send(response, 403, { error: 'not yours' });
        return;
      }
      send(response, 200, { deleted: note.id });
      return;
    }
  }

  send(response, 404, { error: 'not found' });
});

server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
