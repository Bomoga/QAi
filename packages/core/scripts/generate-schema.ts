import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';

import { SpecSchema } from '../src/contracts/spec.ts';

/**
 * Generates `schema/spec.schema.json` for editor autocomplete.
 *
 * The committed file is asserted to match this output in a test, so the schema an
 * author's editor validates against cannot drift from the schema the loader enforces.
 * Run this after any contract change and commit the result deliberately.
 */

export const SCHEMA_RELATIVE_PATH = 'schema/spec.schema.json';

export function generateSpecJsonSchema(): string {
  const schema = z.toJSONSchema(SpecSchema, { target: 'draft-2020-12' });

  const document = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://github.com/Bomoga/QAi/schema/spec.schema.json',
    title: 'QAi spec',
    description:
      'Machine-readable statement of intent. See docs/plan/03-CONTRACTS.md section 1. Input only, never mutated by a run.',
    ...schema,
  };

  return `${JSON.stringify(document, null, 2)}\n`;
}

/** Repository root, three levels up from packages/core/scripts. */
export function repositoryRoot(): string {
  return resolve(import.meta.dirname, '..', '..', '..');
}

function main(): void {
  const target = resolve(repositoryRoot(), SCHEMA_RELATIVE_PATH);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, generateSpecJsonSchema(), 'utf8');
  process.stdout.write(`wrote ${SCHEMA_RELATIVE_PATH}\n`);
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  main();
}
