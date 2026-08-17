import type { Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { createLedgerServer } from '../src/app.ts';
import { seedLedger } from '../src/data.ts';

/**
 * Defect D5: a debug endpoint no requirement asks for. These tests hold it in place the
 * same way the D1 tests hold the cross organization read. If the route quietly
 * disappears, the structural diff has nothing to find and the repair is the regression.
 *
 * The route index at `/` is deliberately not a defect and is asserted either way. It is
 * what makes the debug route reachable by a crawl at all, and a fixture whose defect is
 * unreachable would test the diff against an Observation that could never contain it.
 */

let running: Server | undefined;

async function start(d5UndeclaredDebugEndpoint: boolean): Promise<string> {
  const server = createLedgerServer({
    data: seedLedger(),
    defects: {
      d1CrossOrgInvoiceRead: true,
      d2UnscopedInvoiceList: true,
      d3UnauthenticatedMutation: true,
      d5UndeclaredDebugEndpoint,
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

describe('D5, the undeclared debug endpoint', () => {
  it('answers without any credential while the defect is on', async () => {
    const base = await start(true);

    const response = await fetch(`${base}/api/debug/state`);
    expect(response.status).toBe(200);

    const body: unknown = await response.json();
    expect(body).toMatchObject({ invoices: expect.any(Number) as number });
  });

  it('is gone when the defect is off', async () => {
    const base = await start(false);

    const response = await fetch(`${base}/api/debug/state`);
    expect(response.status).toBe(404);
  });
});

describe('the route index', () => {
  it('names the debug route while the defect is on, so a crawl can reach it', async () => {
    const base = await start(true);

    const response = await fetch(base);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { routes: string[] };
    expect(body.routes).toContain('/api/debug/state');
    expect(body.routes).toContain('/api/invoices');
  });

  it('stops naming it when the defect is off', async () => {
    const base = await start(false);

    const body = (await (await fetch(base)).json()) as { routes: string[] };
    expect(body.routes).not.toContain('/api/debug/state');
    expect(body.routes).toContain('/api/invoices');
  });
});
