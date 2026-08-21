import { createServer, type Server, type ServerResponse } from 'node:http';

import type { LedgerData } from './data.ts';
import type { DefectSwitches } from './defects.ts';
import {
  authenticate,
  createLedgerState,
  debugState,
  health,
  listInvoices,
  notFound,
  readInvoice,
  routeIndex,
  unauthenticated,
  updateInvoice,
  type Reply,
} from './handlers.ts';

/**
 * The ledger over `node:http`, and nothing but the routing.
 *
 * Every decision this server makes lives in `handlers.ts`, which
 * `fixtures/ledger-express` serves too. What is here is the dispatch: matching a method
 * and a path, and writing a reply to a socket. Keeping the two apart is what stops the
 * Express twin becoming a second opinion about what the defects do.
 */

export interface LedgerOptions {
  readonly data: LedgerData;
  readonly defects: DefectSwitches;
}

const INVOICE_PATH = /^\/api\/invoices\/([^/]+)$/;

function send(response: ServerResponse, reply: Reply<unknown>): void {
  const payload = JSON.stringify(reply.body);
  response.writeHead(reply.status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

export function createLedgerServer(options: LedgerOptions): Server {
  const { defects } = options;
  const state = createLedgerState(options.data);

  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://ledger.invalid');

    if (request.method === 'GET' && url.pathname === '/') {
      send(response, routeIndex(defects));
      return;
    }

    if (
      request.method === 'GET' &&
      url.pathname === '/api/debug/state' &&
      defects.d5UndeclaredDebugEndpoint
    ) {
      send(response, debugState(state, defects));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      send(response, health());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/invoices') {
      const actor = authenticate(request, state);
      if (actor === undefined) {
        send(response, unauthenticated());
        return;
      }

      send(response, listInvoices(actor, state, defects));
      return;
    }

    const mutationMatch = INVOICE_PATH.exec(url.pathname);
    if ((request.method === 'PATCH' || request.method === 'PUT') && mutationMatch !== null) {
      const actor = authenticate(request, state);
      const invoiceId = mutationMatch[1];

      if (invoiceId === undefined) {
        send(response, notFound());
        return;
      }

      send(response, updateInvoice(decodeURIComponent(invoiceId), actor, state, defects));
      return;
    }

    const invoiceMatch = INVOICE_PATH.exec(url.pathname);
    if (request.method === 'GET' && invoiceMatch !== null) {
      const actor = authenticate(request, state);
      if (actor === undefined) {
        send(response, unauthenticated());
        return;
      }

      const invoiceId = invoiceMatch[1];
      if (invoiceId === undefined) {
        send(response, notFound());
        return;
      }

      send(response, readInvoice(decodeURIComponent(invoiceId), actor, state, defects));
      return;
    }

    send(response, notFound());
  });
}
