import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SCHEMA_RELATIVE_PATH,
  generateSpecJsonSchema,
  repositoryRoot,
} from '../../scripts/generate-schema.ts';

/**
 * The committed JSON Schema is what an author's editor validates against. The Zod
 * schema is what the loader enforces. If they drift, an editor reports a spec as valid
 * that the tool then rejects, and the author has no way to tell which one is lying.
 *
 * Regenerate with:
 *   pnpm --filter @qai/core generate:schema
 *
 * and review the diff. Do not regenerate to make this pass without reading what moved.
 */
describe('schema/spec.schema.json', () => {
  it('matches what the Zod schema generates', () => {
    const committed = readFileSync(resolve(repositoryRoot(), SCHEMA_RELATIVE_PATH), 'utf8');
    expect(committed).toBe(generateSpecJsonSchema());
  });

  it('is valid JSON with the draft it claims', () => {
    const committed: unknown = JSON.parse(
      readFileSync(resolve(repositoryRoot(), SCHEMA_RELATIVE_PATH), 'utf8'),
    );
    expect(committed).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
    });
  });

  it('carries the closed enums, so an editor rejects an unknown action before a run does', () => {
    const committed = readFileSync(resolve(repositoryRoot(), SCHEMA_RELATIVE_PATH), 'utf8');
    expect(committed).toContain('"read"');
    expect(committed).toContain('"list"');
    expect(committed).toContain('"deny"');
    expect(committed).toContain('"deterministic"');
    expect(committed).toContain('"fuzzy"');
  });
});
