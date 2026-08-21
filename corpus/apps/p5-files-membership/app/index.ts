import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';

/**
 * P5, files attached to projects. Generated from the prompt, not from any spec.
 *
 * Membership is a separate table rather than a field on the file, so every decision is a
 * lookup through it. A caller who is signed in and simply not a member gets 403, since
 * hiding the file would not tell them anything useful and the project itself is not a
 * secret.
 */

interface Member {
  readonly token: string;
  readonly id: string;
  readonly projects: readonly string[];
}

interface StoredFile {
  readonly id: string;
  readonly project_id: string;
  readonly name: string;
  readonly size_bytes: number;
  readonly contents: string;
}

const MEMBERS: readonly Member[] = [
  { token: 'files-pat-token', id: 'pat', projects: ['PROJ-A'] },
  { token: 'files-quinn-token', id: 'quinn', projects: ['PROJ-B'] },
];

const FILES: readonly StoredFile[] = [
  {
    id: 'FILE-1',
    project_id: 'PROJ-A',
    name: 'roadmap.md',
    size_bytes: 812,
    contents: 'the roadmap nobody outside the project should read',
  },
  {
    id: 'FILE-2',
    project_id: 'PROJ-A',
    name: 'budget.csv',
    size_bytes: 240,
    contents: 'line,amount',
  },
  {
    id: 'FILE-3',
    project_id: 'PROJ-B',
    name: 'notes.txt',
    size_bytes: 96,
    contents: 'other project entirely',
  },
];

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function memberOf(request: IncomingMessage): Member | undefined {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) return undefined;
  return MEMBERS.find((one) => one.token === header.slice('Bearer '.length));
}

function canReach(member: Member, file: StoredFile): boolean {
  return member.projects.includes(file.project_id);
}

/** A directory entry: what a file is called and how big it is, and nothing else. */
function directoryEntry(file: StoredFile): Record<string, unknown> {
  return {
    id: file.id,
    project_id: file.project_id,
    name: file.name,
    size_bytes: file.size_bytes,
  };
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;

  if (path === '/') {
    send(response, 200, { name: 'files', routes: ['/api/files', '/api/files/{id}'] });
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

  const member = memberOf(request);
  if (member === undefined) {
    send(response, 401, { error: 'sign in first' });
    return;
  }

  if (path === '/api/files' && request.method === 'GET') {
    const reachable = FILES.filter((file) => canReach(member, file));
    send(response, 200, { files: reachable.map(directoryEntry) });
    return;
  }

  const match = /^\/api\/files\/([^/]+)$/.exec(path);
  if (match !== null) {
    const file = FILES.find((one) => one.id === match[1]);
    if (file === undefined) {
      send(response, 404, { error: 'not found' });
      return;
    }

    if (!canReach(member, file)) {
      send(response, 403, { error: 'not a member of that project' });
      return;
    }

    if (request.method === 'GET') {
      send(response, 200, { ...directoryEntry(file), contents: file.contents });
      return;
    }

    if (request.method === 'PATCH') {
      send(response, 405, { error: 'files are replaced, not edited' });
      return;
    }
  }

  send(response, 404, { error: 'not found' });
});

server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
