import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ObservedEndpointSchema } from '../../contracts/index.ts';
import { createNextAdapter, methodsIn, nextPathFor } from './next.ts';

/**
 * Synthetic route trees rather than a real Next.js app. The adapter reads a directory
 * convention and a handful of export forms, and a scaffolded application would add
 * several hundred files without testing anything this does not already cover.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'qai-next-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relative: string, contents: string): void {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents, 'utf8');
}

const HANDLER = `import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  return NextResponse.json({ ok: true });
}
`;

describe('path derivation', () => {
  it.each([
    ['app/api/invoices/route.ts', '/api/invoices'],
    ['app/api/invoices/[id]/route.ts', '/api/invoices/:id'],
    ['src/app/api/invoices/[id]/route.ts', '/api/invoices/:id'],
    ['app/route.ts', '/'],
    ['app/api/invoices/[id]/lines/[lineId]/route.ts', '/api/invoices/:id/lines/:lineId'],
  ])('turns %s into %s', (file, expected) => {
    expect(nextPathFor(file)).toBe(expected);
  });

  it('drops route groups, which organize files without appearing in the URL', () => {
    expect(nextPathFor('app/(marketing)/about/route.ts')).toBe('/about');
    expect(nextPathFor('app/(a)/(b)/deep/route.ts')).toBe('/deep');
  });

  it.each([
    ['app/files/[...path]/route.ts', '/files/:path*'],
    ['app/opt/[[...rest]]/route.ts', '/opt/:rest*'],
  ])('marks the catch-all in %s', (file, expected) => {
    expect(nextPathFor(file)).toBe(expected);
  });

  it('handles a js route file as readily as a ts one', () => {
    expect(nextPathFor('app/api/health/route.js')).toBe('/api/health');
  });
});

describe('method extraction', () => {
  it.each([
    ['export async function GET(request: Request) {', 'GET'],
    ['export function POST(request: Request) {', 'POST'],
    ['export const PATCH = async (request: Request) => {', 'PATCH'],
    ['  export async function DELETE() {', 'DELETE'],
  ])('recognizes %s', (line, method) => {
    expect(methodsIn(line).map((entry) => entry.method)).toEqual([method]);
  });

  it('records the line each method is declared on', () => {
    const contents = ['import x from "y";', '', 'export async function GET() {}'].join('\n');
    expect(methodsIn(contents)).toEqual([{ method: 'GET', line: 3 }]);
  });

  it('finds several methods in one file', () => {
    const contents = ['export async function GET() {}', 'export async function POST() {}'].join(
      '\n',
    );
    expect(methodsIn(contents).map((entry) => entry.method)).toEqual(['GET', 'POST']);
  });

  it('ignores a method named inside a comment or a string', () => {
    const contents = [
      '// export async function DELETE() {}',
      'const doc = "export function PUT() {}";',
      'export async function GET() {}',
    ].join('\n');

    expect(methodsIn(contents).map((entry) => entry.method)).toEqual(['GET']);
  });

  it('ignores a function that is not exported', () => {
    expect(methodsIn('async function GET() {}')).toEqual([]);
  });

  it('ignores a call to something that merely looks like a method', () => {
    expect(methodsIn('logger.GET("hello")')).toEqual([]);
  });
});

describe('detection', () => {
  it('recognizes a tree with route files', async () => {
    write('app/api/invoices/route.ts', HANDLER);
    expect(await createNextAdapter().detect(root)).toBe(true);
  });

  it('does not recognize a tree without them', async () => {
    write('src/server.ts', 'const x = 1;');
    expect(await createNextAdapter().detect(root)).toBe(false);
  });
});

describe('scanning', () => {
  it('produces one endpoint per exported method, with a handler reference', async () => {
    write('app/api/invoices/[id]/route.ts', HANDLER);

    const { endpoints } = await createNextAdapter().scan(root);

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]).toMatchObject({
      id: 'GET /api/invoices/:id',
      method: 'GET',
      path: '/api/invoices/:id',
      origin: 'source',
      handlerRef: 'app/api/invoices/[id]/route.ts:3',
    });
  });

  it('produces an endpoint per method when a file exports several', async () => {
    write(
      'app/api/invoices/route.ts',
      ['export async function GET() {}', 'export async function POST() {}'].join('\n'),
    );

    const { endpoints } = await createNextAdapter().scan(root);
    expect(endpoints.map((endpoint) => endpoint.id).sort()).toEqual([
      'GET /api/invoices',
      'POST /api/invoices',
    ]);
  });

  it('never claims to know whether a route requires authentication', async () => {
    write('app/api/admin/secrets/route.ts', HANDLER);

    const { endpoints } = await createNextAdapter().scan(root);
    expect(endpoints[0]?.authRequired).toBe('unknown');
  });

  it('reports a route file exporting nothing recognizable rather than inventing a route', async () => {
    write('app/api/broken/route.ts', 'const handler = () => {};\n');

    const { endpoints, notes } = await createNextAdapter().scan(root);

    expect(endpoints).toEqual([]);
    expect(notes[0]?.level).toBe('warn');
    expect(notes[0]?.message).toContain('app/api/broken/route.ts');
  });

  it('produces results in a stable order across scans', async () => {
    write('app/api/zebra/route.ts', HANDLER);
    write('app/api/alpha/route.ts', HANDLER);

    const first = await createNextAdapter().scan(root);
    const second = await createNextAdapter().scan(root);

    expect(first.endpoints.map((endpoint) => endpoint.id)).toEqual(
      second.endpoints.map((endpoint) => endpoint.id),
    );
    expect(first.endpoints[0]?.path).toBe('/api/alpha');
  });

  it('produces endpoints that satisfy the Observation contract', async () => {
    write('app/api/invoices/[id]/route.ts', HANDLER);

    const { endpoints } = await createNextAdapter().scan(root);
    for (const endpoint of endpoints) {
      expect(ObservedEndpointSchema.safeParse(endpoint).success).toBe(true);
    }
  });

  it('finds nothing in a tree it does not recognize, without failing', async () => {
    write('src/server.ts', 'const x = 1;');

    const { endpoints, notes } = await createNextAdapter().scan(root);
    expect(endpoints).toEqual([]);
    expect(notes).toEqual([]);
  });
});
