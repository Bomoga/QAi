import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';

/**
 * P2, support tickets, called issues here. Generated from the prompt, not from any spec.
 *
 * The caller arrives as an `x-user` identity header that a gateway would set, and the
 * role is looked up here rather than trusted from the request. A header naming its own
 * privileges is a header anybody can write, and the gateway knows who somebody is while
 * this application knows what they are allowed to do.
 *
 * `reachable` is the one place the visibility rule lives, and closing checks the role
 * separately, because they are different questions: an agent may close an issue they did
 * not open, and a requester may read an issue they may not close.
 */

interface Caller {
  readonly id: string;
  readonly agent: boolean;
}

interface Issue {
  readonly id: string;
  readonly reporter_id: string;
  readonly summary: string;
  closed: boolean;
}

const KNOWN = new Set(['fern', 'gus', 'hana']);

/** Roles live here, never in a header. */
const AGENTS = new Set(['hana']);

const ISSUES: Issue[] = [
  {
    id: 'ISS-1',
    reporter_id: 'fern',
    summary: 'badge reader rejects me on tuesdays',
    closed: false,
  },
  { id: 'ISS-2', reporter_id: 'fern', summary: 'monitor flickers', closed: false },
  { id: 'ISS-3', reporter_id: 'gus', summary: 'no keyboard at the new desk', closed: false },
];

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function callerOf(request: IncomingMessage): Caller | undefined {
  const id = header(request, 'x-user');
  if (id === undefined || !KNOWN.has(id)) return undefined;
  return { id, agent: AGENTS.has(id) };
}

/** The visibility rule, in one place. An agent reaches everything, a reporter reaches theirs. */
function reachable(caller: Caller): Issue[] {
  return caller.agent ? ISSUES : ISSUES.filter((issue) => issue.reporter_id === caller.id);
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const method = request.method ?? 'GET';

  if (path === '/') {
    send(response, 200, { name: 'issues', routes: ['/api/issues', '/api/issues/{id}'] });
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

  const caller = callerOf(request);
  if (caller === undefined) {
    send(response, 401, { error: 'no caller header' });
    return;
  }

  if (path === '/api/issues' && method === 'GET') {
    send(response, 200, { issues: reachable(caller) });
    return;
  }

  const match = /^\/api\/issues\/([^/]+)$/.exec(path);
  if (match !== null) {
    const issue = reachable(caller).find((one) => one.id === match[1]);
    if (issue === undefined) {
      send(response, 404, { error: 'not found' });
      return;
    }

    if (method === 'GET') {
      send(response, 200, issue);
      return;
    }

    if (method === 'PATCH') {
      // Reaching an issue and being allowed to close it are different questions.
      if (!caller.agent) {
        send(response, 403, { error: 'closing an issue is for agents' });
        return;
      }
      issue.closed = true;
      send(response, 200, issue);
      return;
    }
  }

  send(response, 404, { error: 'not found' });
});

server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
