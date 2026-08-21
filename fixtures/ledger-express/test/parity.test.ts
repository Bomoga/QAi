import type { Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { createLedgerServer } from '../../ledger/src/app.ts';
import { OUTSIDER_TOKEN, OWNER_TOKEN, seedLedger } from '../../ledger/src/data.ts';
import type { DefectSwitches } from '../../ledger/src/defects.ts';
import { createLedgerExpressApp } from '../src/routes.ts';

/**
 * Two servers, one application.
 *
 * The Express twin exists so a source adapter has a route table to read, and the cost of
 * it is a second implementation of a fixture the whole suite is written against. That
 * cost is paid here: every request below goes to both servers and the two answers have to
 * match, status and body. `handlers.ts` is shared, so a divergence means the routing
 * diverged, which is the half that genuinely differs and therefore the half that drifts.
 *
 * D5 is the one deliberate difference and it is stated rather than skipped: the twin
 * never serves the debug endpoint, for the reason written at the top of `src/routes.ts`,
 * so both servers here are given the switch off and a separate test holds the difference.
 *
 * Rule R9: two local sockets on ephemeral ports, nothing remote.
 */

const DEFECTS_ON: DefectSwitches = {
  d1CrossOrgInvoiceRead: true,
  d2UnscopedInvoiceList: true,
  d3UnauthenticatedMutation: true,
  d4NotesInInvoiceList: true,
  d5UndeclaredDebugEndpoint: false,
};

const DEFECTS_OFF: DefectSwitches = {
  d1CrossOrgInvoiceRead: false,
  d2UnscopedInvoiceList: false,
  d3UnauthenticatedMutation: false,
  d4NotesInInvoiceList: false,
  d5UndeclaredDebugEndpoint: false,
};

interface Call {
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly token?: string;
}

/**
 * Every path either server routes, as every actor that tells them apart, plus the
 * refusals. A matrix rather than a handful of cases: a routing difference can hide behind
 * whichever requests nobody wrote down.
 */
const CALLS: readonly Call[] = [
  { name: 'route index', method: 'GET', path: '/' },
  { name: 'health', method: 'GET', path: '/health' },
  { name: 'list as owner', method: 'GET', path: '/api/invoices', token: OWNER_TOKEN },
  { name: 'list as outsider', method: 'GET', path: '/api/invoices', token: OUTSIDER_TOKEN },
  { name: 'list unauthenticated', method: 'GET', path: '/api/invoices' },
  { name: 'own invoice', method: 'GET', path: '/api/invoices/INV-1001', token: OWNER_TOKEN },
  {
    name: 'foreign invoice',
    method: 'GET',
    path: '/api/invoices/INV-1001',
    token: OUTSIDER_TOKEN,
  },
  { name: 'invoice unauthenticated', method: 'GET', path: '/api/invoices/INV-1001' },
  { name: 'absent invoice', method: 'GET', path: '/api/invoices/INV-9999', token: OWNER_TOKEN },
  // The crawler really sends this, from the route index naming `/api/invoices/{id}`.
  {
    name: 'unresolved parameter',
    method: 'GET',
    path: '/api/invoices/%7Bid%7D',
    token: OWNER_TOKEN,
  },
  { name: 'patch unauthenticated', method: 'PATCH', path: '/api/invoices/INV-1001' },
  { name: 'patch as owner', method: 'PATCH', path: '/api/invoices/INV-1001', token: OWNER_TOKEN },
  {
    name: 'patch a foreign invoice',
    method: 'PATCH',
    path: '/api/invoices/INV-2001',
    token: OWNER_TOKEN,
  },
  { name: 'put as owner', method: 'PUT', path: '/api/invoices/INV-1001', token: OWNER_TOKEN },
  { name: 'unrouted path', method: 'GET', path: '/api/nothing' },
  // Express compares paths loosely by default and the other server compares with `===`.
  { name: 'trailing slash', method: 'GET', path: '/api/invoices/', token: OWNER_TOKEN },
  { name: 'wrong case', method: 'GET', path: '/API/invoices', token: OWNER_TOKEN },
  { name: 'empty invoice id', method: 'GET', path: '/api/invoices//', token: OWNER_TOKEN },
  { name: 'debug endpoint', method: 'GET', path: '/api/debug/state', token: OWNER_TOKEN },
  { name: 'method with no route', method: 'DELETE', path: '/api/invoices/INV-1001' },
  { name: 'post to a collection', method: 'POST', path: '/api/invoices', token: OWNER_TOKEN },
];

const running: Server[] = [];

afterEach(async () => {
  await Promise.all(
    running.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
  );
});

/**
 * Both shapes bind the same way and differ in what they hand back: a `node:http` server
 * returns itself and an Express application returns the server it created. Taking the
 * return value covers both.
 */
interface Listenable {
  listen(port: number, host: string, callback: () => void): Server;
}

async function listen(target: Listenable): Promise<string> {
  const server = await new Promise<Server>((done) => {
    const bound = target.listen(0, '127.0.0.1', () => done(bound));
  });

  running.push(server);
  const address = server.address();
  const port = address !== null && typeof address !== 'string' ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

async function answer(baseUrl: string, call: Call): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${call.path}`, {
    method: call.method,
    headers: call.token === undefined ? {} : { authorization: `Bearer ${call.token}` },
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Left as text. A non-JSON body is itself a difference worth failing on.
  }

  return { status: response.status, body };
}

function servers(defects: DefectSwitches): { node: Listenable; express: Listenable } {
  return {
    node: createLedgerServer({ data: seedLedger(), defects }),
    express: createLedgerExpressApp({ data: seedLedger(), defects }),
  };
}

describe.each([
  ['defects on', DEFECTS_ON],
  ['defects off', DEFECTS_OFF],
])('the two servers answer alike, %s', (_label, defects) => {
  it.each(CALLS.map((call) => [call.name, call] as const))('%s', async (_name, call) => {
    const pair = servers(defects);
    const [nodeUrl, expressUrl] = await Promise.all([listen(pair.node), listen(pair.express)]);

    const fromNode = await answer(nodeUrl, call);
    const fromExpress = await answer(expressUrl, call);

    expect(fromExpress).toStrictEqual(fromNode);
  });
});

describe('the one difference, stated rather than skipped', () => {
  it('never serves the debug endpoint, whatever the switch says', async () => {
    // D5's fix is deleting the route, and a source adapter reads the text whether or not
    // a runtime condition registers it. See the note at the top of src/routes.ts.
    const withD5: DefectSwitches = { ...DEFECTS_ON, d5UndeclaredDebugEndpoint: true };
    const baseUrl = await listen(createLedgerExpressApp({ data: seedLedger(), defects: withD5 }));

    const { status } = await answer(baseUrl, {
      name: 'debug',
      method: 'GET',
      path: '/api/debug/state',
      token: OWNER_TOKEN,
    });

    expect(status).toBe(404);
  });

  it('does not advertise the debug route in its index either', async () => {
    // Otherwise the index would name a route the server refuses, and the crawler follows
    // that index.
    const withD5: DefectSwitches = { ...DEFECTS_ON, d5UndeclaredDebugEndpoint: true };
    const baseUrl = await listen(createLedgerExpressApp({ data: seedLedger(), defects: withD5 }));

    const { body } = await answer(baseUrl, { name: 'index', method: 'GET', path: '/' });

    expect(body).toStrictEqual({ routes: ['/health', '/api/invoices', '/api/invoices/{id}'] });
  });

  it('the node server does serve it, so the switch still means something there', async () => {
    // The negative half. Without it the two assertions above could pass against a switch
    // that had stopped working everywhere.
    const withD5: DefectSwitches = { ...DEFECTS_ON, d5UndeclaredDebugEndpoint: true };
    const baseUrl = await listen(createLedgerServer({ data: seedLedger(), defects: withD5 }));

    const { status } = await answer(baseUrl, {
      name: 'debug',
      method: 'GET',
      path: '/api/debug/state',
      token: OWNER_TOKEN,
    });

    expect(status).toBe(200);
  });
});
