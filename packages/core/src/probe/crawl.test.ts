import { describe, expect, it } from 'vitest';

import { ObservedEndpointSchema } from '../contracts/index.ts';
import type { RequestOutcome, RequestSpec } from '../target/request.ts';
import {
  CRAWL_METHODS,
  crawl,
  fieldsIn,
  linksIn,
  looksLikeAsset,
  sameOriginPath,
} from './crawl.ts';
import type { CrawlSession } from './crawl.ts';

/**
 * An in-memory site rather than a server. Rule R9 keeps unit tests off the network, and
 * what is under test here is the traversal, not the transport, which M2 already covers.
 */

const BASE = 'http://localhost:3000';

interface Page {
  readonly status?: number;
  readonly type?: string;
  readonly body?: string;
}

function site(pages: Readonly<Record<string, Page>>): {
  session: CrawlSession;
  sent: RequestSpec[];
} {
  const sent: RequestSpec[] = [];
  let counter = 0;

  const session: CrawlSession = {
    id: 'owner',
    request(spec) {
      sent.push(spec);
      counter += 1;

      const page = pages[spec.path];
      const status = page === undefined ? 404 : (page.status ?? 200);

      const outcome: RequestOutcome = {
        kind: 'response',
        response: {
          status,
          headers: { 'content-type': page?.type ?? 'text/html; charset=utf-8' },
          body: page?.body ?? '',
          truncated: false,
          durationMs: 1,
        },
      };

      return Promise.resolve({ outcome, evidenceId: `EV-${counter}` });
    },
  };

  return { session, sent };
}

function failingSession(message: string): CrawlSession {
  return {
    id: 'owner',
    request() {
      return Promise.resolve({
        outcome: { kind: 'transport-error', message, durationMs: 1 },
        evidenceId: 'EV-1',
      });
    },
  };
}

function html(...links: string[]): string {
  return `<html><body>${links.map((link) => `<a href="${link}">x</a>`).join('')}</body></html>`;
}

describe('link extraction', () => {
  it.each([
    ['<a href="/invoices">x</a>', '/invoices'],
    ["<a href='/invoices'>x</a>", '/invoices'],
    ['<a href=/invoices>x</a>', '/invoices'],
    ['<script src="/app.js"></script>', '/app.js'],
  ])('reads %s', (markup, expected) => {
    expect(linksIn(markup)).toEqual([expected]);
  });

  it('does not read a form action, since a form is not a link', () => {
    expect(linksIn('<form action="/invoices" method="post"></form>')).toEqual([]);
  });
});

describe('origin and scheme handling', () => {
  it.each([
    ['/invoices', '/invoices'],
    ['invoices', '/invoices'],
    ['http://localhost:3000/invoices', '/invoices'],
    ['/invoices?page=2', '/invoices'],
    ['/invoices#top', '/invoices'],
  ])('resolves %s', (candidate, expected) => {
    expect(sameOriginPath(candidate, BASE)).toBe(expected);
  });

  it.each([
    ['https://example.com/invoices'],
    ['http://localhost:4000/invoices'],
    ['javascript:alert(1)'],
    ['mailto:someone@example.com'],
    ['tel:+15550000'],
    ['data:text/html,hi'],
    ['#section'],
  ])('refuses to follow %s', (candidate) => {
    expect(sameOriginPath(candidate, BASE)).toBeUndefined();
  });
});

describe('asset detection', () => {
  it.each(['/app.css', '/app.js', '/logo.PNG', '/font.woff2'])('treats %s as an asset', (path) => {
    expect(looksLikeAsset(path)).toBe(true);
  });

  it.each(['/api/invoices', '/invoices/42', '/'])('treats %s as a page', (path) => {
    expect(looksLikeAsset(path)).toBe(false);
  });
});

describe('response fields', () => {
  it('reads the keys of an object', () => {
    expect(fieldsIn('{"org_id":"org-1","id":"INV-1"}')).toEqual(['id', 'org_id']);
  });

  it('reads the keys of the first record in a list', () => {
    expect(fieldsIn('[{"id":"INV-1","total_cents":10}]')).toEqual(['id', 'total_cents']);
  });

  it('reads nothing from a body it cannot parse', () => {
    expect(fieldsIn('<html></html>')).toEqual([]);
  });

  it('reads nothing from an empty list, rather than claiming no fields exist', () => {
    expect(fieldsIn('[]')).toEqual([]);
  });
});

describe('crawling', () => {
  it('records the pages that answered, with the evidence for each', async () => {
    const { session } = site({
      '/': { body: html('/invoices') },
      '/invoices': { body: html() },
    });

    const { endpoints } = await crawl(session, { baseUrl: BASE });

    expect(endpoints.map((endpoint) => endpoint.id)).toEqual(['GET /', 'GET /invoices']);
    expect(endpoints[0]).toMatchObject({
      origin: 'blackbox',
      confidence: 'low',
      authRequired: 'unknown',
    });
    expect(endpoints[0]?.evidence).toHaveLength(1);
  });

  it('issues nothing but GET and HEAD', async () => {
    const { session, sent } = site({
      '/': { body: html('/invoices', '/app.css') },
      '/invoices': { body: html() },
      '/app.css': { type: 'text/css' },
    });

    await crawl(session, { baseUrl: BASE });

    expect(sent.length).toBeGreaterThan(0);
    for (const spec of sent) {
      expect(CRAWL_METHODS).toContain(spec.method);
    }
  });

  it('asks for an asset with HEAD rather than downloading it', async () => {
    const { session, sent } = site({
      '/': { body: html('/app.css') },
      '/app.css': { type: 'text/css' },
    });

    await crawl(session, { baseUrl: BASE });

    expect(sent).toEqual([
      { method: 'GET', path: '/' },
      { method: 'HEAD', path: '/app.css' },
    ]);
  });

  it('never leaves the origin', async () => {
    const { session, sent } = site({
      '/': { body: html('https://example.com/tracker', 'http://localhost:4000/admin') },
    });

    await crawl(session, { baseUrl: BASE });

    expect(sent).toEqual([{ method: 'GET', path: '/' }]);
  });

  it('never follows a form action', async () => {
    const { session, sent } = site({
      '/': { body: '<form action="/invoices/delete" method="post"></form>' },
    });

    await crawl(session, { baseUrl: BASE });

    expect(sent.map((spec) => spec.path)).toEqual(['/']);
  });

  it('does not record a path that answered 404', async () => {
    const { session } = site({ '/': { body: html('/gone') } });

    const { endpoints } = await crawl(session, { baseUrl: BASE });
    expect(endpoints.map((endpoint) => endpoint.id)).toEqual(['GET /']);
  });

  it('records a path that refused this actor, since refusing proves it is there', async () => {
    const { session } = site({
      '/': { body: html('/admin') },
      '/admin': { status: 403, body: '' },
    });

    const { endpoints } = await crawl(session, { baseUrl: BASE });
    expect(endpoints.map((endpoint) => endpoint.id)).toEqual(['GET /', 'GET /admin']);
  });

  it('does not conclude that a refusal means credentials are required', async () => {
    const { session } = site({ '/': { status: 401, body: '' } });

    const { endpoints } = await crawl(session, { baseUrl: BASE });
    expect(endpoints[0]?.authRequired).toBe('unknown');
  });

  it('leaves actor visibility to the checks', async () => {
    const { session } = site({ '/': { body: html() } });

    const { endpoints } = await crawl(session, { baseUrl: BASE });
    expect(endpoints[0]?.actorVisibility).toEqual({});
  });

  it('records the fields a JSON response exposed', async () => {
    const { session } = site({
      '/': { body: html('/api/invoices') },
      '/api/invoices': {
        type: 'application/json',
        body: '[{"id":"INV-1","org_id":"org-1"}]',
      },
    });

    const { endpoints } = await crawl(session, { baseUrl: BASE });
    const invoices = endpoints.find((endpoint) => endpoint.path === '/api/invoices');

    expect(invoices?.responseShape).toEqual({ fields: ['id', 'org_id'] });
  });

  it('never names an entity, which a crawl cannot see', async () => {
    const { session } = site({
      '/': { type: 'application/json', body: '{"id":"INV-1"}' },
    });

    const scan = await crawl(session, { baseUrl: BASE });

    expect(scan.entities).toEqual([]);
    expect(scan.endpoints[0]?.responseShape?.entity).toBeUndefined();
  });

  it('follows a path named in a JSON body, which is how an API index is read', async () => {
    const { session, sent } = site({
      '/': { type: 'application/json', body: '{"routes":["/api/invoices"]}' },
      '/api/invoices': { type: 'application/json', body: '[]' },
    });

    await crawl(session, { baseUrl: BASE });
    expect(sent.map((spec) => spec.path)).toEqual(['/', '/api/invoices']);
  });

  it('visits each path once, however many pages link to it', async () => {
    const { session, sent } = site({
      '/': { body: html('/a', '/b') },
      '/a': { body: html('/b', '/') },
      '/b': { body: html('/a') },
    });

    await crawl(session, { baseUrl: BASE });
    expect(sent.map((spec) => spec.path)).toEqual(['/', '/a', '/b']);
  });

  it('stops at the depth budget', async () => {
    const { session, sent } = site({
      '/': { body: html('/one') },
      '/one': { body: html('/two') },
      '/two': { body: html('/three') },
      '/three': { body: html() },
    });

    await crawl(session, { baseUrl: BASE, maxDepth: 1 });
    expect(sent.map((spec) => spec.path)).toEqual(['/', '/one']);
  });

  it('stops at the page budget and says the Observation is partial', async () => {
    const { session, sent } = site({
      '/': { body: html('/a', '/b', '/c') },
      '/a': { body: html() },
      '/b': { body: html() },
      '/c': { body: html() },
    });

    const { notes } = await crawl(session, { baseUrl: BASE, maxPages: 2 });

    expect(sent).toHaveLength(2);
    expect(notes[0]?.level).toBe('warn');
    expect(notes[0]?.message).toContain('ceiling of 2 requests');
    expect(notes[0]?.message).toContain('2 paths still to visit');
  });

  it('starts where it is told to', async () => {
    const { session, sent } = site({
      '/api/invoices': { type: 'application/json', body: '[]' },
    });

    await crawl(session, { baseUrl: BASE, startPaths: ['/api/invoices'] });
    expect(sent.map((spec) => spec.path)).toEqual(['/api/invoices']);
  });

  it('reports a path it could not reach and keeps going', async () => {
    const scan = await crawl(failingSession('connect ECONNREFUSED'), { baseUrl: BASE });

    expect(scan.endpoints).toEqual([]);
    expect(scan.notes[0]?.level).toBe('warn');
    expect(scan.notes[0]?.message).toContain('connect ECONNREFUSED');
    expect(scan.notes[0]?.refs).toEqual(['EV-1']);
  });

  it('produces endpoints that satisfy the Observation contract', async () => {
    const { session } = site({
      '/': { body: html('/api/invoices') },
      '/api/invoices': { type: 'application/json', body: '[{"id":"INV-1"}]' },
    });

    const { endpoints } = await crawl(session, { baseUrl: BASE });

    expect(endpoints).toHaveLength(2);
    for (const endpoint of endpoints) {
      expect(ObservedEndpointSchema.safeParse(endpoint).success).toBe(true);
    }
  });

  it('produces the same result twice over the same site', async () => {
    const pages = {
      '/': { body: html('/zebra', '/alpha') },
      '/alpha': { body: html() },
      '/zebra': { body: html() },
    };

    const first = await crawl(site(pages).session, { baseUrl: BASE });
    const second = await crawl(site(pages).session, { baseUrl: BASE });

    expect(first.endpoints.map((endpoint) => endpoint.id)).toEqual(
      second.endpoints.map((endpoint) => endpoint.id),
    );
  });
});
