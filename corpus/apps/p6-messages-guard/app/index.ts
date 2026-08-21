import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';

/**
 * P6, messages in team rooms. Generated from the prompt, not from any spec.
 *
 * Team ownership is resolved once into a set of room ids the caller may reach, and every
 * query starts from that set. A post is reachable when its room is, so there is one rule
 * and the post routes inherit it rather than restating it. `p6-messages-dm-leak` restates
 * it for direct messages and gets it wrong there.
 *
 * Everything a caller may not reach answers 404. A room belonging to another team is not
 * something this caller is entitled to learn the existence of, and the post routes give
 * the same answer for the same reason.
 */

interface Person {
  readonly token: string;
  readonly id: string;
  readonly team_id: string;
}

interface Room {
  readonly id: string;
  readonly topic: string;
  readonly team_id: string;
}

interface Post {
  readonly id: string;
  readonly room_id: string;
  readonly author_id: string;
  readonly text: string;
}

const PEOPLE: readonly Person[] = [
  { token: 'rooms-ines-token', id: 'ines', team_id: 'TM-A' },
  { token: 'rooms-otto-token', id: 'otto', team_id: 'TM-B' },
];

const ROOMS: readonly Room[] = [
  { id: 'RM-A', topic: 'release planning', team_id: 'TM-A' },
  { id: 'RM-B', topic: 'supplier calls', team_id: 'TM-B' },
];

const POSTS: readonly Post[] = [
  { id: 'PO-1', room_id: 'RM-A', author_id: 'ines', text: 'cut the release on thursday' },
  { id: 'PO-2', room_id: 'RM-A', author_id: 'ines', text: 'two blockers left' },
  { id: 'PO-9', room_id: 'RM-B', author_id: 'otto', text: 'the pallets are late again' },
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
 * Resolved once. Every query below starts from it, so a post route cannot restate the
 * ownership rule differently from a room route.
 */
function reachableRooms(person: Person): Set<string> {
  return new Set(ROOMS.filter((room) => room.team_id === person.team_id).map((room) => room.id));
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;

  if (path === '/') {
    send(response, 200, {
      name: 'rooms',
      routes: ['/api/rooms', '/api/rooms/{id}', '/api/posts', '/api/posts/{id}'],
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

  const reachable = reachableRooms(person);

  if (path === '/api/rooms' && request.method === 'GET') {
    send(response, 200, { rooms: ROOMS.filter((room) => reachable.has(room.id)) });
    return;
  }

  const room = /^\/api\/rooms\/([^/]+)$/.exec(path);
  if (room !== null && request.method === 'GET') {
    const found = ROOMS.find((one) => one.id === room[1] && reachable.has(one.id));
    if (found === undefined) {
      send(response, 404, { error: 'not found' });
      return;
    }
    send(response, 200, found);
    return;
  }

  if (path === '/api/posts' && request.method === 'GET') {
    send(response, 200, { posts: POSTS.filter((post) => reachable.has(post.room_id)) });
    return;
  }

  const post = /^\/api\/posts\/([^/]+)$/.exec(path);
  if (post !== null && request.method === 'GET') {
    const found = POSTS.find((one) => one.id === post[1] && reachable.has(one.room_id));
    if (found === undefined) {
      send(response, 404, { error: 'not found' });
      return;
    }
    send(response, 200, found);
    return;
  }

  send(response, 404, { error: 'not found' });
});

server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
