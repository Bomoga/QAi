import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';

/**
 * P6, messages in team channels. Generated from the prompt, not from any spec.
 *
 * The rule that matters here is that a direct message is a channel with exactly two
 * members, so reaching one is the same question as reaching any other channel and there
 * is no second code path to get wrong. `p6-messages-dm-leak` is the same prompt with a
 * separate direct message branch, and that separate branch is where its leak lives.
 *
 * Membership is a set on the channel. A caller who is not in it gets 403, because the
 * channel names in a workspace are not a secret and pretending a channel does not exist
 * would leave somebody arguing with their own team about a typo.
 */

interface Person {
  readonly token: string;
  readonly id: string;
  readonly team_id: string;
}

interface Channel {
  readonly id: string;
  readonly name: string;
  readonly team_id: string;
  readonly members: readonly string[];
  readonly direct: boolean;
}

interface Message {
  readonly id: string;
  readonly channel_id: string;
  readonly author_id: string;
  readonly body: string;
}

const PEOPLE: readonly Person[] = [
  { token: 'msg-mo-token', id: 'mo', team_id: 'TEAM-1' },
  { token: 'msg-tia-token', id: 'tia', team_id: 'TEAM-1' },
  { token: 'msg-ora-token', id: 'ora', team_id: 'TEAM-2' },
];

const CHANNELS: readonly Channel[] = [
  { id: 'CH-1', name: 'planning', team_id: 'TEAM-1', members: ['mo', 'tia'], direct: false },
  { id: 'CH-2', name: 'suppliers', team_id: 'TEAM-2', members: ['ora'], direct: false },
  { id: 'DM-1', name: 'mo and pia', team_id: 'TEAM-1', members: ['mo', 'pia'], direct: true },
];

const MESSAGES: Message[] = [
  { id: 'MSG-1', channel_id: 'CH-1', author_id: 'mo', body: 'standup moved to ten' },
  { id: 'MSG-2', channel_id: 'CH-2', author_id: 'ora', body: 'the pallets arrive friday' },
  { id: 'MSG-9', channel_id: 'DM-1', author_id: 'mo', body: 'between the two of us only' },
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

/**
 * One question, asked in one place. A direct message is a channel with two members, so
 * a participant of a direct message and a member of a team channel reach their messages
 * through the same answer.
 */
function canReach(person: Person, channel: Channel): boolean {
  return channel.members.includes(person.id);
}

function channelOf(id: string): Channel | undefined {
  return CHANNELS.find((one) => one.id === id);
}

function channelView(channel: Channel): Record<string, unknown> {
  return { id: channel.id, name: channel.name, team_id: channel.team_id };
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const method = request.method ?? 'GET';

  if (path === '/') {
    send(response, 200, {
      name: 'messages',
      routes: ['/api/channels', '/api/channels/{id}', '/api/messages', '/api/messages/{id}'],
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

  const person = personOf(request);
  if (person === undefined) {
    send(response, 401, { error: 'sign in first' });
    return;
  }

  if (path === '/api/channels' && method === 'GET') {
    const reachable = CHANNELS.filter((channel) => canReach(person, channel));
    send(response, 200, { channels: reachable.map(channelView) });
    return;
  }

  const channel = /^\/api\/channels\/([^/]+)$/.exec(path);
  if (channel !== null && method === 'GET') {
    const found = channelOf(channel[1] ?? '');
    if (found === undefined) {
      send(response, 404, { error: 'not found' });
      return;
    }
    if (!canReach(person, found)) {
      send(response, 403, { error: 'not a member of that channel' });
      return;
    }
    send(response, 200, channelView(found));
    return;
  }

  if (path === '/api/messages') {
    if (method === 'GET') {
      const reachable = MESSAGES.filter((message) => {
        const owner = channelOf(message.channel_id);
        return owner !== undefined && canReach(person, owner);
      });
      send(response, 200, { messages: reachable });
      return;
    }

    if (method === 'POST') {
      // Sending needs membership of the channel being sent to. With no body naming one
      // there is nothing to check membership against, so there is nothing to send.
      send(response, 400, { error: 'name a channel to send to' });
      return;
    }
  }

  const message = /^\/api\/messages\/([^/]+)$/.exec(path);
  if (message !== null && method === 'GET') {
    const found = MESSAGES.find((one) => one.id === message[1]);
    if (found === undefined) {
      send(response, 404, { error: 'not found' });
      return;
    }

    const owner = channelOf(found.channel_id);
    if (owner === undefined || !canReach(person, owner)) {
      send(response, 403, { error: 'not a member of that channel' });
      return;
    }

    send(response, 200, found);
    return;
  }

  send(response, 404, { error: 'not found' });
});

server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
