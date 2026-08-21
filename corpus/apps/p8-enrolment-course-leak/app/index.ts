import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';

/**
 * P8, courses and enrolments. Generated from the prompt, not from any spec.
 *
 * The enrolment routes are enforced correctly: a student reads their own enrolment and
 * nobody else's, and the listing is scoped to the caller. Every rule the prompt states
 * about enrolments holds on the routes that serve enrolments.
 *
 * The defect is on a different route entirely. The course detail view embeds the
 * enrolments behind the course so a page can render a roster in one request, and the
 * embedded records are whole enrolment rows, grades included. Nothing about the
 * enrolment routes is wrong; the grades leave through the course.
 */

interface Account {
  readonly token: string;
  readonly id: string;
}

interface Course {
  readonly id: string;
  readonly title: string;
  readonly teacher_id: string;
}

interface Enrolment {
  readonly id: string;
  readonly course_id: string;
  readonly student_id: string;
  readonly grade: string;
}

const ACCOUNTS: readonly Account[] = [
  { token: 'course-ines-token', id: 'ines' },
  { token: 'course-jonas-token', id: 'jonas' },
];

const COURSES: readonly Course[] = [
  { id: 'CRS-10', title: 'Numerical methods', teacher_id: 'tabitha' },
  { id: 'CRS-20', title: 'Operating systems', teacher_id: 'tabitha' },
];

const ENROLMENTS: readonly Enrolment[] = [
  { id: 'ENR-10', course_id: 'CRS-10', student_id: 'ines', grade: 'A' },
  { id: 'ENR-20', course_id: 'CRS-20', student_id: 'ines', grade: 'B' },
  { id: 'ENR-30', course_id: 'CRS-10', student_id: 'jonas', grade: 'D' },
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

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;

  if (path === '/') {
    send(response, 200, {
      name: 'enrolment',
      routes: ['/api/courses', '/api/courses/{id}', '/api/enrolments', '/api/enrolments/{id}'],
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

  const account = accountOf(request);
  if (account === undefined) {
    send(response, 401, { error: 'sign in first' });
    return;
  }

  if (path === '/api/courses' && request.method === 'GET') {
    send(response, 200, { courses: COURSES });
    return;
  }

  const course = /^\/api\/courses\/([^/]+)$/.exec(path);
  if (course !== null && request.method === 'GET') {
    const found = COURSES.find((one) => one.id === course[1]);
    if (found === undefined) {
      send(response, 404, { error: 'not found' });
      return;
    }

    // The roster, so a course page renders in one request rather than one per student.
    send(response, 200, {
      ...found,
      enrolments: ENROLMENTS.filter((one) => one.course_id === found.id),
    });
    return;
  }

  if (path === '/api/enrolments' && request.method === 'GET') {
    send(response, 200, {
      enrolments: ENROLMENTS.filter((one) => one.student_id === account.id),
    });
    return;
  }

  const enrolment = /^\/api\/enrolments\/([^/]+)$/.exec(path);
  if (enrolment !== null && request.method === 'GET') {
    const found = ENROLMENTS.find((one) => one.id === enrolment[1]);
    if (found === undefined) {
      send(response, 404, { error: 'not found' });
      return;
    }

    if (found.student_id !== account.id) {
      send(response, 403, { error: 'not your enrolment' });
      return;
    }

    send(response, 200, found);
    return;
  }

  send(response, 404, { error: 'not found' });
});

server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
