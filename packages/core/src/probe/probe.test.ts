import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ObservationSchema } from '../contracts/index.ts';
import { fixedDeps } from '../target/deps.ts';
import type { RequestSpec } from '../target/request.ts';
import type { CrawlSession } from './crawl.ts';
import { probe, type ProbeContext } from './probe.ts';

/**
 * The probe end to end, with a synthetic source tree and an in-memory target. What is
 * under test is which halves ran and what the merge made of them, so both halves are
 * fakes that a test can state in three lines.
 */

const BASE = 'http://localhost:3000';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'qai-probe-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relative: string, contents: string): void {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents, 'utf8');
}

function site(pages: Readonly<Record<string, string>>): {
  session: CrawlSession;
  sent: RequestSpec[];
} {
  const sent: RequestSpec[] = [];
  let counter = 0;

  return {
    sent,
    session: {
      id: 'owner',
      request(spec) {
        sent.push(spec);
        counter += 1;

        const body = pages[spec.path];

        return Promise.resolve({
          outcome: {
            kind: 'response',
            response: {
              status: body === undefined ? 404 : 200,
              headers: { 'content-type': 'text/html' },
              body: body ?? '',
              truncated: false,
              durationMs: 1,
            },
          },
          evidenceId: `EV-${counter}`,
        });
      },
    },
  };
}

function context(
  session?: CrawlSession,
  target: ProbeContext['config']['target'] = {},
): {
  ctx: ProbeContext;
} {
  return {
    ctx: {
      config: { target },
      sessions: new Map(session === undefined ? [] : [['owner', session]]),
    },
  };
}

const DEPS = fixedDeps('2026-01-01T00:00:00.000Z');

describe('probing both halves', () => {
  it('reports hybrid mode and reconciles the two', async () => {
    write(
      'src/server.ts',
      ["import express from 'express';", 'const app = express();', "app.get('/', home);"].join(
        '\n',
      ),
    );

    const { session } = site({ '/': '<a href="/debug">x</a>', '/debug': '' });
    const { ctx } = context(session);

    const observation = await probe(ctx, {
      deps: DEPS,
      cwd: root,
      sourceRoot: '.',
      baseUrl: BASE,
    });

    expect(observation.mode).toBe('hybrid');
    expect(observation.endpoints.map((endpoint) => endpoint.id).sort()).toEqual([
      'GET /',
      'GET /debug',
    ]);

    const home = observation.endpoints.find((endpoint) => endpoint.path === '/');
    const debug = observation.endpoints.find((endpoint) => endpoint.path === '/debug');

    expect(home).toMatchObject({ origin: 'source', confidence: 'high' });
    expect(debug).toMatchObject({ origin: 'blackbox', confidence: 'medium' });
  });

  it('satisfies the Observation contract', async () => {
    write(
      'src/server.ts',
      ["import express from 'express';", 'const app = express();', "app.get('/', home);"].join(
        '\n',
      ),
    );

    const { session } = site({ '/': '' });
    const { ctx } = context(session);

    const observation = await probe(ctx, {
      deps: DEPS,
      cwd: root,
      sourceRoot: '.',
      baseUrl: BASE,
    });

    expect(ObservationSchema.safeParse(observation).success).toBe(true);
    expect(observation.observedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('degrading to one half', () => {
  it('falls back to the crawl when no source root is configured', async () => {
    const { session } = site({ '/': '<a href="/api/invoices">x</a>', '/api/invoices': '' });
    const { ctx } = context(session, { baseUrl: BASE });

    const observation = await probe(ctx, { deps: DEPS });

    expect(observation.mode).toBe('blackbox');
    expect(observation.endpoints.map((endpoint) => endpoint.id)).toEqual([
      'GET /',
      'GET /api/invoices',
    ]);
    for (const endpoint of observation.endpoints) {
      expect(endpoint).toMatchObject({ origin: 'blackbox', confidence: 'low' });
    }
    expect(observation.notes.map((note) => note.message)).toContain(
      'No source root is configured, so the Observation is black box only and every endpoint in it was inferred from traffic.',
    );
  });

  it('describes the source alone when the target cannot be requested', async () => {
    write(
      'src/server.ts',
      [
        "import express from 'express';",
        'const app = express();',
        "app.get('/api/invoices', list);",
      ].join('\n'),
    );

    const { ctx } = context(undefined, { sourceRoot: '.' });
    const observation = await probe(ctx, { deps: DEPS, cwd: root });

    expect(observation.mode).toBe('source');
    expect(observation.endpoints.map((endpoint) => endpoint.id)).toEqual(['GET /api/invoices']);
    expect(observation.notes.map((note) => note.message)).toContain(
      'No base URL is configured, so nothing was requested and the Observation describes the source alone.',
    );
  });

  it('says so when there is a target but no actor to reach it as', async () => {
    write(
      'src/server.ts',
      [
        "import express from 'express';",
        'const app = express();',
        "app.get('/api/invoices', list);",
      ].join('\n'),
    );

    const { ctx } = context(undefined, { sourceRoot: '.', baseUrl: BASE });
    const observation = await probe(ctx, { deps: DEPS, cwd: root });

    expect(observation.mode).toBe('source');
    const note = observation.notes.find((entry) => entry.message.includes('No actor'));
    expect(note?.level).toBe('warn');
  });

  it('does not call a source root nothing recognized a source reading', async () => {
    write('src/server.ts', 'export const add = (a: number, b: number) => a + b;\n');

    const { session } = site({ '/': '' });
    const { ctx } = context(session);

    const observation = await probe(ctx, {
      deps: DEPS,
      cwd: root,
      sourceRoot: '.',
      baseUrl: BASE,
    });

    expect(observation.mode).toBe('blackbox');
    expect(observation.endpoints[0]).toMatchObject({ origin: 'blackbox', confidence: 'low' });
    expect(observation.notes.map((note) => note.message)).toContain(
      'No source adapter recognized the source root, so endpoints and entities can only come from the black box crawl.',
    );
  });

  it('reads the target from the config when the options do not override it', async () => {
    const { session, sent } = site({ '/api/invoices': '' });
    const { ctx } = context(session, { baseUrl: BASE });

    await probe(ctx, { deps: DEPS, startPaths: ['/api/invoices'] });

    expect(sent).toEqual([{ method: 'GET', path: '/api/invoices' }]);
  });
});

describe('two adapters over one repository', () => {
  it('takes routes from one and models from the other', async () => {
    write(
      'src/server.ts',
      [
        "import express from 'express';",
        'const app = express();',
        "app.get('/api/invoices', list);",
      ].join('\n'),
    );
    write(
      'prisma/schema.prisma',
      ['model Invoice {', '  id String @id', '  orgId String @map("org_id")', '}'].join('\n'),
    );

    const { session } = site({ '/api/invoices': '' });
    const { ctx } = context(session);

    const observation = await probe(ctx, {
      deps: DEPS,
      cwd: root,
      sourceRoot: '.',
      baseUrl: BASE,
      startPaths: ['/api/invoices'],
    });

    expect(observation.endpoints.map((endpoint) => endpoint.id)).toEqual(['GET /api/invoices']);
    expect(observation.entities.map((entity) => entity.name)).toEqual(['Invoice']);
    expect(observation.entities[0]).toMatchObject({ origin: 'schema', confidence: 'high' });
    expect(observation.entities[0]?.fields.map((field) => field.name)).toEqual(['id', 'orgId']);
  });

  it('reads a schema even where no route adapter recognizes anything', async () => {
    write('prisma/schema.prisma', 'model Invoice {\n  id String @id\n}\n');

    const { ctx } = context(undefined, { sourceRoot: '.' });
    const observation = await probe(ctx, { deps: DEPS, cwd: root });

    expect(observation.mode).toBe('source');
    expect(observation.entities.map((entity) => entity.name)).toEqual(['Invoice']);
    expect(observation.endpoints).toEqual([]);
  });
});

describe('what the probe does not do', () => {
  it('issues nothing but GET and HEAD', async () => {
    const { session, sent } = site({ '/': '<a href="/a">x</a><a href="/b.css">y</a>', '/a': '' });
    const { ctx } = context(session, { baseUrl: BASE });

    await probe(ctx, { deps: DEPS });

    expect(sent.length).toBeGreaterThan(0);
    for (const spec of sent) {
      expect(['GET', 'HEAD']).toContain(spec.method);
    }
  });

  it('names no entity when nothing read a schema', async () => {
    write(
      'src/server.ts',
      [
        "import express from 'express';",
        'const app = express();',
        "app.get('/api/invoices', list);",
      ].join('\n'),
    );

    const { session } = site({ '/api/invoices': '' });
    const { ctx } = context(session);

    const observation = await probe(ctx, {
      deps: DEPS,
      cwd: root,
      sourceRoot: '.',
      baseUrl: BASE,
      startPaths: ['/api/invoices'],
    });

    expect(observation.entities).toEqual([]);
  });

  it('produces the same Observation twice over the same target', async () => {
    write(
      'src/server.ts',
      ["import express from 'express';", 'const app = express();', "app.get('/', home);"].join(
        '\n',
      ),
    );

    const options = { deps: DEPS, cwd: root, sourceRoot: '.', baseUrl: BASE };

    const first = await probe(context(site({ '/': '' }).session).ctx, options);
    const second = await probe(context(site({ '/': '' }).session).ctx, options);

    expect(first).toEqual(second);
  });
});
