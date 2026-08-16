import { describe, expect, it } from 'vitest';

import type { ObservedEndpoint, ObservedEntity } from '../contracts/index.ts';
import { ObservationSchema } from '../contracts/index.ts';
import { buildObservation, mergeScans, OBSERVATION_VERSION, probeModeFor } from './merge.ts';
import type { SourceScan } from './types.ts';

function endpoint(overrides: Partial<ObservedEndpoint> = {}): ObservedEndpoint {
  const path = overrides.path ?? '/api/invoices';
  const method = overrides.method ?? 'GET';

  return {
    id: `${method} ${path}`,
    method,
    path,
    origin: 'source',
    confidence: 'high',
    authRequired: 'unknown',
    actorVisibility: {},
    evidence: [],
    ...overrides,
  };
}

function sourceScan(endpoints: ObservedEndpoint[], entities: ObservedEntity[] = []): SourceScan {
  return { endpoints, entities, notes: [] };
}

function blackboxScan(paths: string[]): SourceScan {
  return {
    endpoints: paths.map((path, index) =>
      endpoint({ path, origin: 'blackbox', confidence: 'low', evidence: [`EV-${index + 1}`] }),
    ),
    entities: [],
    notes: [],
  };
}

describe('mode', () => {
  it.each([
    [{ source: sourceScan([]), blackbox: sourceScan([]) }, 'hybrid'],
    [{ source: sourceScan([]) }, 'source'],
    [{ blackbox: sourceScan([]) }, 'blackbox'],
    [{}, 'blackbox'],
  ])('reads %o as %s', (input, expected) => {
    expect(probeModeFor(input)).toBe(expected);
  });
});

describe('one side only', () => {
  it('trusts a source reading, which read the declaration rather than deducing it', () => {
    const merged = mergeScans({ source: sourceScan([endpoint()]) });

    expect(merged.endpoints[0]).toMatchObject({ origin: 'source', confidence: 'high' });
    expect(merged.notes).toEqual([]);
  });

  it('is least certain about a black box reading, which can miss an unlinked route', () => {
    const merged = mergeScans({ blackbox: blackboxScan(['/api/invoices']) });

    expect(merged.endpoints[0]).toMatchObject({ origin: 'blackbox', confidence: 'low' });
    expect(merged.notes).toEqual([]);
  });
});

describe('both sides', () => {
  it('is most certain when the two agree', () => {
    const merged = mergeScans({
      source: sourceScan([endpoint({ handlerRef: 'src/server.ts:5' })]),
      blackbox: blackboxScan(['/api/invoices']),
    });

    expect(merged.endpoints).toHaveLength(1);
    expect(merged.endpoints[0]).toMatchObject({
      origin: 'source',
      confidence: 'high',
      handlerRef: 'src/server.ts:5',
    });
  });

  it('keeps the evidence the crawl recorded for an endpoint the source declared', () => {
    const merged = mergeScans({
      source: sourceScan([endpoint()]),
      blackbox: blackboxScan(['/api/invoices']),
    });

    expect(merged.endpoints[0]?.evidence).toEqual(['EV-1']);
  });

  it('matches a source parameter against the crawl path it was derived from', () => {
    const merged = mergeScans({
      source: sourceScan([endpoint({ path: '/api/invoices/:invoiceId' })]),
      blackbox: blackboxScan(['/api/invoices/INV-1001']),
    });

    expect(merged.endpoints).toHaveLength(1);
    expect(merged.endpoints[0]?.path).toBe('/api/invoices/:invoiceId');
  });

  it('records a declared route the crawl did not reach, and says so', () => {
    const merged = mergeScans({
      source: sourceScan([endpoint({ path: '/api/reports' })]),
      blackbox: blackboxScan(['/api/invoices']),
    });

    const reports = merged.endpoints.find((entry) => entry.path === '/api/reports');

    expect(reports).toMatchObject({ origin: 'source', confidence: 'medium' });
    expect(merged.notes.map((note) => note.message)).toContain(
      'GET /api/reports is declared in source, and the crawl did not reach it. It may be unlinked, or outside the crawl budget.',
    );
  });

  it('records a served route nothing declares, and says so with its evidence', () => {
    const merged = mergeScans({
      source: sourceScan([endpoint()]),
      blackbox: blackboxScan(['/api/debug/reset']),
    });

    const debug = merged.endpoints.find((entry) => entry.path === '/api/debug/reset');

    expect(debug).toMatchObject({ origin: 'blackbox', confidence: 'medium' });

    const note = merged.notes.find((entry) => entry.message.includes('/api/debug/reset'));
    expect(note?.level).toBe('warn');
    expect(note?.refs).toEqual(['EV-1']);
  });

  it('drops nothing either side saw', () => {
    const merged = mergeScans({
      source: sourceScan([endpoint(), endpoint({ path: '/api/reports' })]),
      blackbox: blackboxScan(['/api/invoices', '/api/debug/reset']),
    });

    expect(merged.endpoints.map((entry) => entry.id).sort()).toEqual([
      'GET /api/debug/reset',
      'GET /api/invoices',
      'GET /api/reports',
    ]);
  });

  it('keeps the notes both sides produced', () => {
    const merged = mergeScans({
      source: { endpoints: [], entities: [], notes: [{ level: 'warn', message: 'a', refs: [] }] },
      blackbox: { endpoints: [], entities: [], notes: [{ level: 'info', message: 'b', refs: [] }] },
    });

    expect(merged.notes.map((note) => note.message)).toEqual(['a', 'b']);
  });
});

describe('entities', () => {
  const invoice: ObservedEntity = {
    name: 'Invoice',
    origin: 'schema',
    confidence: 'high',
    fields: [{ name: 'org_id', origin: 'schema' }],
    evidence: [],
  };

  it('treats one model reported twice as one entity', () => {
    const merged = mergeScans({
      source: sourceScan([], [invoice]),
      blackbox: { endpoints: [], entities: [{ ...invoice, name: 'invoice' }], notes: [] },
    });

    expect(merged.entities).toHaveLength(1);
    expect(merged.entities[0]?.name).toBe('Invoice');
  });

  it('unions the fields two readings each saw part of', () => {
    const merged = mergeScans({
      source: sourceScan([], [invoice]),
      blackbox: {
        endpoints: [],
        entities: [{ ...invoice, fields: [{ name: 'notes', origin: 'inferred' }] }],
        notes: [],
      },
    });

    expect(merged.entities[0]?.fields.map((field) => field.name)).toEqual(['org_id', 'notes']);
  });
});

describe('assembling an Observation', () => {
  it('satisfies the contract', () => {
    const merged = mergeScans({
      source: sourceScan([endpoint()]),
      blackbox: blackboxScan(['/api/invoices']),
    });

    const observation = buildObservation(
      merged,
      { baseUrl: 'http://localhost:3000', sourceRoot: './' },
      '2026-01-01T00:00:00.000Z',
    );

    expect(ObservationSchema.safeParse(observation).success).toBe(true);
    expect(observation).toMatchObject({
      observationVersion: OBSERVATION_VERSION,
      mode: 'hybrid',
      target: { baseUrl: 'http://localhost:3000', sourceRoot: './' },
    });
  });

  it('omits a target field it was never given, rather than inventing one', () => {
    const observation = buildObservation(mergeScans({}), {}, '2026-01-01T00:00:00.000Z');

    expect(observation.target).toEqual({});
    expect(ObservationSchema.safeParse(observation).success).toBe(true);
  });

  it('takes its timestamp from the caller, so a run is reproducible', () => {
    const observation = buildObservation(mergeScans({}), {}, '2026-01-01T00:00:00.000Z');
    expect(observation.observedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
