import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import fastGlob from 'fast-glob';

import type { ObservationNote, ObservedEntity, ObservedField } from '../../contracts/index.ts';
import { CONFIDENCE_SOURCE_ONLY, type SourceAdapter, type SourceScan } from '../types.ts';

/**
 * Prisma schema adapter.
 *
 * Read textually, by decision. The module implementation notes prefer `@prisma/internals`
 * to parse the schema properly, and that package is not on the approved dependency list
 * in 04-CONVENTIONS.md; the plan was corrected rather than the list widened. The block
 * grammar is regular enough to read this way, and this matches what the Next.js and
 * Express adapters already do.
 *
 * What is read:
 *
 *   model Invoice {
 *     id         String   @id @default(cuid())
 *     orgId      String   @map("org_id")
 *     totalCents Int
 *     org        Organization @relation(fields: [orgId], references: [id])
 *     @@map("invoices")
 *   }
 *
 * becomes one entity `Invoice` with fields `id`, `orgId`, and `totalCents`, each
 * `origin: "schema"`.
 *
 * Three deliberate omissions:
 *
 * - Relation fields are dropped. `org` above is a link to another model, not necessarily
 *   a field in any response, and recording it would produce an undeclared field finding
 *   against a spec that was right all along.
 * - `@map` is not used as the field name. The mapped value is the database column; the
 *   client surface carries the field name. The diff already matches `orgId` to `org_id`.
 * - Enums and composite `type` blocks are not entities. They are read only to tell a
 *   scalar field from a relation.
 */

const SCHEMA_GLOBS = ['**/*.prisma'];

const IGNORED_GLOBS = ['**/node_modules/**', '**/dist/**', '**/build/**'];

/** `model X {`, and the three other block kinds worth knowing the names of. */
const BLOCK_HEADER = /^\s*(model|view|enum|type)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/u;

/** `name Type`, `name Type?`, `name Type[]`. Anything after that is attributes. */
const FIELD_LINE = /^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*(?:\[\])?\??)(?:\s|$)/u;

export type PrismaBlockKind = 'model' | 'view' | 'enum' | 'type';

/** Block kinds that describe something a client can query, and so an entity. */
const ENTITY_KINDS = new Set<PrismaBlockKind>(['model', 'view']);

export interface PrismaBlock {
  readonly kind: PrismaBlockKind;
  readonly name: string;
  /** Body lines, comments already removed. */
  readonly lines: readonly string[];
  readonly line: number;
  /** True when the file ended before the block closed. */
  readonly unterminated: boolean;
}

export interface PrismaField {
  readonly name: string;
  readonly type: string;
}

/**
 * Removes a `//` comment, leaving anything inside a quoted string alone so a default
 * value such as `@default("https://example.com")` survives.
 */
export function stripComment(line: string): string {
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (!quoted && char === '/' && line[index + 1] === '/') return line.slice(0, index);
  }

  return line;
}

/**
 * Top level blocks. Prisma blocks do not nest, so the first line that is a closing brace
 * ends the block and a line reader is enough.
 */
export function blocksIn(contents: string): PrismaBlock[] {
  const lines = contents.split(/\r?\n/u).map(stripComment);
  const blocks: PrismaBlock[] = [];

  let index = 0;

  while (index < lines.length) {
    const header = BLOCK_HEADER.exec(lines[index] ?? '');

    if (header === null) {
      index += 1;
      continue;
    }

    const kind = header[1] as PrismaBlockKind;
    const name = header[2];
    const start = index;
    const body: string[] = [];

    index += 1;
    let closed = false;

    while (index < lines.length) {
      const line = lines[index] ?? '';
      index += 1;

      if (line.trim() === '}') {
        closed = true;
        break;
      }

      body.push(line);
    }

    if (name !== undefined) {
      blocks.push({ kind, name, lines: body, line: start + 1, unterminated: !closed });
    }
  }

  return blocks;
}

function baseType(type: string): string {
  return type.replace(/\[\]/u, '').replace(/\?$/u, '');
}

/**
 * Scalar fields of one block. A field whose type names another block is a relation.
 *
 * Named for the block rather than called `fieldsIn`, which the crawler already exports
 * through the same barrel. M4.1 hit that once already: anything the barrel exports twice
 * is a compile error rather than a silent divergence, which is the point of the barrel.
 */
export function fieldsInBlock(
  lines: readonly string[],
  relationTypes: ReadonlySet<string>,
): PrismaField[] {
  const fields: PrismaField[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('@@') || trimmed.startsWith('@')) continue;

    const match = FIELD_LINE.exec(trimmed);
    const name = match?.[1];
    const type = match?.[2];
    if (name === undefined || type === undefined) continue;

    if (relationTypes.has(baseType(type))) continue;

    fields.push({ name, type });
  }

  return fields;
}

export function createPrismaAdapter(): SourceAdapter {
  return {
    name: 'prisma',

    async detect(root) {
      const matches = await fastGlob(SCHEMA_GLOBS, {
        cwd: root,
        onlyFiles: true,
        dot: false,
        ignore: IGNORED_GLOBS,
      });

      return matches.length > 0;
    },

    async scan(root) {
      const files = (
        await fastGlob(SCHEMA_GLOBS, {
          cwd: root,
          onlyFiles: true,
          dot: false,
          ignore: IGNORED_GLOBS,
        })
      ).sort();

      const entities: ObservedEntity[] = [];
      const notes: ObservationNote[] = [];
      const seen = new Set<string>();

      for (const file of files) {
        let contents: string;
        try {
          contents = readFileSync(join(root, file), 'utf8');
        } catch {
          notes.push({ level: 'warn', message: `${file} could not be read`, refs: [] });
          continue;
        }

        const blocks = blocksIn(contents);

        // Anything a field can point at rather than hold. Enums are values, so a field
        // typed by one is scalar and stays.
        const relationTypes = new Set(
          blocks.filter((block) => block.kind !== 'enum').map((block) => block.name),
        );

        for (const block of blocks) {
          if (block.unterminated) {
            notes.push({
              level: 'warn',
              message: `${file}:${block.line} declares ${block.kind} ${block.name} and the file ends before the block closes, so it was read as far as it goes`,
              refs: [],
            });
          }

          if (!ENTITY_KINDS.has(block.kind)) continue;

          const key = block.name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);

          const fields: ObservedField[] = fieldsInBlock(block.lines, relationTypes).map(
            (field) => ({
              name: field.name,
              type: field.type,
              origin: 'schema',
            }),
          );

          if (fields.length === 0) {
            notes.push({
              level: 'info',
              message: `${file}:${block.line} declares ${block.kind} ${block.name} with no field this adapter could read`,
              refs: [],
            });
          }

          entities.push({
            name: block.name,
            origin: 'schema',
            confidence: CONFIDENCE_SOURCE_ONLY,
            fields,
            evidence: [],
          });
        }
      }

      const scan: SourceScan = { endpoints: [], entities, notes };
      return scan;
    },
  };
}
