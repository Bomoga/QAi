import type { Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { createLedgerServer } from '../src/app.ts';
import { OUTSIDER_TOKEN, OWNER_TOKEN, seedLedger } from '../src/data.ts';

/**
 * Defect D1 from the catalog in 06-TESTING.md: an invoice is readable across
 * organizations by id. These tests hold the defect in place. If one of them starts
 * failing because the leak was repaired, the integration target no longer has
 * anything for an access check to find, and the repair is the regression.
 *
 * N1 is the negative control and matters as much as the defect: an owner reading
 * their own invoice must keep working, or every finding this app produces is suspect.
 */

let running: Server | undefined;

async function start(
  d1CrossOrgInvoiceRead: boolean,
  overrides: Partial<{
    d2UnscopedInvoiceList: boolean;
    d3UnauthenticatedMutation: boolean;
    d4NotesInInvoiceList: boolean;
    d5UndeclaredDebugEndpoint: boolean;
  }> = {},
): Promise<string> {
  const server = createLedgerServer({
    data: seedLedger(),
    defects: {
      d1CrossOrgInvoiceRead,
      d2UnscopedInvoiceList: overrides.d2UnscopedInvoiceList ?? true,
      d3UnauthenticatedMutation: overrides.d3UnauthenticatedMutation ?? true,
      d4NotesInInvoiceList: overrides.d4NotesInInvoiceList ?? true,
      d5UndeclaredDebugEndpoint: overrides.d5UndeclaredDebugEndpoint ?? true,
    },
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  running = server;

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('ledger did not bind to a TCP port');
  }
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  const server = running;
  running = undefined;
  if (server === undefined) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
});

function asActor(token: string): RequestInit {
  return { headers: { authorization: `Bearer ${token}` } };
}

describe('GET /api/invoices/:id', () => {
  it('N1: the owner reads their own invoice', async () => {
    const baseUrl = await start(true);

    const response = await fetch(`${baseUrl}/api/invoices/INV-1001`, asActor(OWNER_TOKEN));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({ id: 'INV-1001', org_id: 'org-1' });
  });

  it('D1 on: an outsider reads an invoice belonging to another organization', async () => {
    const baseUrl = await start(true);

    const response = await fetch(`${baseUrl}/api/invoices/INV-1001`, asActor(OUTSIDER_TOKEN));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({ id: 'INV-1001', org_id: 'org-1' });
  });

  it('D1 off: the same request is refused without confirming the invoice exists', async () => {
    const baseUrl = await start(false);

    const response = await fetch(`${baseUrl}/api/invoices/INV-1001`, asActor(OUTSIDER_TOKEN));
    expect(response.status).toBe(404);

    const body: unknown = await response.json();
    expect(JSON.stringify(body)).not.toContain('org-1');
    expect(JSON.stringify(body)).not.toContain('total_cents');
  });

  it('D1 off: the owner is unaffected', async () => {
    const baseUrl = await start(false);

    const response = await fetch(`${baseUrl}/api/invoices/INV-1001`, asActor(OWNER_TOKEN));
    expect(response.status).toBe(200);
  });

  it('refuses a request carrying no credentials', async () => {
    const baseUrl = await start(true);

    const response = await fetch(`${baseUrl}/api/invoices/INV-1001`);
    expect(response.status).toBe(401);
  });

  it('refuses a request carrying an unknown token', async () => {
    const baseUrl = await start(true);

    const response = await fetch(`${baseUrl}/api/invoices/INV-1001`, asActor('not-a-real-token'));
    expect(response.status).toBe(401);
  });

  it('reports an unknown invoice as absent', async () => {
    const baseUrl = await start(true);

    const response = await fetch(`${baseUrl}/api/invoices/INV-9999`, asActor(OWNER_TOKEN));
    expect(response.status).toBe(404);
  });
});

/**
 * D2 and D3, held in place the same way D1 is. If one of these starts failing because
 * the defect was repaired, the integration target has nothing for the matching access
 * check to find, and the repair is the regression.
 */
describe('GET /api/invoices', () => {
  it('D2 on: the list returns rows from every organization', async () => {
    const baseUrl = await start(true);

    const response = await fetch(`${baseUrl}/api/invoices`, asActor(OUTSIDER_TOKEN));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({ invoices: expect.any(Array) });
    const orgIds = (body as { invoices: { org_id: string }[] }).invoices.map((row) => row.org_id);
    expect(orgIds).toContain('org-1');
    expect(orgIds).toContain('org-2');
  });

  it('D2 off: the list is scoped to the caller organization', async () => {
    const baseUrl = await start(true, { d2UnscopedInvoiceList: false });

    const response = await fetch(`${baseUrl}/api/invoices`, asActor(OUTSIDER_TOKEN));
    const body = (await response.json()) as { invoices: { org_id: string }[] };

    expect(body.invoices).toHaveLength(1);
    expect(body.invoices[0]?.org_id).toBe('org-2');
  });

  it('refuses a caller with no credentials either way', async () => {
    const baseUrl = await start(true);
    const response = await fetch(`${baseUrl}/api/invoices`);
    expect(response.status).toBe(401);
  });
});

describe('PATCH /api/invoices/:id', () => {
  it('D3 on: an unauthenticated caller can modify an invoice', async () => {
    const baseUrl = await start(true);

    const response = await fetch(`${baseUrl}/api/invoices/INV-1001`, { method: 'PATCH' });
    expect(response.status).toBe(200);
  });

  it('D3 off: an unauthenticated caller is refused', async () => {
    const baseUrl = await start(true, { d3UnauthenticatedMutation: false });

    const response = await fetch(`${baseUrl}/api/invoices/INV-1001`, { method: 'PATCH' });
    expect(response.status).toBe(401);
  });

  it('N2: a cross-organization write is refused whether or not D3 is on', async () => {
    for (const d3 of [true, false]) {
      const baseUrl = await start(true, { d3UnauthenticatedMutation: d3 });

      const response = await fetch(`${baseUrl}/api/invoices/INV-1001`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${OUTSIDER_TOKEN}` },
      });
      expect(response.status).toBe(404);

      await new Promise<void>((resolve, reject) => {
        running?.close((error) => (error ? reject(error) : resolve()));
      });
      running = undefined;
    }
  });

  it('N1: the owner can modify their own invoice', async () => {
    const baseUrl = await start(true);

    const response = await fetch(`${baseUrl}/api/invoices/INV-1001`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
    });
    expect(response.status).toBe(200);
  });
});

describe('GET /health', () => {
  it('answers without credentials so a caller can tell the app booted', async () => {
    const baseUrl = await start(true);

    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});
