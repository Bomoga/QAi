import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';

/**
 * P5, files attached to projects. Generated from the prompt, not from any spec.
 *
 * Membership is a field on the account rather than a table, so a person belongs to one
 * project and the check is an equality. The access rules are enforced correctly and in
 * one place.
 *
 * The defect is elsewhere and is the kind that arrives by reuse rather than by
 * carelessness: there is one `documentView`, it was written for the download route where
 * the contents are the point, and the directory route calls it too. So a directory
 * response carries every file's contents, to members only, which is why nothing about
 * the access rules looks wrong.
 */

interface Account {
  readonly token: string;
  readonly id: string;
  readonly project_id: string;
}

interface Document {
  readonly id: string;
  readonly project_id: string;
  readonly name: string;
  readonly size_bytes: number;
  readonly contents: string;
}

const ACCOUNTS: readonly Account[] = [
  { token: 'docs-mel-token', id: 'mel', project_id: 'PROJ-X' },
  { token: 'docs-nils-token', id: 'nils', project_id: 'PROJ-Y' },
];

const DOCUMENTS: readonly Document[] = [
  {
    id: 'DOC-1',
    project_id: 'PROJ-X',
    name: 'contract.md',
    size_bytes: 4120,
    contents: 'the renewal terms nobody outside the project should read',
  },
  {
    id: 'DOC-2',
    project_id: 'PROJ-X',
    name: 'plan.md',
    size_bytes: 980,
    contents: 'six weeks, two people',
  },
  {
    id: 'DOC-7',
    project_id: 'PROJ-Y',
    name: 'handover.md',
    size_bytes: 210,
    contents: 'other project entirely',
  },
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

function isMember(account: Account, document: Document): boolean {
  return account.project_id === document.project_id;
}

/** One view, written for the download route, and used by both. */
function documentView(document: Document): Record<string, unknown> {
  return {
    id: document.id,
    project_id: document.project_id,
    name: document.name,
    size_bytes: document.size_bytes,
    contents: document.contents,
  };
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;

  if (path === '/') {
    send(response, 200, { name: 'documents', routes: ['/api/documents', '/api/documents/{id}'] });
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

  if (path === '/api/documents' && request.method === 'GET') {
    const mine = DOCUMENTS.filter((document) => isMember(account, document));
    send(response, 200, { documents: mine.map(documentView) });
    return;
  }

  const match = /^\/api\/documents\/([^/]+)$/.exec(path);
  if (match !== null && request.method === 'GET') {
    const document = DOCUMENTS.find((one) => one.id === match[1]);
    if (document === undefined) {
      send(response, 404, { error: 'not found' });
      return;
    }

    if (!isMember(account, document)) {
      send(response, 403, { error: 'not a member of that project' });
      return;
    }

    send(response, 200, documentView(document));
    return;
  }

  send(response, 404, { error: 'not found' });
});

server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
