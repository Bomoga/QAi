import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { fixedDeps, systemDeps } from './deps.ts';
import { applyCredential, isTransportError, resolveUrl, createHttpClient } from './request.ts';

/**
 * The round trip tests run against a server started inside the test on an ephemeral
 * loopback port. Core does not depend on `fixtures/ledger`, and rule R9 rules out
 * anything remote, so the smallest honest way to prove undici is wired correctly is
 * to answer the request here.
 */
let running: Server | undefined;

async function startEcho(
  handler: (
    path: string,
    headers: Record<string, string | string[] | undefined>,
  ) => {
    status: number;
    body: string;
  },
): Promise<string> {
  const server = createServer((request, response) => {
    const result = handler(request.url ?? '/', request.headers);
    response.writeHead(result.status, { 'content-type': 'application/json' });
    response.end(result.body);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  running = server;

  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port bound');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  const server = running;
  running = undefined;
  if (server === undefined) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('applying a credential', () => {
  it('sets an authorization header for bearer', () => {
    expect(applyCredential({}, { kind: 'bearer', token: 't' })).toEqual({
      authorization: 'Bearer t',
    });
  });

  it('sets a named header for header auth, lowercased', () => {
    expect(applyCredential({}, { kind: 'header', name: 'X-Api-Key', value: 'k' })).toEqual({
      'x-api-key': 'k',
    });
  });

  it('sets a cookie pair for cookie auth', () => {
    expect(applyCredential({}, { kind: 'cookie', name: 'session', value: 'abc' })).toEqual({
      cookie: 'session=abc',
    });
  });

  it('appends to an existing cookie rather than replacing it', () => {
    const headers = applyCredential(
      { cookie: 'theme=dark' },
      {
        kind: 'cookie',
        name: 'session',
        value: 'abc',
      },
    );
    expect(headers['cookie']).toBe('theme=dark; session=abc');
  });

  it('adds nothing for an actor carrying no credentials', () => {
    expect(applyCredential({ accept: 'application/json' }, { kind: 'none' })).toEqual({
      accept: 'application/json',
    });
  });

  it('does not mutate the headers it was given', () => {
    const original = { accept: 'application/json' };
    applyCredential(original, { kind: 'bearer', token: 't' });
    expect(original).toEqual({ accept: 'application/json' });
  });
});

describe('resolving a URL', () => {
  it('joins a path onto the base URL', () => {
    expect(resolveUrl('/api/invoices/1', 'http://localhost:3000')).toBe(
      'http://localhost:3000/api/invoices/1',
    );
  });

  it('passes an absolute URL through', () => {
    expect(resolveUrl('http://elsewhere.test/x', 'http://localhost:3000')).toBe(
      'http://elsewhere.test/x',
    );
  });

  it('refuses a path with no base URL rather than guessing one', () => {
    expect(() => resolveUrl('/api/invoices/1')).toThrow('baseUrl');
  });
});

describe('transport failures are values, not exceptions', () => {
  it('reports an unresolvable path as a transport error', async () => {
    const client = createHttpClient({});
    const outcome = await client.send({ method: 'GET', path: '/api/x' }, { kind: 'none' });

    expect(isTransportError(outcome)).toBe(true);
    if (isTransportError(outcome)) {
      expect(outcome.message).toContain('baseUrl');
    }
  });

  it('reports a refused connection as a transport error, not a throw', async () => {
    // Port 1 on loopback refuses immediately. Local only, per rule R9.
    const client = createHttpClient({ baseUrl: 'http://127.0.0.1:1' });
    const outcome = await client.send({ method: 'GET', path: '/' }, { kind: 'none' });

    expect(isTransportError(outcome)).toBe(true);
  });

  it('records a duration even when the request failed', async () => {
    const client = createHttpClient({ baseUrl: 'http://127.0.0.1:1' });
    const outcome = await client.send({ method: 'GET', path: '/' }, { kind: 'none' });

    if (isTransportError(outcome)) {
      expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('a real round trip', () => {
  it('returns the status, headers, and body of a response', async () => {
    const baseUrl = await startEcho(() => ({ status: 201, body: '{"ok":true}' }));
    const client = createHttpClient({ baseUrl });

    const outcome = await client.send({ method: 'GET', path: '/thing' }, { kind: 'none' });

    expect(outcome.kind).toBe('response');
    if (outcome.kind !== 'response') return;
    expect(outcome.response.status).toBe(201);
    expect(outcome.response.body).toBe('{"ok":true}');
    expect(outcome.response.headers['content-type']).toContain('application/json');
    expect(outcome.response.truncated).toBe(false);
  });

  it('sends the credential the actor carries', async () => {
    const baseUrl = await startEcho((_path, headers) => ({
      status: 200,
      body: JSON.stringify({ authorization: headers['authorization'] ?? null }),
    }));
    const client = createHttpClient({ baseUrl });

    const outcome = await client.send(
      { method: 'GET', path: '/whoami' },
      { kind: 'bearer', token: 'ledger-owner-token' },
    );

    if (outcome.kind !== 'response') throw new Error('expected a response');
    expect(outcome.response.body).toContain('Bearer ledger-owner-token');
  });

  it('distinguishes two actors on the same endpoint', async () => {
    const baseUrl = await startEcho((_path, headers) => ({
      status: 200,
      body: JSON.stringify({ seen: headers['authorization'] ?? null }),
    }));
    const client = createHttpClient({ baseUrl });

    const owner = await client.send({ method: 'GET', path: '/x' }, { kind: 'bearer', token: 'a' });
    const outsider = await client.send(
      { method: 'GET', path: '/x' },
      { kind: 'bearer', token: 'b' },
    );

    if (owner.kind !== 'response' || outsider.kind !== 'response') {
      throw new Error('expected two responses');
    }
    expect(owner.response.body).not.toBe(outsider.response.body);
  });

  it('truncates a body past the limit and says so', async () => {
    const big = 'x'.repeat(2000);
    const baseUrl = await startEcho(() => ({ status: 200, body: big }));
    const client = createHttpClient({ baseUrl, bodyLimitBytes: 100 });

    const outcome = await client.send({ method: 'GET', path: '/big' }, { kind: 'none' });

    if (outcome.kind !== 'response') throw new Error('expected a response');
    expect(outcome.response.truncated).toBe(true);
    expect(outcome.response.body).toHaveLength(100);
  });

  it('does not retry, so a caller sees exactly one attempt', async () => {
    let attempts = 0;
    const baseUrl = await startEcho(() => {
      attempts += 1;
      return { status: 500, body: '{"error":"boom"}' };
    });
    const client = createHttpClient({ baseUrl });

    const outcome = await client.send({ method: 'GET', path: '/flaky' }, { kind: 'none' });

    expect(attempts).toBe(1);
    if (outcome.kind !== 'response') throw new Error('expected a response');
    expect(outcome.response.status).toBe(500);
  });
});

describe('injected deps', () => {
  it('gives a fixed clock the same instant every time', () => {
    const deps = fixedDeps('2026-01-01T00:00:00.000Z');
    expect(deps.now()).toBe('2026-01-01T00:00:00.000Z');
    expect(deps.now()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('gives a fixed id source a stable sequence', () => {
    const deps = fixedDeps();
    expect([deps.nextId(), deps.nextId(), deps.nextId()]).toEqual(['000001', '000002', '000003']);
  });

  it('restarts the sequence identically for a new instance', () => {
    expect(fixedDeps().nextId()).toBe(fixedDeps().nextId());
  });

  it('gives the system clock an instant with an offset', () => {
    expect(systemDeps().now()).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/u);
  });

  it('gives the system id source distinct values', () => {
    const deps = systemDeps();
    expect(deps.nextId()).not.toBe(deps.nextId());
  });
});
