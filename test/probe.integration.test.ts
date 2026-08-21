import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createLedgerServer } from '../fixtures/ledger/src/app.ts';
import { OWNER_TOKEN, seedLedger } from '../fixtures/ledger/src/data.ts';
import type { DefectSwitches } from '../fixtures/ledger/src/defects.ts';
import {
  createActorSessions,
  createHttpClient,
  diffSpecObservation,
  fixedDeps,
  isConfigFailure,
  isLoadFailure,
  loadConfig,
  loadSpec,
  probe,
  rulesFor,
  SPECIFIED_NOT_OBSERVED_SEVERITY,
  type HttpClient,
  type Observation,
  type RequestSpec,
  type ResolvedActor,
  type Spec,
} from '../packages/core/src/index.ts';

/**
 * The M4 Definition of Done, run against the real fixture over a real socket.
 *
 * `fixtures/ledger` is probed black box and that was a decision, not an accident. M4's
 * adapters target Next.js, Express, and Prisma; the ledger is a hand-written `node:http`
 * server chosen at S0 so the fixture needed no runtime dependencies. So every endpoint
 * here carries `origin: "blackbox"` with reduced confidence, which is the honest reading
 * of the Definition of Done line about correct origin.
 *
 * Two defects are under test. D5 is a debug endpoint no requirement asks for, which has
 * to appear in `observedNotSpecified`. D6 is an entity the spec declares and the
 * application never implements, which has to appear in `specifiedNotObserved`. Both are
 * asserted in both directions, so neither can pass by the diff simply always saying yes.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DEFECTS_ON: DefectSwitches = {
  d1CrossOrgInvoiceRead: true,
  d2UnscopedInvoiceList: true,
  d3UnauthenticatedMutation: true,
  d4NotesInInvoiceList: true,
  d5UndeclaredDebugEndpoint: true,
};

const DEFECTS_OFF: DefectSwitches = {
  d1CrossOrgInvoiceRead: false,
  d2UnscopedInvoiceList: false,
  d3UnauthenticatedMutation: false,
  d4NotesInInvoiceList: false,
  d5UndeclaredDebugEndpoint: false,
};

const OWNER: ResolvedActor = {
  id: 'owner',
  credential: { kind: 'bearer', token: OWNER_TOKEN },
  attributes: { org_id: 'org-1' },
};

let spec: Spec;

beforeAll(() => {
  const loaded = loadSpec(['fixtures/ledger/spec/ledger.spec.yaml'], { cwd: ROOT });
  if (isLoadFailure(loaded)) throw new Error(loaded.error.message);
  spec = loaded.spec;
});

const running: Server[] = [];

async function startLedger(defects: DefectSwitches): Promise<string> {
  const server = createLedgerServer({ data: seedLedger(), defects });

  await new Promise<void>((done) => {
    server.listen(0, '127.0.0.1', () => {
      done();
    });
  });
  running.push(server);

  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port bound');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  const servers = running.splice(0, running.length);
  for (const server of servers) {
    await new Promise<void>((done, fail) => {
      server.close((error) => (error ? fail(error) : done()));
    });
  }
});

/** Wraps the real client so the test can see every request the probe issued. */
function recordingClient(baseUrl: string, sent: RequestSpec[]): HttpClient {
  const inner = createHttpClient({ baseUrl });
  return {
    send(request, credential) {
      sent.push(request);
      return inner.send(request, credential);
    },
  };
}

async function probeLedger(
  defects: DefectSwitches,
): Promise<{ observation: Observation; sent: RequestSpec[] }> {
  const baseUrl = await startLedger(defects);
  const sent: RequestSpec[] = [];

  const sessions = createActorSessions([OWNER], {
    client: recordingClient(baseUrl, sent),
    rules: rulesFor(spec),
    deps: fixedDeps(),
  });

  const observation = await probe(
    { config: { target: { baseUrl } }, sessions },
    { deps: fixedDeps(), baseUrl },
  );

  return { observation, sent };
}

describe('probing the ledger', () => {
  it('records every endpoint the crawl reached, as a black box reading', async () => {
    const { observation } = await probeLedger(DEFECTS_ON);

    expect(observation.mode).toBe('blackbox');
    expect(observation.endpoints.map((endpoint) => endpoint.id)).toEqual([
      'GET /',
      'GET /api/debug/state',
      'GET /api/invoices',
      'GET /health',
    ]);

    for (const endpoint of observation.endpoints) {
      expect(endpoint.origin).toBe('blackbox');
      expect(endpoint.confidence).toBe('low');
    }
  });

  it('never claims to know whether an endpoint requires authentication', async () => {
    const { observation } = await probeLedger(DEFECTS_ON);

    for (const endpoint of observation.endpoints) {
      expect(endpoint.authRequired).toBe('unknown');
    }
  });

  it('carries evidence for every endpoint it recorded', async () => {
    const { observation } = await probeLedger(DEFECTS_ON);

    for (const endpoint of observation.endpoints) {
      expect(endpoint.evidence).toHaveLength(1);
    }
  });

  it('reads the invoice fields through the list envelope', async () => {
    const { observation } = await probeLedger(DEFECTS_ON);
    const list = observation.endpoints.find((endpoint) => endpoint.path === '/api/invoices');

    // The ledger returns rows under an `invoices` key rather than as a bare array,
    // deliberately, since D2 exists to catch anything that only understands top level
    // arrays. Recording `invoices` as the response shape produced a field mismatch
    // claiming every declared field was missing.
    expect(list?.responseShape?.fields).toEqual(['id', 'notes', 'org_id', 'total_cents']);
  });

  it('reports no field mismatch for the entity the ledger serves correctly', async () => {
    const { observation } = await probeLedger(DEFECTS_ON);
    const findings = diffSpecObservation(spec, observation);

    expect(findings.fieldMismatches).toEqual([]);
  });

  it('issues nothing but GET and HEAD', async () => {
    const { sent } = await probeLedger(DEFECTS_ON);

    expect(sent.length).toBeGreaterThan(0);
    for (const request of sent) {
      expect(['GET', 'HEAD']).toContain(request.method);
    }
  });

  it('records no path that answered 404', async () => {
    const { observation, sent } = await probeLedger(DEFECTS_ON);

    // The index names the parameterized route, which answers 404 as written. The
    // braces arrive percent-encoded, since the crawler resolves every candidate
    // through URL rather than pasting strings together.
    expect(sent.map((request) => request.path)).toContain('/api/invoices/%7Bid%7D');
    expect(observation.endpoints.map((endpoint) => endpoint.path)).not.toContain(
      '/api/invoices/%7Bid%7D',
    );
  });
});

describe('D5, the undeclared debug endpoint', () => {
  it('appears in observedNotSpecified at medium severity', async () => {
    const { observation } = await probeLedger(DEFECTS_ON);
    const findings = diffSpecObservation(spec, observation);

    expect(findings.observedNotSpecified).toContainEqual({
      kind: 'endpoint',
      id: 'GET /api/debug/state',
      severity: 'medium',
    });
  });

  it('is not reported when the ledger no longer serves it', async () => {
    const { observation } = await probeLedger(DEFECTS_OFF);
    const findings = diffSpecObservation(spec, observation);

    expect(observation.endpoints.map((endpoint) => endpoint.id)).not.toContain(
      'GET /api/debug/state',
    );
    expect(findings.observedNotSpecified.map((entry) => entry.id)).not.toContain(
      'GET /api/debug/state',
    );
  });

  // The corpus fix that reads configured routes exists so an endpoint whose path does
  // not resemble its entity's name stops being called undeclared. The endpoint nobody
  // specified is a configured route for nothing, so it has to survive the fix, and this
  // is asserted against the repository's own config rather than a literal, since a
  // hand-built resource list would only prove the rule agrees with something the test
  // invented.
  it('still fires when the caller passes the configured routes, as check does', async () => {
    const config = loadConfig('qai.config.yaml', ROOT);
    if (isConfigFailure(config)) throw new Error(config.error.message);

    const { observation } = await probeLedger(DEFECTS_ON);
    const findings = diffSpecObservation(spec, observation, config.config.resources);

    expect(findings.observedNotSpecified).toContainEqual({
      kind: 'endpoint',
      id: 'GET /api/debug/state',
      severity: 'medium',
    });

    // And the endpoint the config does map is still accounted for, which it was before
    // the fix as well, by its path naming the entity.
    expect(findings.observedNotSpecified.map((entry) => entry.id)).not.toContain(
      'GET /api/invoices',
    );
  });

  it('does not drag the root and the health route up with it', async () => {
    const { observation } = await probeLedger(DEFECTS_ON);
    const findings = diffSpecObservation(spec, observation);

    const noise = findings.observedNotSpecified.filter((entry) =>
      ['GET /', 'GET /health'].includes(entry.id),
    );

    expect(noise.map((entry) => entry.severity)).toEqual(['info', 'info']);
  });
});

describe('D6, the entity that was never built', () => {
  it('appears in specifiedNotObserved, at the severity the module assigns', async () => {
    const { observation } = await probeLedger(DEFECTS_ON);
    const findings = diffSpecObservation(spec, observation);

    expect(findings.specifiedNotObserved.map((entry) => entry.name)).toContain('AuditLog');
    expect(SPECIFIED_NOT_OBSERVED_SEVERITY).toBe('low');
  });

  it('names the requirement that asked for it', async () => {
    const { observation } = await probeLedger(DEFECTS_ON);
    const findings = diffSpecObservation(spec, observation);

    const audit = findings.specifiedNotObserved.find((entry) => entry.name === 'AuditLog');
    expect(audit?.kind).toBe('entity');
    expect(audit?.requirementIds.length).toBeGreaterThan(0);
  });

  it('leaves the entity the application does serve alone', async () => {
    const { observation } = await probeLedger(DEFECTS_ON);
    const findings = diffSpecObservation(spec, observation);

    expect(findings.specifiedNotObserved.map((entry) => entry.name)).not.toContain('Invoice');
  });
});

describe('what a black box probe cannot answer', () => {
  it('reports the entities it could not confirm, which is the cost of having no schema adapter', async () => {
    const { observation } = await probeLedger(DEFECTS_ON);
    const findings = diffSpecObservation(spec, observation);

    // Organization and User are real in the fixture and serve no route of their own,
    // so a crawl cannot see them. A Prisma adapter would; M4.4 is deferred. Asserted
    // rather than hidden, because this is the honest state of the tool today.
    expect(findings.specifiedNotObserved.map((entry) => entry.name).sort()).toEqual([
      'AuditLog',
      'Organization',
      'User',
    ]);
  });
});
