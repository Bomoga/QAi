import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ObservedEntitySchema } from '../../contracts/index.ts';
import { blocksIn, createPrismaAdapter, fieldsInBlock, stripComment } from './prisma.ts';

/**
 * Synthetic schema files, for the reason recorded at M4.2 and M4.3: the adapter reads a
 * block grammar, and a generated Prisma project would add a client, a migration history,
 * and a lock file without testing anything this does not already cover.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'qai-prisma-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relative: string, contents: string): void {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents, 'utf8');
}

const SCHEMA = `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Organization {
  id       String    @id @default(cuid())
  name     String
  invoices Invoice[]
}

/// An invoice, owned by an organization.
model Invoice {
  id         String       @id @default(cuid())
  orgId      String       @map("org_id")
  totalCents Int
  notes      String?
  status     InvoiceStatus @default(DRAFT)
  org        Organization @relation(fields: [orgId], references: [id])

  @@map("invoices")
  @@index([orgId])
}

enum InvoiceStatus {
  DRAFT
  SENT
}
`;

describe('comment handling', () => {
  it.each([
    ['id String // the identifier', 'id String '],
    ['/// a doc comment', ''],
    ['id String', 'id String'],
  ])('strips %s', (line, expected) => {
    expect(stripComment(line)).toBe(expected);
  });

  it('leaves a comment marker inside a string alone', () => {
    const line = '  url String @default("https://example.com")';
    expect(stripComment(line)).toBe(line);
  });
});

describe('block reading', () => {
  it('finds the blocks that describe data and leaves the configuration alone', () => {
    expect(blocksIn(SCHEMA).map((block) => `${block.kind} ${block.name}`)).toEqual([
      'model Organization',
      'model Invoice',
      'enum InvoiceStatus',
    ]);
  });

  it('records the line a block starts on', () => {
    const invoice = blocksIn(SCHEMA).find((block) => block.name === 'Invoice');
    expect(invoice?.line).toBe(17);
  });

  it('says when a block never closed rather than reading to the end silently', () => {
    const blocks = blocksIn('model Invoice {\n  id String\n');
    expect(blocks[0]?.unterminated).toBe(true);
  });

  it('does not treat a closed block as unterminated', () => {
    const blocks = blocksIn('model Invoice {\n  id String\n}\n');
    expect(blocks[0]?.unterminated).toBe(false);
  });
});

describe('field reading', () => {
  it.each([
    ['  id String @id', 'id', 'String'],
    ['  notes String?', 'notes', 'String?'],
    ['  tags String[]', 'tags', 'String[]'],
    ['  totalCents Int', 'totalCents', 'Int'],
  ])('reads %s', (line, name, type) => {
    expect(fieldsInBlock([line], new Set())).toEqual([{ name, type }]);
  });

  it('skips a block attribute', () => {
    expect(fieldsInBlock(['  @@map("invoices")', '  @@index([orgId])'], new Set())).toEqual([]);
  });

  it('skips a relation, which is a link rather than a field', () => {
    const lines = ['  orgId String', '  org Organization @relation(fields: [orgId])'];
    expect(fieldsInBlock(lines, new Set(['Organization']))).toEqual([
      { name: 'orgId', type: 'String' },
    ]);
  });

  it('skips a list of a related model', () => {
    expect(fieldsInBlock(['  invoices Invoice[]'], new Set(['Invoice']))).toEqual([]);
  });

  it('keeps a field typed by an enum, since an enum is a value', () => {
    expect(fieldsInBlock(['  status InvoiceStatus'], new Set(['Organization']))).toEqual([
      { name: 'status', type: 'InvoiceStatus' },
    ]);
  });
});

describe('detection', () => {
  it('recognizes a tree with a schema', async () => {
    write('prisma/schema.prisma', SCHEMA);
    expect(await createPrismaAdapter().detect(root)).toBe(true);
  });

  it('recognizes a schema that is not where convention puts it', async () => {
    write('db/models.prisma', SCHEMA);
    expect(await createPrismaAdapter().detect(root)).toBe(true);
  });

  it('does not recognize a tree without one', async () => {
    write('src/server.ts', 'const x = 1;\n');
    expect(await createPrismaAdapter().detect(root)).toBe(false);
  });
});

describe('scanning', () => {
  it('reports every model as an entity read from a schema', async () => {
    write('prisma/schema.prisma', SCHEMA);

    const { entities } = await createPrismaAdapter().scan(root);

    expect(entities.map((entity) => entity.name)).toEqual(['Organization', 'Invoice']);
    for (const entity of entities) {
      expect(entity.origin).toBe('schema');
      expect(entity.confidence).toBe('high');
    }
  });

  it('reports the scalar fields of a model, each read from the schema', async () => {
    write('prisma/schema.prisma', SCHEMA);

    const { entities } = await createPrismaAdapter().scan(root);
    const invoice = entities.find((entity) => entity.name === 'Invoice');

    expect(invoice?.fields).toEqual([
      { name: 'id', type: 'String', origin: 'schema' },
      { name: 'orgId', type: 'String', origin: 'schema' },
      { name: 'totalCents', type: 'Int', origin: 'schema' },
      { name: 'notes', type: 'String?', origin: 'schema' },
      { name: 'status', type: 'InvoiceStatus', origin: 'schema' },
    ]);
  });

  it('keeps the field name rather than what it maps to in the database', async () => {
    write('prisma/schema.prisma', SCHEMA);

    const { entities } = await createPrismaAdapter().scan(root);
    const invoice = entities.find((entity) => entity.name === 'Invoice');

    expect(invoice?.fields.map((field) => field.name)).toContain('orgId');
    expect(invoice?.fields.map((field) => field.name)).not.toContain('org_id');
  });

  it('reports no endpoint, which is a route adapter to find', async () => {
    write('prisma/schema.prisma', SCHEMA);

    const { endpoints } = await createPrismaAdapter().scan(root);
    expect(endpoints).toEqual([]);
  });

  it('reads a view, which a client queries like a model', async () => {
    write('prisma/schema.prisma', 'view InvoiceTotals {\n  orgId String\n  total Int\n}\n');

    const { entities } = await createPrismaAdapter().scan(root);
    expect(entities.map((entity) => entity.name)).toEqual(['InvoiceTotals']);
  });

  it('does not report an enum as an entity', async () => {
    write('prisma/schema.prisma', 'enum InvoiceStatus {\n  DRAFT\n  SENT\n}\n');

    const { entities } = await createPrismaAdapter().scan(root);
    expect(entities).toEqual([]);
  });

  it('does not report a composite type as an entity', async () => {
    write('prisma/schema.prisma', 'type Address {\n  street String\n}\n');

    const { entities } = await createPrismaAdapter().scan(root);
    expect(entities).toEqual([]);
  });

  it('reads several schema files as one set of models', async () => {
    write('prisma/invoice.prisma', 'model Invoice {\n  id String\n}\n');
    write('prisma/user.prisma', 'model User {\n  id String\n}\n');

    const { entities } = await createPrismaAdapter().scan(root);
    expect(entities.map((entity) => entity.name)).toEqual(['Invoice', 'User']);
  });

  it('reports one model once, however many files declare it', async () => {
    write('prisma/a.prisma', 'model Invoice {\n  id String\n}\n');
    write('prisma/b.prisma', 'model Invoice {\n  id String\n}\n');

    const { entities } = await createPrismaAdapter().scan(root);
    expect(entities).toHaveLength(1);
  });

  it('says so when a model closes no braces, rather than reading to the end silently', async () => {
    write('prisma/schema.prisma', 'model Invoice {\n  id String\n');

    const { entities, notes } = await createPrismaAdapter().scan(root);

    expect(entities.map((entity) => entity.name)).toEqual(['Invoice']);
    expect(notes[0]?.level).toBe('warn');
    expect(notes[0]?.message).toContain('prisma/schema.prisma:1');
  });

  it('says so when a model has no field it could read', async () => {
    write('prisma/schema.prisma', 'model Invoice {\n  @@map("invoices")\n}\n');

    const { entities, notes } = await createPrismaAdapter().scan(root);

    expect(entities[0]?.fields).toEqual([]);
    expect(notes[0]?.level).toBe('info');
    expect(notes[0]?.message).toContain('no field this adapter could read');
  });

  it('produces entities that satisfy the Observation contract', async () => {
    write('prisma/schema.prisma', SCHEMA);

    const { entities } = await createPrismaAdapter().scan(root);
    expect(entities).toHaveLength(2);
    for (const entity of entities) {
      expect(ObservedEntitySchema.safeParse(entity).success).toBe(true);
    }
  });

  it('produces results in a stable order across scans', async () => {
    write('prisma/zebra.prisma', 'model Zebra {\n  id String\n}\n');
    write('prisma/alpha.prisma', 'model Alpha {\n  id String\n}\n');

    const first = await createPrismaAdapter().scan(root);
    const second = await createPrismaAdapter().scan(root);

    expect(first.entities.map((entity) => entity.name)).toEqual(
      second.entities.map((entity) => entity.name),
    );
    expect(first.entities[0]?.name).toBe('Alpha');
  });

  it('finds nothing in a tree it does not recognize, without failing', async () => {
    write('src/server.ts', 'const x = 1;\n');

    const { entities, notes } = await createPrismaAdapter().scan(root);
    expect(entities).toEqual([]);
    expect(notes).toEqual([]);
  });
});
