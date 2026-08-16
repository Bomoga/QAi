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

/**
 * D2. The list returns every invoice rather than the caller's. Switching the defect off
 * filters by organization, which is what the requirement says should happen.
 *
 * Note the shape: the rows come back under a `invoices` key rather than as a bare
 * array, because a check that only understood top level arrays would miss this.
 */
function listInvoices(
  actor: User,
  options: LedgerOptions,
): { status: number; body: { invoices: Invoice[] } } {
  const invoices = options.defects.d2UnscopedInvoiceList
    ? [...options.data.invoices]
    : options.data.invoices.filter((invoice) => invoice.org_id === actor.org_id);

  return { status: 200, body: { invoices } };
}

/**
 * D3. The mutation path never authenticates. With the defect off it refuses an
 * unauthenticated caller with a 401, and refuses a cross-organization write with a 404.
 *
 * The cross-organization refusal is negative control N2 and holds either way: this
 * defect is about the missing credential check, not about ownership.
 */
function updateInvoice(
  invoiceId: string,
  actor: User | undefined,
  options: LedgerOptions,
): { status: number; body: Invoice | { error: string } } {
  if (!options.defects.d3UnauthenticatedMutation && actor === undefined) {
    return { status: 401, body: { error: 'unauthenticated' } };
  }

  const invoice = options.data.invoices.find((candidate) => candidate.id === invoiceId);
  if (invoice === undefined) return { status: 404, body: { error: 'not_found' } };

  if (actor !== undefined && invoice.org_id !== actor.org_id) {
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

    if (request.method === 'GET' && url.pathname === '/api/invoices') {
      const actor = authenticate(request, options.data);
      if (actor === undefined) {
        send(response, 401, { error: 'unauthenticated' });
        return;
      }

      const result = listInvoices(actor, options);
      send(response, result.status, result.body);
      return;
    }

    const mutationMatch = INVOICE_PATH.exec(url.pathname);
    if ((request.method === 'PATCH' || request.method === 'PUT') && mutationMatch !== null) {
      const actor = authenticate(request, options.data);
      const invoiceId = mutationMatch[1];

      if (invoiceId === undefined) {
        send(response, 404, { error: 'not_found' });
        return;
      }

      const result = updateInvoice(decodeURIComponent(invoiceId), actor, options);
      send(response, result.status, result.body);
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
