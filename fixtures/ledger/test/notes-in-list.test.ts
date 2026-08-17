import type { Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { createLedgerServer } from '../src/app.ts';
import { OWNER_TOKEN, seedLedger } from '../src/data.ts';

/**
 * Defect D4: a sensitive field returned where it should be omitted. REQ-004 says invoice
 * notes are omitted from list responses, and the list hands them back. These tests hold
 * the defect in place the same way the D1 and D5 tests hold theirs: if the field quietly
 * stops being returned, a behavioral check has nothing to find and the repair is the
 * regression.
 *
 * The single invoice read is asserted with the defect off, because the switch is scoped
 * to the list. A switch that also stripped the field from a read would change what D1
 * leaks and make two defects share one toggle.
 */

let running: Server | undefined;

async function start(d4NotesInInvoiceList: boolean): Promise<string> {
  const server = createLedgerServer({
    data: seedLedger(),
    defects: {
      d1CrossOrgInvoiceRead: true,
      d2UnscopedInvoiceList: true,
      d3UnauthenticatedMutation: true,
      d4NotesInInvoiceList,
      d5UndeclaredDebugEndpoint: true,
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

function asOwner(): RequestInit {
  return { headers: { authorization: `Bearer ${OWNER_TOKEN}` } };
}

async function listRows(baseUrl: string): Promise<Record<string, unknown>[]> {
  const response = await fetch(`${baseUrl}/api/invoices`, asOwner());
  expect(response.status).toBe(200);

  const body = (await response.json()) as { invoices: Record<string, unknown>[] };
  expect(body.invoices.length).toBeGreaterThan(0);
  return body.invoices;
}

describe('D4, notes returned in the invoice list', () => {
  it('returns the notes field on every row while the defect is on', async () => {
    const baseUrl = await start(true);

    for (const row of await listRows(baseUrl)) {
      expect(row['notes']).toEqual(expect.any(String));
    }
  });

  it('omits the notes field from every row when the defect is off', async () => {
    const baseUrl = await start(false);

    for (const row of await listRows(baseUrl)) {
      expect(Object.keys(row)).not.toContain('notes');
    }
  });

  it('keeps the rest of the row either way, so the list is still readable', async () => {
    for (const d4 of [true, false]) {
      const baseUrl = await start(d4);

      for (const row of await listRows(baseUrl)) {
        expect(row['id']).toEqual(expect.any(String));
        expect(row['org_id']).toEqual(expect.any(String));
        expect(row['total_cents']).toEqual(expect.any(Number));
      }

      await new Promise<void>((resolve, reject) => {
        running?.close((error) => (error ? reject(error) : resolve()));
      });
      running = undefined;
    }
  });

  it('leaves a single invoice read carrying notes when the defect is off', async () => {
    const baseUrl = await start(false);

    const response = await fetch(`${baseUrl}/api/invoices/INV-1001`, asOwner());
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body['notes']).toEqual(expect.any(String));
  });
});
