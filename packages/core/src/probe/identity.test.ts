import { describe, expect, it } from 'vitest';

import type { ObservedEndpoint } from '../contracts/index.ts';
import { ObservedEndpointSchema } from '../contracts/index.ts';
import {
  endpointId,
  identityKey,
  looksLikeIdentifier,
  normalizeEndpoint,
  normalizeEndpoints,
  normalizePath,
} from './identity.ts';

function endpoint(overrides: Partial<ObservedEndpoint> = {}): ObservedEndpoint {
  return {
    id: 'GET /api/invoices/42',
    method: 'GET',
    path: '/api/invoices/42',
    origin: 'blackbox',
    confidence: 'low',
    authRequired: 'unknown',
    actorVisibility: {},
    evidence: [],
    ...overrides,
  };
}

describe('identifier recognition', () => {
  it.each([
    ['42'],
    ['1001'],
    ['INV-1001'],
    ['user_42'],
    ['3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
    ['507f1f77bcf86cd799439011'],
    ['cjld2cjxh0000qzrmn831i7rn'],
  ])('reads %s as one record', (segment) => {
    expect(looksLikeIdentifier(segment)).toBe(true);
  });

  it.each([
    ['invoices'],
    ['summary'],
    ['v1'],
    ['V2'],
    ['oauth2'],
    ['how-to-file-an-invoice'],
    [':id'],
    [''],
  ])('reads %s as part of the route', (segment) => {
    expect(looksLikeIdentifier(segment)).toBe(false);
  });
});

describe('path normalization', () => {
  it.each([
    ['/api/invoices/42', '/api/invoices/:id'],
    ['/api/invoices/INV-1001', '/api/invoices/:id'],
    ['/api/invoices/3f2504e0-4f89-11d3-9a0c-0305e82c3301', '/api/invoices/:id'],
    ['/api/invoices/42/lines/7', '/api/invoices/:id/lines/:id'],
  ])('turns %s into %s', (path, expected) => {
    expect(normalizePath(path)).toBe(expected);
  });

  it.each([
    ['/api/v1/invoices'],
    ['/api/invoices/summary'],
    ['/api/invoices/:id'],
    ['/files/:path*'],
    ['/'],
  ])('leaves %s alone', (path) => {
    expect(normalizePath(path)).toBe(path);
  });

  it.each([
    ['/api//invoices', '/api/invoices'],
    ['/api/invoices/', '/api/invoices'],
    ['/api/invoices?page=2', '/api/invoices'],
    ['/api/invoices#top', '/api/invoices'],
    ['', '/'],
  ])('tidies %s into %s', (path, expected) => {
    expect(normalizePath(path)).toBe(expected);
  });

  it('is a fixed point, so normalizing twice changes nothing', () => {
    for (const path of ['/api/invoices/42', '/api/v1/invoices/INV-1', '/files/:path*', '/']) {
      expect(normalizePath(normalizePath(path))).toBe(normalizePath(path));
    }
  });

  it('gives the same answer every time it is asked', () => {
    const answers = new Set(
      Array.from({ length: 20 }, () => normalizePath('/api/invoices/INV-1001')),
    );
    expect([...answers]).toEqual(['/api/invoices/:id']);
  });
});

describe('endpoint identity', () => {
  it('collapses two records of one route into one endpoint', () => {
    expect(endpointId('GET', '/api/invoices/42')).toBe(endpointId('GET', '/api/invoices/43'));
  });

  it('keeps a route segment apart from a record', () => {
    expect(endpointId('GET', '/api/invoices/summary')).not.toBe(
      endpointId('GET', '/api/invoices/42'),
    );
  });

  it('keeps two methods on one path apart', () => {
    expect(endpointId('GET', '/api/invoices')).not.toBe(endpointId('DELETE', '/api/invoices'));
  });

  it('keeps two different routes apart', () => {
    expect(endpointId('GET', '/api/users/42')).not.toBe(endpointId('GET', '/api/invoices/42'));
  });

  it('reads a method however it was cased', () => {
    expect(endpointId('get', '/api/invoices')).toBe('GET /api/invoices');
  });
});

describe('identity key', () => {
  it('recognizes one route named twice', () => {
    expect(identityKey('GET', '/api/invoices/:invoiceId')).toBe(
      identityKey('GET', '/api/invoices/:id'),
    );
  });

  it('matches a source parameter against a normalized crawl path', () => {
    expect(identityKey('GET', '/api/invoices/:invoiceId')).toBe(
      identityKey('GET', '/api/invoices/1001'),
    );
  });

  it('keeps a catch-all apart from a single parameter, since they match differently', () => {
    expect(identityKey('GET', '/files/:path*')).not.toBe(identityKey('GET', '/files/:name'));
  });

  it('keeps a parameter apart from a literal segment of the same shape', () => {
    expect(identityKey('GET', '/api/invoices/:id')).not.toBe(
      identityKey('GET', '/api/invoices/summary'),
    );
  });
});

describe('endpoint rewriting', () => {
  it('rewrites the path and the id together, so they cannot disagree', () => {
    const result = normalizeEndpoint(endpoint());

    expect(result.path).toBe('/api/invoices/:id');
    expect(result.id).toBe('GET /api/invoices/:id');
  });

  it('leaves everything else as it found it', () => {
    const result = normalizeEndpoint(
      endpoint({ origin: 'source', confidence: 'high', handlerRef: 'src/server.ts:5' }),
    );

    expect(result).toMatchObject({
      origin: 'source',
      confidence: 'high',
      handlerRef: 'src/server.ts:5',
      authRequired: 'unknown',
    });
  });

  it('produces an endpoint that satisfies the Observation contract', () => {
    expect(ObservedEndpointSchema.safeParse(normalizeEndpoint(endpoint())).success).toBe(true);
  });
});

describe('folding a list', () => {
  it('folds two records of one route into one endpoint', () => {
    const folded = normalizeEndpoints([
      endpoint({ path: '/api/invoices/42', evidence: ['EV-1'] }),
      endpoint({ path: '/api/invoices/43', evidence: ['EV-2'] }),
    ]);

    expect(folded).toHaveLength(1);
    expect(folded[0]?.id).toBe('GET /api/invoices/:id');
  });

  it('keeps every piece of evidence that led to the endpoint', () => {
    const folded = normalizeEndpoints([
      endpoint({ path: '/api/invoices/42', evidence: ['EV-1'] }),
      endpoint({ path: '/api/invoices/43', evidence: ['EV-2'] }),
      endpoint({ path: '/api/invoices/44', evidence: ['EV-2'] }),
    ]);

    expect(folded[0]?.evidence).toEqual(['EV-1', 'EV-2']);
  });

  it('unions the fields two records exposed', () => {
    const folded = normalizeEndpoints([
      endpoint({ path: '/api/invoices/42', responseShape: { fields: ['id', 'org_id'] } }),
      endpoint({ path: '/api/invoices/43', responseShape: { fields: ['id', 'notes'] } }),
    ]);

    expect(folded[0]?.responseShape).toEqual({ fields: ['id', 'notes', 'org_id'] });
  });

  it('keeps a handler reference contributed by either', () => {
    const folded = normalizeEndpoints([
      endpoint({ path: '/api/invoices/42' }),
      endpoint({ path: '/api/invoices/43', handlerRef: 'src/server.ts:5' }),
    ]);

    expect(folded[0]?.handlerRef).toBe('src/server.ts:5');
  });

  it('takes a determined authRequired over an unknown one', () => {
    const folded = normalizeEndpoints([
      endpoint({ path: '/api/invoices/42' }),
      endpoint({ path: '/api/invoices/43', authRequired: true }),
    ]);

    expect(folded[0]?.authRequired).toBe(true);
  });

  it('falls back to unknown when two observations disagree about authentication', () => {
    const folded = normalizeEndpoints([
      endpoint({ path: '/api/invoices/42', authRequired: true }),
      endpoint({ path: '/api/invoices/43', authRequired: false }),
    ]);

    expect(folded[0]?.authRequired).toBe('unknown');
  });

  it('does not fold two routes that merely look alike', () => {
    const folded = normalizeEndpoints([
      endpoint({ path: '/api/invoices/42' }),
      endpoint({ path: '/api/invoices/summary' }),
      endpoint({ method: 'DELETE', path: '/api/invoices/42' }),
    ]);

    expect(folded.map((entry) => entry.id)).toEqual([
      'GET /api/invoices/:id',
      'GET /api/invoices/summary',
      'DELETE /api/invoices/:id',
    ]);
  });

  it('follows the input order, so a run is comparable with the one before it', () => {
    const input = [
      endpoint({ path: '/api/zebra' }),
      endpoint({ path: '/api/alpha' }),
      endpoint({ path: '/api/zebra/1' }),
    ];

    expect(normalizeEndpoints(input).map((entry) => entry.id)).toEqual(
      normalizeEndpoints(input).map((entry) => entry.id),
    );
    expect(normalizeEndpoints(input).map((entry) => entry.path)).toEqual([
      '/api/zebra',
      '/api/alpha',
      '/api/zebra/:id',
    ]);
  });

  it('leaves an already normalized list untouched', () => {
    const input = [endpoint({ path: '/api/invoices/:id', id: 'GET /api/invoices/:id' })];
    expect(normalizeEndpoints(input)).toEqual(input);
  });
});
