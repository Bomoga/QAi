import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';

/**
 * P4, meeting room bookings. Generated from the prompt, not from any spec.
 *
 * The caller is a session cookie, and every decision is made inside the query rather
 * than in a handler: `roomsFor` and `bookingsFor` take the caller and return what that
 * caller may see, so a handler that forgot to filter would have nothing to forget with.
 *
 * Cancelling somebody else's booking answers 404 rather than 403. A booking in another
 * office is not a thing this caller is allowed to know exists, and the same answer covers
 * a booking that is genuinely absent.
 *
 * Cancelling marks the booking rather than removing it, so a cancel is idempotent and the
 * record stays readable by the office. That is a product choice, not a concession to the
 * tool: a meeting room calendar that forgets a cancelled booking loses the audit of who
 * held the room.
 */

interface Person {
  readonly sid: string;
  readonly id: string;
  readonly office_id: string;
}

interface Room {
  readonly id: string;
  readonly name: string;
  readonly office_id: string;
}

interface Booking {
  readonly id: string;
  readonly room_id: string;
  readonly office_id: string;
  readonly booked_by: string;
  readonly starts_at: string;
  cancelled: boolean;
}

const PEOPLE: readonly Person[] = [
  { sid: 'bookings-bea-sid', id: 'bea', office_id: 'OFF-1' },
  { sid: 'bookings-cal-sid', id: 'cal', office_id: 'OFF-1' },
  { sid: 'bookings-oscar-sid', id: 'oscar', office_id: 'OFF-2' },
];

const ROOMS: readonly Room[] = [
  { id: 'ROOM-1', name: 'Kelvin', office_id: 'OFF-1' },
  { id: 'ROOM-2', name: 'Faraday', office_id: 'OFF-1' },
  { id: 'ROOM-9', name: 'Hertz', office_id: 'OFF-2' },
];

const BOOKINGS: Booking[] = [
  {
    id: 'BKG-1',
    room_id: 'ROOM-1',
    office_id: 'OFF-1',
    booked_by: 'bea',
    starts_at: '2026-09-01T09:00:00Z',
    cancelled: false,
  },
  {
    id: 'BKG-2',
    room_id: 'ROOM-2',
    office_id: 'OFF-1',
    booked_by: 'cal',
    starts_at: '2026-09-01T11:00:00Z',
    cancelled: false,
  },
  {
    id: 'BKG-3',
    room_id: 'ROOM-9',
    office_id: 'OFF-2',
    booked_by: 'oscar',
    starts_at: '2026-09-02T14:00:00Z',
    cancelled: false,
  },
];

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

/** Reads the session cookie. Nothing else identifies a caller here. */
function callerOf(request: IncomingMessage): Person | undefined {
  const header = request.headers.cookie;
  if (header === undefined) return undefined;

  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'sid') return PEOPLE.find((one) => one.sid === rest.join('='));
  }

  return undefined;
}

/** The query, and the only place the office rule is written down. */
function roomsFor(caller: Person): Room[] {
  return ROOMS.filter((room) => room.office_id === caller.office_id);
}

function bookingsFor(caller: Person): Booking[] {
  return BOOKINGS.filter((booking) => booking.office_id === caller.office_id);
}

function roomView(room: Room): Record<string, unknown> {
  const held = BOOKINGS.some((booking) => booking.room_id === room.id && !booking.cancelled);
  return { id: room.id, name: room.name, office_id: room.office_id, free: !held };
}

function bookingView(booking: Booking): Record<string, unknown> {
  return {
    id: booking.id,
    room_id: booking.room_id,
    office_id: booking.office_id,
    booked_by: booking.booked_by,
    starts_at: booking.starts_at,
    cancelled: booking.cancelled,
  };
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const method = request.method ?? 'GET';

  if (path === '/') {
    send(response, 200, {
      name: 'bookings',
      routes: ['/api/rooms', '/api/rooms/{id}', '/api/bookings', '/api/bookings/{id}'],
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

  const caller = callerOf(request);
  if (caller === undefined) {
    send(response, 401, { error: 'sign in first' });
    return;
  }

  if (path === '/api/rooms' && method === 'GET') {
    send(response, 200, { rooms: roomsFor(caller).map(roomView) });
    return;
  }

  const room = /^\/api\/rooms\/([^/]+)$/.exec(path);
  if (room !== null && method === 'GET') {
    const found = roomsFor(caller).find((one) => one.id === room[1]);
    if (found === undefined) {
      send(response, 404, { error: 'not found' });
      return;
    }
    send(response, 200, roomView(found));
    return;
  }

  if (path === '/api/bookings') {
    if (method === 'GET') {
      send(response, 200, { bookings: bookingsFor(caller).map(bookingView) });
      return;
    }

    if (method === 'POST') {
      const free = roomsFor(caller).find((one) =>
        BOOKINGS.every((booking) => booking.room_id !== one.id || booking.cancelled),
      );
      if (free === undefined) {
        send(response, 409, { error: 'no free room in your office' });
        return;
      }

      const created: Booking = {
        id: `BKG-${String(BOOKINGS.length + 1)}`,
        room_id: free.id,
        office_id: caller.office_id,
        booked_by: caller.id,
        starts_at: '2026-09-03T09:00:00Z',
        cancelled: false,
      };
      BOOKINGS.push(created);
      send(response, 201, bookingView(created));
      return;
    }
  }

  const booking = /^\/api\/bookings\/([^/]+)$/.exec(path);
  if (booking !== null) {
    // Resolved through the query, so a booking in another office is not found here at
    // all rather than being found and then refused.
    const found = bookingsFor(caller).find((one) => one.id === booking[1]);
    if (found === undefined) {
      send(response, 404, { error: 'not found' });
      return;
    }

    if (method === 'GET') {
      send(response, 200, bookingView(found));
      return;
    }

    if (method === 'DELETE') {
      if (found.booked_by !== caller.id) {
        send(response, 404, { error: 'not found' });
        return;
      }
      found.cancelled = true;
      send(response, 200, bookingView(found));
      return;
    }
  }

  send(response, 404, { error: 'not found' });
});

server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
