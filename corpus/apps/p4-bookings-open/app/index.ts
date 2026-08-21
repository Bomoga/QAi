import { createServer, type ServerResponse } from 'node:http';
import process from 'node:process';

/**
 * P4, meeting room bookings. Generated from the prompt, not from any spec.
 *
 * This one has no authentication at all. It was written as an internal tool for one
 * office, where everybody on the network is a colleague, and the sign in was going to be
 * added later. The prompt says a booking can be cancelled only by the person who made it,
 * and there is nothing here that could tell one person from another, so cancelling is
 * open to whoever asks.
 *
 * It is the credential value the corpus otherwise has none of, and the enforcement value
 * likewise: no credential, and nowhere for a rule to live.
 */

interface Booking {
  readonly id: string;
  readonly room_id: string;
  readonly booked_by: string;
  readonly starts_at: string;
}

const BOOKINGS: Booking[] = [
  { id: 'B-1', room_id: 'R-1', booked_by: 'bo', starts_at: '2026-09-01T09:00:00Z' },
  { id: 'B-2', room_id: 'R-2', booked_by: 'cass', starts_at: '2026-09-01T11:00:00Z' },
];

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const method = request.method ?? 'GET';

  if (path === '/') {
    send(response, 200, { name: 'bookings', routes: ['/api/bookings', '/api/bookings/{id}'] });
    return;
  }

  if (path === '/health') {
    send(response, 200, { status: 'ok' });
    return;
  }

  if (path === '/api/bookings') {
    if (method === 'GET') {
      send(response, 200, { bookings: BOOKINGS });
      return;
    }

    if (method === 'POST') {
      const created: Booking = {
        id: `B-${String(BOOKINGS.length + 1)}`,
        room_id: 'R-3',
        booked_by: 'unknown',
        starts_at: '2026-09-04T09:00:00Z',
      };
      BOOKINGS.push(created);
      send(response, 201, created);
      return;
    }
  }

  const match = /^\/api\/bookings\/([^/]+)$/.exec(path);
  if (match !== null) {
    const index = BOOKINGS.findIndex((one) => one.id === match[1]);
    if (index === -1) {
      send(response, 404, { error: 'not found' });
      return;
    }

    if (method === 'GET') {
      send(response, 200, BOOKINGS[index]);
      return;
    }

    if (method === 'DELETE') {
      const [removed] = BOOKINGS.splice(index, 1);
      send(response, 200, { cancelled: removed?.id });
      return;
    }
  }

  send(response, 404, { error: 'not found' });
});

server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
