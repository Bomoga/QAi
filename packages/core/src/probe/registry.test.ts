import { describe, expect, it } from 'vitest';

import { createAdapterRegistry } from './registry.ts';
import { emptyScan, type SourceAdapter, type SourceScan } from './types.ts';

interface AdapterOptions {
  readonly detects?: boolean;
  /** Message a throwing detector uses. Present means detect rejects. */
  readonly detectThrows?: string;
  readonly scan?: SourceScan;
  /** Message a throwing scan uses. Present means scan rejects. */
  readonly scanThrows?: string;
}

function adapter(name: string, options: AdapterOptions = {}): SourceAdapter {
  return {
    name,
    detect: () => {
      if (options.detectThrows !== undefined) throw new Error(options.detectThrows);
      return Promise.resolve(options.detects ?? true);
    },
    scan: () => {
      if (options.scanThrows !== undefined) throw new Error(options.scanThrows);
      return Promise.resolve(options.scan ?? emptyScan());
    },
  };
}

const ENDPOINT = {
  id: 'GET /api/invoices/:id',
  method: 'GET',
  path: '/api/invoices/:id',
  origin: 'source' as const,
  confidence: 'high' as const,
  authRequired: 'unknown' as const,
  fields: [],
  actorVisibility: {},
  evidence: [],
};

const ENTITY = {
  name: 'Invoice',
  origin: 'schema' as const,
  confidence: 'high' as const,
  fields: [],
  evidence: [],
};

describe('detection', () => {
  it('reports the adapters that recognize a root, in registration order', async () => {
    const registry = createAdapterRegistry([
      adapter('next', { detects: true }),
      adapter('express', { detects: false }),
      adapter('prisma', { detects: true }),
    ]);

    const applicable = await registry.detect('/repo');
    expect(applicable.map((entry) => entry.name)).toEqual(['next', 'prisma']);
  });

  it('treats a detector that throws as not recognizing anything', async () => {
    const registry = createAdapterRegistry([
      adapter('broken', { detectThrows: 'no such directory' }),
      adapter('next', { detects: true }),
    ]);

    const applicable = await registry.detect('/repo');
    expect(applicable.map((entry) => entry.name)).toEqual(['next']);
  });

  it('accepts more than one adapter, since a repo can be several things at once', async () => {
    const registry = createAdapterRegistry([
      adapter('next', { detects: true }),
      adapter('prisma', { detects: true }),
    ]);

    expect(await registry.detect('/repo')).toHaveLength(2);
  });
});

describe('scanning', () => {
  it('concatenates what every applicable adapter found', async () => {
    const registry = createAdapterRegistry([
      adapter('next', { scan: { endpoints: [ENDPOINT], entities: [], notes: [] } }),
      adapter('prisma', { scan: { endpoints: [], entities: [ENTITY], notes: [] } }),
    ]);

    const { scan, applied } = await registry.scan('/repo');

    expect(scan.endpoints).toHaveLength(1);
    expect(scan.entities).toHaveLength(1);
    expect(applied).toEqual(['next', 'prisma']);
  });

  it('reports an adapter that failed without losing the ones that worked', async () => {
    const registry = createAdapterRegistry([
      adapter('broken', { scanThrows: 'unreadable route file' }),
      adapter('prisma', { scan: { endpoints: [], entities: [ENTITY], notes: [] } }),
    ]);

    const { scan, applied } = await registry.scan('/repo');

    expect(scan.entities).toHaveLength(1);
    expect(applied).toEqual(['prisma']);

    const failure = scan.notes.find((note) => note.level === 'error');
    expect(failure?.message).toContain('broken');
    expect(failure?.message).toContain('unreadable route file');
  });

  it('says plainly when nothing recognized the source root', async () => {
    const registry = createAdapterRegistry([adapter('next', { detects: false })]);
    const { scan, applied } = await registry.scan('/repo');

    expect(applied).toEqual([]);
    expect(scan.endpoints).toEqual([]);
    expect(scan.notes[0]?.level).toBe('warn');
    expect(scan.notes[0]?.message).toContain('black box crawl');
  });

  it('carries adapter notes through, so a partial read is visible', async () => {
    const registry = createAdapterRegistry([
      adapter('next', {
        scan: {
          endpoints: [],
          entities: [],
          notes: [{ level: 'warn', message: '2 route files could not be parsed', refs: [] }],
        },
      }),
    ]);

    const { scan } = await registry.scan('/repo');
    expect(scan.notes[0]?.message).toContain('2 route files');
  });
});

describe('registration', () => {
  it('accepts an adapter added after construction', async () => {
    const registry = createAdapterRegistry();
    expect(registry.all()).toEqual([]);

    registry.register(adapter('next'));
    expect(registry.all().map((entry) => entry.name)).toEqual(['next']);
    expect(await registry.detect('/repo')).toHaveLength(1);
  });

  it('does not expose its internal list for mutation', () => {
    const registry = createAdapterRegistry([adapter('next')]);
    const all = registry.all() as SourceAdapter[];
    all.push(adapter('sneaky'));

    expect(registry.all()).toHaveLength(1);
  });
});
