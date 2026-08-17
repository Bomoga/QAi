import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ObservedEndpointSchema } from '../../contracts/index.ts';
import {
  createExpressAdapter,
  importedModulesIn,
  joinRoutePath,
  routerNamesIn,
  scanExpressFile,
} from './express.ts';

/**
 * Synthetic trees again, for the reason recorded at M4.2: the adapter reads a handful of
 * call forms, and a scaffolded application would add hundreds of files without covering
 * anything more. What it does add here is the cross-file mount, which is the part that
 * decides whether a recorded path is the one the target actually serves.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'qai-express-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relative: string, contents: string): void {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents, 'utf8');
}

describe('path joining', () => {
  it.each([
    ['', '/api/invoices', '/api/invoices'],
    ['/api', '/invoices', '/api/invoices'],
    ['/api', '/', '/api'],
    ['', '/', '/'],
    ['/api/', '/invoices/', '/api/invoices'],
    ['/api', '/invoices/:id', '/api/invoices/:id'],
  ])('joins %s and %s into %s', (prefix, path, expected) => {
    expect(joinRoutePath(prefix, path)).toBe(expected);
  });
});

describe('router identification', () => {
  it('recognizes an application', () => {
    expect([...routerNamesIn('const app = express();').apps]).toEqual(['app']);
  });

  it('recognizes an application built by calling the required module', () => {
    expect([...routerNamesIn("const app = require('express')();").apps]).toEqual(['app']);
  });

  it('recognizes a router, however it was spelled', () => {
    const contents = [
      'const a = express.Router();',
      'const b = Router();',
      'const c = new express.Router();',
    ].join('\n');

    expect([...routerNamesIn(contents).routers].sort()).toEqual(['a', 'b', 'c']);
  });

  it('sees through a type annotation', () => {
    expect([...routerNamesIn('const app: Express = express();').apps]).toEqual(['app']);
  });

  it('does not confuse a router with an application', () => {
    const { apps, routers } = routerNamesIn('const router = express.Router();');
    expect(apps.size).toBe(0);
    expect([...routers]).toEqual(['router']);
  });
});

describe('imported bindings', () => {
  it.each([
    ["import invoices from './routes/invoices.js';", 'invoices', './routes/invoices.js'],
    ["import { invoices } from './routes/invoices.js';", 'invoices', './routes/invoices.js'],
    ["import { routes as invoices } from './routes.js';", 'invoices', './routes.js'],
    ["const invoices = require('./routes/invoices');", 'invoices', './routes/invoices'],
    ["const { invoices } = require('./routes');", 'invoices', './routes'],
  ])('binds %s', (line, name, specifier) => {
    expect(importedModulesIn(line).get(name)).toBe(specifier);
  });
});

describe('route extraction', () => {
  it.each([
    ["app.get('/invoices', list);", 'GET', '/invoices'],
    ["app.post('/invoices', create);", 'POST', '/invoices'],
    ["router.patch('/invoices/:id', update);", 'PATCH', '/invoices/:id'],
    ["router.delete('/invoices/:id', remove);", 'DELETE', '/invoices/:id'],
  ])('reads %s', (line, method, path) => {
    expect(scanExpressFile(line).routes).toEqual([{ method, path, line: 1 }]);
  });

  it('records a route on a receiver declared in the file', () => {
    const contents = ['const api = express.Router();', "api.get('/invoices', list);"].join('\n');

    expect(scanExpressFile(contents).routes).toEqual([
      { method: 'GET', path: '/invoices', line: 2 },
    ]);
  });

  it('records a route on a receiver reached through a property', () => {
    expect(scanExpressFile("this.app.get('/invoices', list);").routes).toEqual([
      { method: 'GET', path: '/invoices', line: 1 },
    ]);
  });

  it('leaves an http client alone, since a request is not a route', () => {
    const contents = [
      'const app = express();',
      "client.get('/api/invoices', config);",
      "axios.get('/api/invoices', config);",
    ].join('\n');

    expect(scanExpressFile(contents).routes).toEqual([]);
  });

  it('leaves a call with no handler alone', () => {
    expect(scanExpressFile("app.get('/invoices');").routes).toEqual([]);
  });

  it('reads a fluent route chain across lines', () => {
    const contents = [
      'const router = express.Router();',
      'router',
      "  .route('/invoices')",
      '  .get(list)',
      '  .post(create);',
      "router.get('/health', health);",
    ].join('\n');

    expect(scanExpressFile(contents).routes).toEqual([
      { method: 'GET', path: '/invoices', line: 4 },
      { method: 'POST', path: '/invoices', line: 5 },
      { method: 'GET', path: '/health', line: 6 },
    ]);
  });

  it('does not carry a chain past the statement that opened it', () => {
    const contents = [
      "app.route('/invoices').get(list);",
      '',
      'const cache = new Map();',
      "cache.get('/invoices');",
    ].join('\n');

    expect(scanExpressFile(contents).routes).toEqual([
      { method: 'GET', path: '/invoices', line: 1 },
    ]);
  });

  it('reports a path it could not read rather than guessing at one', () => {
    const contents = ['const app = express();', 'app.get(`${base}/invoices`, list);'].join('\n');
    const scan = scanExpressFile(contents);

    expect(scan.routes).toEqual([]);
    expect(scan.dynamicLines).toEqual([2]);
  });

  it('records a wildcard method as one route rather than eight', () => {
    expect(scanExpressFile("app.all('/invoices', handler);").routes).toEqual([
      { method: 'ALL', path: '/invoices', line: 1 },
    ]);
  });
});

describe('mount extraction', () => {
  it('reads a mounted router and its prefix', () => {
    const contents = [
      "import invoices from './routes/invoices.js';",
      'const app = express();',
      "app.use('/api', invoices);",
    ].join('\n');

    expect(scanExpressFile(contents).mounts).toEqual([
      { prefix: '/api', identifiers: ['invoices'], line: 3 },
    ]);
  });

  it('reads a mount with middleware in front of the router', () => {
    const contents = "app.use('/api', requireAuth, invoices);";
    expect(scanExpressFile(contents).mounts[0]?.identifiers).toEqual(['requireAuth', 'invoices']);
  });

  it('reads a mount with no prefix', () => {
    expect(scanExpressFile('app.use(invoices);').mounts).toEqual([
      { prefix: '', identifiers: ['invoices'], line: 1 },
    ]);
  });

  it('does not read installed middleware as a mount', () => {
    const contents = ['app.use(express.json());', 'app.use(cors());'].join('\n');
    expect(scanExpressFile(contents).mounts).toEqual([]);
  });
});

describe('detection', () => {
  it('recognizes a package that depends on express', async () => {
    write('package.json', JSON.stringify({ name: 'app', dependencies: { express: '^4.19.0' } }));
    expect(await createExpressAdapter().detect(root)).toBe(true);
  });

  it('recognizes a source file importing express', async () => {
    write('src/server.ts', "import express from 'express';\nconst app = express();\n");
    expect(await createExpressAdapter().detect(root)).toBe(true);
  });

  it('recognizes a source file requiring express', async () => {
    write('src/server.js', "const express = require('express');\n");
    expect(await createExpressAdapter().detect(root)).toBe(true);
  });

  it('does not recognize a tree without express', async () => {
    write('package.json', JSON.stringify({ name: 'app', dependencies: { next: '^15.0.0' } }));
    write('app/api/invoices/route.ts', 'export async function GET() {}\n');
    expect(await createExpressAdapter().detect(root)).toBe(false);
  });
});

describe('scanning', () => {
  it('produces one endpoint per registration, with a handler reference', async () => {
    write(
      'src/server.ts',
      [
        "import express from 'express';",
        '',
        'const app = express();',
        '',
        "app.get('/api/invoices', list);",
        "app.get('/api/invoices/:id', read);",
      ].join('\n'),
    );

    const { endpoints } = await createExpressAdapter().scan(root);

    expect(endpoints).toHaveLength(2);
    expect(endpoints[0]).toMatchObject({
      id: 'GET /api/invoices',
      method: 'GET',
      path: '/api/invoices',
      origin: 'source',
      confidence: 'high',
      handlerRef: 'src/server.ts:5',
    });
    expect(endpoints[1]?.handlerRef).toBe('src/server.ts:6');
  });

  it('carries the mount prefix onto a router declared in another file', async () => {
    write(
      'src/server.ts',
      [
        "import express from 'express';",
        "import invoices from './routes/invoices.js';",
        '',
        'const app = express();',
        "app.use('/api', invoices);",
      ].join('\n'),
    );
    write(
      'src/routes/invoices.ts',
      [
        "import { Router } from 'express';",
        '',
        'const router = Router();',
        "router.get('/invoices', list);",
        "router.get('/invoices/:id', read);",
        '',
        'export default router;',
      ].join('\n'),
    );

    const { endpoints, notes } = await createExpressAdapter().scan(root);

    expect(endpoints.map((endpoint) => endpoint.id)).toEqual([
      'GET /api/invoices',
      'GET /api/invoices/:id',
    ]);
    expect(endpoints[0]?.handlerRef).toBe('src/routes/invoices.ts:4');
    expect(notes).toEqual([]);
  });

  it('follows a chain of mounts', async () => {
    write(
      'src/server.ts',
      [
        "import express from 'express';",
        "import api from './api/index.js';",
        'const app = express();',
        "app.use('/api', api);",
      ].join('\n'),
    );
    write(
      'src/api/index.ts',
      [
        "import { Router } from 'express';",
        "import invoices from './invoices.js';",
        'const router = Router();',
        "router.use('/v1', invoices);",
        'export default router;',
      ].join('\n'),
    );
    write(
      'src/api/invoices.ts',
      [
        "import { Router } from 'express';",
        'const router = Router();',
        "router.get('/invoices', list);",
        'export default router;',
      ].join('\n'),
    );

    const { endpoints } = await createExpressAdapter().scan(root);
    expect(endpoints.map((endpoint) => endpoint.id)).toEqual(['GET /api/v1/invoices']);
  });

  it('resolves a mount whose specifier names a directory', async () => {
    write(
      'src/server.ts',
      [
        "import express from 'express';",
        "import routes from './routes';",
        'const app = express();',
        "app.use('/api', routes);",
      ].join('\n'),
    );
    write(
      'src/routes/index.ts',
      ['const router = express.Router();', "router.get('/invoices', list);"].join('\n'),
    );

    const { endpoints } = await createExpressAdapter().scan(root);
    expect(endpoints.map((endpoint) => endpoint.id)).toEqual(['GET /api/invoices']);
  });

  it('says so when nothing mounts a router, rather than claiming its declared path', async () => {
    write(
      'src/routes/invoices.ts',
      [
        "import { Router } from 'express';",
        'const router = Router();',
        "router.get('/invoices', list);",
      ].join('\n'),
    );

    const { endpoints, notes } = await createExpressAdapter().scan(root);

    expect(endpoints.map((endpoint) => endpoint.id)).toEqual(['GET /invoices']);
    expect(notes[0]?.level).toBe('info');
    expect(notes[0]?.message).toContain('src/routes/invoices.ts');
    expect(notes[0]?.message).toContain('may be missing a prefix');
  });

  it('records a router mounted twice at both paths it is served on', async () => {
    write(
      'src/server.ts',
      [
        "import express from 'express';",
        "import invoices from './invoices.js';",
        'const app = express();',
        "app.use('/api', invoices);",
        "app.use('/internal', invoices);",
      ].join('\n'),
    );
    write(
      'src/invoices.ts',
      ['const router = express.Router();', "router.get('/invoices', list);"].join('\n'),
    );

    const { endpoints } = await createExpressAdapter().scan(root);
    expect(endpoints.map((endpoint) => endpoint.id)).toEqual([
      'GET /api/invoices',
      'GET /internal/invoices',
    ]);
  });

  it('never claims to know whether a route requires authentication', async () => {
    write(
      'src/server.ts',
      ['const app = express();', "app.get('/api/admin/secrets', read);"].join('\n'),
    );

    const { endpoints } = await createExpressAdapter().scan(root);
    expect(endpoints[0]?.authRequired).toBe('unknown');
  });

  it('reports an unreadable path as a note and records no endpoint for it', async () => {
    write(
      'src/server.ts',
      ['const app = express();', 'app.get(`${prefix}/invoices`, list);'].join('\n'),
    );

    const { endpoints, notes } = await createExpressAdapter().scan(root);

    expect(endpoints).toEqual([]);
    expect(notes[0]?.level).toBe('warn');
    expect(notes[0]?.message).toContain('src/server.ts:2');
  });

  it('produces results in a stable order across scans', async () => {
    write('src/zebra.ts', ['const app = express();', "app.get('/zebra', z);"].join('\n'));
    write('src/alpha.ts', ['const app = express();', "app.get('/alpha', a);"].join('\n'));

    const first = await createExpressAdapter().scan(root);
    const second = await createExpressAdapter().scan(root);

    expect(first.endpoints.map((endpoint) => endpoint.id)).toEqual(
      second.endpoints.map((endpoint) => endpoint.id),
    );
    expect(first.endpoints[0]?.path).toBe('/alpha');
  });

  it('produces endpoints that satisfy the Observation contract', async () => {
    write(
      'src/server.ts',
      ['const app = express();', "app.get('/api/invoices/:id', read);"].join('\n'),
    );

    const { endpoints } = await createExpressAdapter().scan(root);
    expect(endpoints).toHaveLength(1);
    for (const endpoint of endpoints) {
      expect(ObservedEndpointSchema.safeParse(endpoint).success).toBe(true);
    }
  });

  it('finds no entities, which are the schema adapter to report', async () => {
    write('src/server.ts', ['const app = express();', "app.get('/invoices', list);"].join('\n'));

    const { entities } = await createExpressAdapter().scan(root);
    expect(entities).toEqual([]);
  });

  it('finds nothing in a tree it does not recognize, without failing', async () => {
    write('src/util.ts', 'export const add = (a: number, b: number) => a + b;\n');

    const { endpoints, notes } = await createExpressAdapter().scan(root);
    expect(endpoints).toEqual([]);
    expect(notes).toEqual([]);
  });
});
