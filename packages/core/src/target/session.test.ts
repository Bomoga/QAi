import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { SpecSchema } from '../contracts/index.ts';
import { rulesFor } from '../evidence/redact.ts';
import type { CapturedEvidence, EvidenceWriter } from '../evidence/capture.ts';
import { fixedDeps } from './deps.ts';
import { createHttpClient } from './request.ts';
import { accessChecksArePossible, createActorSession, createActorSessions } from './session.ts';
import type { ResolvedActor } from './credentials.ts';

const SPEC = SpecSchema.parse({
  specVersion: '0.1',
  name: 'Ledger',
  entities: [
    {
      name: 'Invoice',
      fields: [
        { name: 'org_id', type: 'string' },
        { name: 'notes', type: 'string', sensitive: true },
      ],
    },
  ],
  requirements: [],
});

const RULES = rulesFor(SPEC);

const OWNER: ResolvedActor = {
  id: 'owner',
  credential: { kind: 'bearer', token: 'ledger-owner-token' },
  attributes: { org_id: 'org-1' },
};

const OUTSIDER: ResolvedActor = {
  id: 'outsider',
  credential: { kind: 'bearer', token: 'ledger-outsider-token' },
  attributes: { org_id: 'org-2' },
};

let running: Server | undefined;

/** Answers with whatever credential it saw, so a test can prove identities differ. */
async function startCredentialEcho(): Promise<string> {
  const server = createServer((request, response) => {
    const body = JSON.stringify({
      authorization: request.headers.authorization ?? null,
      cookie: request.headers.cookie ?? null,
      apiKey: request.headers['x-api-key'] ?? null,
      notes: 'a sensitive value that must not reach disk',
    });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(body);
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

function recordingWriter(): { writer: EvidenceWriter; written: CapturedEvidence[] } {
  const written: CapturedEvidence[] = [];
  return { writer: { write: (capture) => void written.push(capture) }, written };
}

describe('the four auth kinds reach the target', () => {
  it('sends a bearer token', async () => {
    const baseUrl = await startCredentialEcho();
    const session = createActorSession(OWNER, {
      client: createHttpClient({ baseUrl }),
      rules: RULES,
      deps: fixedDeps(),
    });

    const { outcome } = await session.request({ method: 'GET', path: '/whoami' });

    if (outcome.kind !== 'response') throw new Error('expected a response');
    expect(outcome.response.body).toContain('Bearer ledger-owner-token');
  });

  it('sends a cookie', async () => {
    const baseUrl = await startCredentialEcho();
    const actor: ResolvedActor = {
      id: 'owner',
      credential: { kind: 'cookie', name: 'session', value: 'abc' },
      attributes: {},
    };
    const session = createActorSession(actor, {
      client: createHttpClient({ baseUrl }),
      rules: RULES,
      deps: fixedDeps(),
    });

    const { outcome } = await session.request({ method: 'GET', path: '/whoami' });

    if (outcome.kind !== 'response') throw new Error('expected a response');
    expect(outcome.response.body).toContain('session=abc');
  });

  it('sends a named header', async () => {
    const baseUrl = await startCredentialEcho();
    const actor: ResolvedActor = {
      id: 'owner',
      credential: { kind: 'header', name: 'X-Api-Key', value: 'k' },
      attributes: {},
    };
    const session = createActorSession(actor, {
      client: createHttpClient({ baseUrl }),
      rules: RULES,
      deps: fixedDeps(),
    });

    const { outcome } = await session.request({ method: 'GET', path: '/whoami' });

    if (outcome.kind !== 'response') throw new Error('expected a response');
    expect(outcome.response.body).toContain('"apiKey":"k"');
  });

  it('sends nothing for an actor carrying no credentials', async () => {
    const baseUrl = await startCredentialEcho();
    const actor: ResolvedActor = { id: 'anonymous', credential: { kind: 'none' }, attributes: {} };
    const session = createActorSession(actor, {
      client: createHttpClient({ baseUrl }),
      rules: RULES,
      deps: fixedDeps(),
    });

    const { outcome } = await session.request({ method: 'GET', path: '/whoami' });

    if (outcome.kind !== 'response') throw new Error('expected a response');
    expect(outcome.response.body).toContain('"authorization":null');
  });
});

describe('every request produces evidence', () => {
  it('returns an evidence id alongside the response', async () => {
    const baseUrl = await startCredentialEcho();
    const session = createActorSession(OWNER, {
      client: createHttpClient({ baseUrl }),
      rules: RULES,
      deps: fixedDeps(),
    });

    const { evidenceId } = await session.request({ method: 'GET', path: '/whoami' });
    expect(evidenceId).toBe('EV-000001');
  });

  it('records evidence even when the target could not be reached', async () => {
    const session = createActorSession(OWNER, {
      client: createHttpClient({ baseUrl: 'http://127.0.0.1:1' }),
      rules: RULES,
      deps: fixedDeps(),
    });

    const { outcome, evidence } = await session.request({ method: 'GET', path: '/whoami' });

    expect(outcome.kind).toBe('transport-error');
    expect(evidence.kind).toBe('log');
    expect(evidence.actorId).toBe('owner');
  });

  it('redacts the credential it just sent', async () => {
    const baseUrl = await startCredentialEcho();
    const { writer, written } = recordingWriter();
    const session = createActorSession(OWNER, {
      client: createHttpClient({ baseUrl }),
      rules: RULES,
      deps: fixedDeps(),
      writer,
    });

    await session.request({ method: 'GET', path: '/whoami' });

    const record = JSON.stringify(written[0]);
    expect(record).not.toContain('ledger-owner-token');
    expect(record).not.toContain('a sensitive value that must not reach disk');
  });

  it('gives each request a distinct evidence id', async () => {
    const baseUrl = await startCredentialEcho();
    const session = createActorSession(OWNER, {
      client: createHttpClient({ baseUrl }),
      rules: RULES,
      deps: fixedDeps(),
    });

    const first = await session.request({ method: 'GET', path: '/a' });
    const second = await session.request({ method: 'GET', path: '/b' });

    expect(first.evidenceId).not.toBe(second.evidenceId);
  });
});

describe('two actors', () => {
  it('issue distinguishable requests against the same endpoint', async () => {
    const baseUrl = await startCredentialEcho();
    const options = {
      client: createHttpClient({ baseUrl }),
      rules: RULES,
      deps: fixedDeps(),
    };
    const sessions = createActorSessions([OWNER, OUTSIDER], options);

    const owner = await sessions.get('owner')?.request({ method: 'GET', path: '/api/invoices/1' });
    const outsider = await sessions
      .get('outsider')
      ?.request({ method: 'GET', path: '/api/invoices/1' });

    if (owner?.outcome.kind !== 'response' || outsider?.outcome.kind !== 'response') {
      throw new Error('expected two responses');
    }
    expect(owner.outcome.response.body).toContain('ledger-owner-token');
    expect(outsider.outcome.response.body).toContain('ledger-outsider-token');
    expect(owner.evidenceId).not.toBe(outsider.evidenceId);
  });

  it('carry the attributes conditions compare against', () => {
    const sessions = createActorSessions([OWNER, OUTSIDER], {
      client: createHttpClient({}),
      rules: RULES,
      deps: fixedDeps(),
    });

    expect(sessions.get('owner')?.attributes).toEqual({ org_id: 'org-1' });
    expect(sessions.get('outsider')?.attributes).toEqual({ org_id: 'org-2' });
  });
});

describe('the two actor requirement', () => {
  const options = { client: createHttpClient({}), rules: RULES, deps: fixedDeps() };

  it('is met by two', () => {
    expect(accessChecksArePossible(createActorSessions([OWNER, OUTSIDER], options))).toBe(true);
  });

  it('is not met by one, since there is nothing to compare against', () => {
    expect(accessChecksArePossible(createActorSessions([OWNER], options))).toBe(false);
  });

  it('is not met by none', () => {
    expect(accessChecksArePossible(createActorSessions([], options))).toBe(false);
  });
});
