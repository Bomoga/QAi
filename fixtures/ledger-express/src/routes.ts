import express, { type Express, type Request, type Response } from 'express';

import type { LedgerData } from '../../ledger/src/data.ts';
import type { DefectSwitches } from '../../ledger/src/defects.ts';
import {
  authenticate,
  createLedgerState,
  health,
  listInvoices,
  notFound,
  readInvoice,
  routeIndex,
  unauthenticated,
  updateInvoice,
  type LedgerState,
  type Reply,
} from '../../ledger/src/handlers.ts';

/**
 * The ledger's route table, written the way Express declares one.
 *
 * **Why this exists.** A finding ends with a file reference when source is available,
 * and until S9.3 nothing in this repository gave the source adapters anything to read:
 * `fixtures/ledger` is a hand-written `node:http` server, twenty corpus applications are
 * the same, and no adapter recognizes that shape. So the file reference, which is a real
 * part of what this tool is for, was never demonstrated end to end. This file is a route
 * table the Express adapter reads, and the line each route is declared on is what a
 * finding cites.
 *
 * **Every decision is imported.** `handlers.ts` holds the behaviour and both servers
 * call it, so this is a transport and not a second opinion about what the defects do.
 * `test/parity.test.ts` drives the two servers through the same requests and compares
 * the answers, because two copies of one fixture is exactly the thing that drifts.
 *
 * **D5 is deliberately not served here**, and the switch is forced off below rather than
 * ignored quietly. D5 is a debug endpoint nobody asked for, and its absence is what the
 * switch expresses. A source adapter reads text: a route registered behind a runtime
 * condition is still declared in the file, so with the defect off this server would
 * report an endpoint it does not serve. Fixing that defect means deleting the line, which
 * an environment variable cannot model. The ledger keeps D5 for the checks and goldens
 * built on it; the demo's criterion is about an access finding, and D1, D2, D3, and D4
 * are all here.
 */

export interface LedgerExpressOptions {
  readonly data: LedgerData;
  readonly defects: DefectSwitches;
}

function reply(response: Response, result: Reply<unknown>): void {
  response.status(result.status).json(result.body);
}

/**
 * Express decodes a route parameter already, so the id arrives in the same form the
 * `node:http` server produces with `decodeURIComponent`. Decoding twice here would make
 * the two servers disagree about a path the crawler really sends, `/api/invoices/%7Bid%7D`.
 */
function invoiceId(request: Request): string {
  const id = request.params['id'];
  // A single segment always arrives as a string. The array arm is for repeated and
  // wildcard parameters, which this table declares none of, and an empty id reaches the
  // same 404 the other server produces for a path that matched no invoice.
  return typeof id === 'string' ? id : '';
}

export function createLedgerExpressApp(options: LedgerExpressOptions): Express {
  const defects: DefectSwitches = { ...options.defects, d5UndeclaredDebugEndpoint: false };
  const state: LedgerState = createLedgerState(options.data);
  const app = express();

  // Express compares paths loosely by default and the `node:http` server compares them
  // with `===`, so `/api/invoices/` and `/API/invoices` would answer differently on the
  // two. Both are in the parity matrix; these two settings are what make them agree.
  app.set('strict routing', true);
  app.set('case sensitive routing', true);

  app.get('/', (_request, response) => reply(response, routeIndex(defects)));

  app.get('/health', (_request, response) => reply(response, health()));

  app.get('/api/invoices', (request, response) => {
    const actor = authenticate(request, state);
    if (actor === undefined) return reply(response, unauthenticated());

    return reply(response, listInvoices(actor, state, defects));
  });

  app.get('/api/invoices/:id', (request, response) => {
    const actor = authenticate(request, state);
    if (actor === undefined) return reply(response, unauthenticated());

    return reply(response, readInvoice(invoiceId(request), actor, state, defects));
  });

  // D3 leaves the credential check off the mutation path, so the actor may be absent
  // here where the reads above refuse. PUT is served alongside PATCH because the
  // `node:http` server does, and the two have to answer alike.
  app.patch('/api/invoices/:id', (request, response) => {
    const actor = authenticate(request, state);
    return reply(response, updateInvoice(invoiceId(request), actor, state, defects));
  });

  app.put('/api/invoices/:id', (request, response) => {
    const actor = authenticate(request, state);
    return reply(response, updateInvoice(invoiceId(request), actor, state, defects));
  });

  // Anything unrouted, and any method this table does not declare on a path it does.
  app.use((_request, response) => reply(response, notFound()));

  return app;
}
