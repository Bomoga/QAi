import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';

/**
 * P8, courses and enrolments. Generated from the prompt, not from any spec.
 *
 * Authorization is a middleware chain rather than a check inside each handler. A request
 * walks a list of rules, the first one whose path and method match decides whether it
 * continues, and only then does a handler run. The handlers hold no credential logic at
 * all, which is the point of writing it this way: a new route is refused by default
 * because nothing in the chain permits it.
 *
 * The course list is public, because the prompt calls it the public course list. Grades
 * are the opposite: an enrolment is readable by the student it belongs to and by the
 * teacher of that course, and by nobody else, which the chain states once.
 */

interface Account {
  readonly token: string;
  readonly id: string;
  readonly role: 'student' | 'teacher';
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
  { token: 'enrol-sid-token', id: 'sid', role: 'student' },
  { token: 'enrol-tam-token', id: 'tam', role: 'student' },
  { token: 'enrol-tess-token', id: 'tess', role: 'teacher' },
];

const COURSES: readonly Course[] = [
  { id: 'CRS-1', title: 'Discrete mathematics', teacher_id: 'tess' },
  { id: 'CRS-2', title: 'Compilers', teacher_id: 'theo' },
];

const ENROLMENTS: Enrolment[] = [
  { id: 'ENR-1', course_id: 'CRS-1', student_id: 'sid', grade: 'B+' },
  { id: 'ENR-2', course_id: 'CRS-2', student_id: 'sid', grade: 'A-' },
  { id: 'ENR-3', course_id: 'CRS-2', student_id: 'tam', grade: 'C' },
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

function enrolmentOf(path: string): Enrolment | undefined {
  const match = /^\/api\/enrolments\/([^/]+)$/.exec(path);
  return match === null ? undefined : ENROLMENTS.find((one) => one.id === match[1]);
}

function teaches(account: Account, enrolment: Enrolment): boolean {
  const course = COURSES.find((one) => one.id === enrolment.course_id);
  return course !== undefined && course.teacher_id === account.id;
}

type Decision = { readonly allow: true } | { readonly allow: false; readonly status: number };

const CONTINUE: Decision = { allow: true };

interface Rule {
  readonly matches: (path: string, method: string) => boolean;
  readonly decide: (account: Account | undefined, path: string) => Decision;
}

/**
 * The chain, read top to bottom. Nothing below it looks at a credential again, and a
 * path no rule matches never reaches a handler.
 */
const CHAIN: readonly Rule[] = [
  {
    matches: (path) => path === '/' || path === '/health',
    decide: () => CONTINUE,
  },
  {
    // The public course list, and a course record, which carries no grade.
    matches: (path) => path === '/api/courses' || /^\/api\/courses\/[^/]+$/u.test(path),
    decide: () => CONTINUE,
  },
  {
    matches: (path, method) => path === '/api/enrolments' && method === 'GET',
    decide: (account) => (account === undefined ? { allow: false, status: 401 } : CONTINUE),
  },
  {
    matches: (path, method) => path === '/api/enrolments' && method === 'POST',
    decide: (account) => {
      if (account === undefined) return { allow: false, status: 401 };
      // Enrolling is for the signed in student themselves, so a teacher enrolling
      // somebody is not a thing this API offers.
      return account.role === 'student' ? CONTINUE : { allow: false, status: 403 };
    },
  },
  {
    matches: (path) => /^\/api\/enrolments\/[^/]+$/u.test(path),
    decide: (account, path) => {
      if (account === undefined) return { allow: false, status: 401 };

      const enrolment = enrolmentOf(path);
      if (enrolment === undefined) return { allow: false, status: 404 };

      const own = account.role === 'student' && enrolment.student_id === account.id;
      return own || teaches(account, enrolment) ? CONTINUE : { allow: false, status: 403 };
    },
  },
];

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const method = request.method ?? 'GET';
  const account = accountOf(request);

  const rule = CHAIN.find((one) => one.matches(path, method));
  if (rule === undefined) {
    send(response, 404, { error: 'not found' });
    return;
  }

  const decision = rule.decide(account, path);
  if (!decision.allow) {
    send(response, decision.status, { error: 'refused' });
    return;
  }

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

  if (path === '/api/courses') {
    send(response, 200, { courses: COURSES });
    return;
  }

  const course = /^\/api\/courses\/([^/]+)$/.exec(path);
  if (course !== null) {
    const found = COURSES.find((one) => one.id === course[1]);
    if (found === undefined) {
      send(response, 404, { error: 'not found' });
      return;
    }
    send(response, 200, found);
    return;
  }

  if (path === '/api/enrolments') {
    if (method === 'GET') {
      // The chain established who this is; the handler only says whose rows they are.
      const mine =
        account?.role === 'teacher'
          ? ENROLMENTS.filter((one) => teaches(account, one))
          : ENROLMENTS.filter((one) => one.student_id === account?.id);
      send(response, 200, { enrolments: mine });
      return;
    }

    if (method === 'POST' && account !== undefined) {
      const created: Enrolment = {
        id: `ENR-${String(ENROLMENTS.length + 1)}`,
        course_id: 'CRS-2',
        student_id: account.id,
        grade: '',
      };
      ENROLMENTS.push(created);
      send(response, 201, created);
      return;
    }
  }

  const enrolment = enrolmentOf(path);
  if (enrolment !== undefined && method === 'GET') {
    send(response, 200, enrolment);
    return;
  }

  send(response, 404, { error: 'not found' });
});

server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
