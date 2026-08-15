import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { Invoice, LedgerData, User } from './data.ts';
import type { DefectSwitches } from './defects.ts';

export interface LedgerOptions {
  readonly data: LedgerData;
  readonly defects: DefectSwitches;
}

const INVOICE_PATH = /^\/api\/invoices\/([^/]+)$/;

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function authenticate(request: IncomingMessage, data: LedgerData): User | undefined {
  const header = request.headers.authorization;
  if (header === undefined) return undefined;

  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || token === undefined) return undefined;

  return data.users.find((user) => user.token === token);
}

/**
 * D1. The organization check is missing: the invoice is looked up by id alone, so any
 * authenticated user reads any invoice. Switching the defect off adds the check that
 * should have been here, and the refusal is a 404 rather than a 403 so the response
 * does not confirm that the invoice exists.
 */
function readInvoice(
  invoiceId: string,
  actor: User,
  options: LedgerOptions,
): { status: number; body: Invoice | { error: string } } {
  const invoice = options.data.invoices.find((candidate) => candidate.id === invoiceId);
  if (invoice === undefined) return { status: 404, body: { error: 'not_found' } };

  if (!options.defects.d1CrossOrgInvoiceRead && invoice.org_id !== actor.org_id) {
    return { status: 404, body: { error: 'not_found' } };
  }

  return { status: 200, body: invoice };
}

export function createLedgerServer(options: LedgerOptions): Server {
  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://ledger.invalid');

    if (request.method === 'GET' && url.pathname === '/health') {
      send(response, 200, { status: 'ok' });
      return;
    }

    const invoiceMatch = INVOICE_PATH.exec(url.pathname);
    if (request.method === 'GET' && invoiceMatch !== null) {
      const actor = authenticate(request, options.data);
      if (actor === undefined) {
        send(response, 401, { error: 'unauthenticated' });
        return;
      }

      const invoiceId = invoiceMatch[1];
      if (invoiceId === undefined) {
        send(response, 404, { error: 'not_found' });
        return;
      }

      const result = readInvoice(decodeURIComponent(invoiceId), actor, options);
      send(response, result.status, result.body);
      return;
    }

    send(response, 404, { error: 'not_found' });
  });
}
