/**
 * The ledger's behaviour, with no transport in it.
 *
 * Two servers serve this application: `app.ts`, a hand-written `node:http` server, and
 * `fixtures/ledger-express`, the same API on Express so a source adapter has a route
 * table to read. Extracted here at S9.3 so those two are one implementation behind two
 * transports rather than two implementations of one specification. A second copy of a
 * seeded defect would drift, and a defect that behaved differently depending on which
 * server was running would make every finding about it unreadable.
 *
 * Each handler takes what it needs and returns a status and a body. Nothing here writes
 * to a socket, and nothing here reads a route.
 */

import type { IncomingMessage } from 'node:http';

import type { Invoice, LedgerData, User } from './data.ts';
import type { DefectSwitches } from './defects.ts';

/**
 * The rows this server is serving, as opposed to the rows it was seeded with.
 *
 * A write moves these and leaves the seed alone, so a fresh server always starts from the
 * same data and a restart is genuinely the reset that `qai.config.yaml` claims it is.
 */
export interface LedgerState {
  readonly organizations: readonly LedgerData['organizations'][number][];
  readonly users: readonly User[];
  readonly invoices: Invoice[];
}

/** A listed row with the sensitive field dropped, which is what REQ-004 asks for. */
export type ListedInvoice = Omit<Invoice, 'notes'>;

export interface Reply<T> {
  readonly status: number;
  readonly body: T;
}

/** The seed, copied, so a write moves this server's rows and not the next server's. */
export function createLedgerState(data: LedgerData): LedgerState {
  return {
    organizations: [...data.organizations],
    users: [...data.users],
    invoices: [...data.invoices],
  };
}

/**
 * The bearer token on the request, resolved to a seeded user.
 *
 * Typed against `IncomingMessage` because that is what both transports carry: an Express
 * request is one, so this is shared rather than reimplemented per server.
 */
export function authenticate(request: IncomingMessage, state: LedgerState): User | undefined {
  const header = request.headers.authorization;
  if (header === undefined) return undefined;

  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || token === undefined) return undefined;

  return state.users.find((user) => user.token === token);
}

/**
 * D1. The organization check is missing: the invoice is looked up by id alone, so any
 * authenticated user reads any invoice. Switching the defect off adds the check that
 * should have been here, and the refusal is a 404 rather than a 403 so the response
 * does not confirm that the invoice exists.
 */
export function readInvoice(
  invoiceId: string,
  actor: User,
  state: LedgerState,
  defects: DefectSwitches,
): Reply<Invoice | { error: string }> {
  const invoice = state.invoices.find((candidate) => candidate.id === invoiceId);
  if (invoice === undefined) return { status: 404, body: { error: 'not_found' } };

  if (!defects.d1CrossOrgInvoiceRead && invoice.org_id !== actor.org_id) {
    return { status: 404, body: { error: 'not_found' } };
  }

  return { status: 200, body: invoice };
}

/**
 * D2. The list returns every invoice rather than the caller's. Switching the defect off
 * filters by organization, which is what the requirement says should happen.
 *
 * D4. The list also hands back `notes`, which the spec marks sensitive and REQ-004 says
 * to omit from list responses. Switching that defect off drops the field from every row
 * while leaving a single invoice read alone, since the requirement is about the list.
 *
 * Note the shape: the rows come back under a `invoices` key rather than as a bare
 * array, because a check that only understood top level arrays would miss this.
 *
 * The redacted row is spelled out field by field against `ListedInvoice` rather than
 * copied and pruned, so a field added to `Invoice` later fails to compile here instead
 * of quietly vanishing from the list.
 */
export function listInvoices(
  actor: User,
  state: LedgerState,
  defects: DefectSwitches,
): Reply<{ invoices: (Invoice | ListedInvoice)[] }> {
  const scoped = defects.d2UnscopedInvoiceList
    ? [...state.invoices]
    : state.invoices.filter((invoice) => invoice.org_id === actor.org_id);

  if (defects.d4NotesInInvoiceList) return { status: 200, body: { invoices: scoped } };

  const withoutNotes: ListedInvoice[] = scoped.map((invoice) => ({
    id: invoice.id,
    org_id: invoice.org_id,
    total_cents: invoice.total_cents,
  }));

  return { status: 200, body: { invoices: withoutNotes } };
}

/**
 * D3. The mutation path never authenticates. With the defect off it refuses an
 * unauthenticated caller with a 401, and refuses a cross-organization write with a 404.
 *
 * The cross-organization refusal is negative control N2 and holds either way: this
 * defect is about the missing credential check, not about ownership.
 *
 * **An accepted write actually writes.** It did not until M5.11, and that made the
 * catalog line for D3, that an invoice can be modified without credentials, only half
 * true: the request was accepted and nothing moved, so a criterion saying the invoice is
 * unchanged could never be false and the defect could not be caught by looking at the
 * record. The request carries no body, since the tool issues none, so the change is a
 * fixed one: the total is incremented. What matters is that something moved.
 */
export function updateInvoice(
  invoiceId: string,
  actor: User | undefined,
  state: LedgerState,
  defects: DefectSwitches,
): Reply<Invoice | { error: string }> {
  if (!defects.d3UnauthenticatedMutation && actor === undefined) {
    return { status: 401, body: { error: 'unauthenticated' } };
  }

  const index = state.invoices.findIndex((candidate) => candidate.id === invoiceId);
  const invoice = state.invoices[index];
  if (invoice === undefined) return { status: 404, body: { error: 'not_found' } };

  if (actor !== undefined && invoice.org_id !== actor.org_id) {
    return { status: 404, body: { error: 'not_found' } };
  }

  const updated: Invoice = { ...invoice, total_cents: invoice.total_cents + 1 };
  state.invoices[index] = updated;

  return { status: 200, body: updated };
}

/**
 * D5. A debug endpoint no requirement asks for, handing back internal state. It is the
 * shape of a route added during development and never removed, which is what the
 * structural diff exists to surface.
 */
export function debugState(
  state: LedgerState,
  defects: DefectSwitches,
): Reply<{ users: number; invoices: number; defects: DefectSwitches }> {
  return {
    status: 200,
    body: { users: state.users.length, invoices: state.invoices.length, defects },
  };
}

/**
 * The route index is not a defect. A small JSON service that lists its own routes is
 * ordinary, and without something naming the debug route a black box crawl could not
 * reach it at all: an unlinked route is the known blind spot of crawling, recorded in
 * the probe's confidence levels rather than papered over here.
 */
export function routeIndex(defects: DefectSwitches): Reply<{ routes: string[] }> {
  const routes = ['/health', '/api/invoices', '/api/invoices/{id}'];
  if (defects.d5UndeclaredDebugEndpoint) routes.push('/api/debug/state');
  return { status: 200, body: { routes } };
}

export function health(): Reply<{ status: string }> {
  return { status: 200, body: { status: 'ok' } };
}

export function notFound(): Reply<{ error: string }> {
  return { status: 404, body: { error: 'not_found' } };
}

export function unauthenticated(): Reply<{ error: string }> {
  return { status: 401, body: { error: 'unauthenticated' } };
}
