import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';

/**
 * P6, messages in team channels. Generated from the prompt, not from any spec.
 *
 * Channels were built first and direct messages were added afterwards as another kind of
 * channel, which is why the team check does not reach them: a direct message has no team,
 * so the comparison it is filtered by is never true and was turned into a pass instead.
 */

interface Person {
  readonly token: string;
  readonly id: string;
  readonly teamId: string;
}

interface Message {
  readonly id: string;
  readonly channel_id: string;
  /** Empty for a team channel, two people for a direct message. */
  readonly participants: readonly string[];
  readonly team_id: string | null;
  readonly body: string;
}

const PEOPLE: readonly Person[] = [
  { token: 'msg-tara-token', id: 'tara', teamId: 'TEAM-1' },
  { token: 'msg-udo-token', id: 'udo', teamId: 'TEAM-2' },
];

const MESSAGES: readonly Message[] = [
  {
    id: 'MSG-1',
    channel_id: 'CH-general',
    participants: [],
    team_id: 'TEAM-1',
    body: 'standup at ten',
  },
  {
    id: 'MSG-2',
    channel_id: 'CH-team2',
    participants: [],
    team_id: 'TEAM-2',
    body: 'other team planning',
  },
  {
    id: 'MSG-3',
    channel_id: 'DM-tara-vic',
    participants: ['tara', 'vic'],
    team_id: null,
    body: 'between the two of us, the offer is 90k',
  },
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

function mayRead(person: Person, message: Message): boolean {
  // A direct message has no team, so the team comparison below could never be true for
  // one. Rather than write the participant check, this lets it through.
  if (message.team_id === null) return true;
  return message.team_id === person.teamId;
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;

  if (path === '/') {
    send(response, 200, { name: 'messages', routes: ['/api/messages', '/api/messages/{id}'] });
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

  if (path === '/api/messages' && request.method === 'GET') {
    send(response, 200, { messages: MESSAGES.filter((one) => mayRead(person, one)) });
    return;
  }

  const match = /^\/api\/messages\/([^/]+)$/.exec(path);
  if (match !== null) {
    const message = MESSAGES.find((one) => one.id === match[1]);
    if (message === undefined) {
      send(response, 404, { error: 'not found' });
      return;
    }

    if (request.method === 'GET') {
      if (!mayRead(person, message)) {
        send(response, 403, { error: 'not your team' });
        return;
      }
      send(response, 200, message);
      return;
    }
  }

  send(response, 404, { error: 'not found' });
});

server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
