import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hashSpec } from './hash.ts';
import { isLoadFailure, loadSpec } from './load.ts';
import type { Spec } from '../contracts/index.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qai-hash-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function specFrom(yaml: string, name = 'a.spec.yaml'): Spec {
  writeFileSync(join(dir, name), yaml, 'utf8');
  const result = loadSpec([name], { cwd: dir });
  if (isLoadFailure(result)) {
    throw new Error(`expected a successful load, got: ${result.error.message}`);
  }
  rmSync(join(dir, name));
  return result.spec;
}

const BASE = `
specVersion: "0.1"
name: "Invoicing app"
actors:
  - id: owner
    description: "Authenticated user in organization 1"
  - id: outsider
    description: "Authenticated user in organization 2"
entities:
  - name: Invoice
    ownedBy: Organization
    fields:
      - name: org_id
        type: string
      - name: notes
        type: string
        sensitive: true
requirements:
  - id: REQ-014
    statement: "A user can only view invoices belonging to their own organization"
    entities: [Invoice]
    tags: [access-control]
    accessRules:
      - actor: outsider
        action: read
        resource: Invoice
        condition: "Invoice.org_id != actor.org_id"
        effect: deny
`;

describe('formatting does not change the hash', () => {
  it('ignores comments', () => {
    const withComments = BASE.replace(
      'requirements:',
      '# the requirements, hand written\nrequirements:',
    );
    expect(hashSpec(specFrom(withComments))).toBe(hashSpec(specFrom(BASE)));
  });

  it('ignores key order', () => {
    const reordered = `
name: "Invoicing app"
specVersion: "0.1"
requirements:
  - statement: "A user can only view invoices belonging to their own organization"
    id: REQ-014
    tags: [access-control]
    entities: [Invoice]
    accessRules:
      - effect: deny
        actor: outsider
        condition: "Invoice.org_id != actor.org_id"
        resource: Invoice
        action: read
actors:
  - id: owner
    description: "Authenticated user in organization 1"
  - id: outsider
    description: "Authenticated user in organization 2"
entities:
  - name: Invoice
    ownedBy: Organization
    fields:
      - name: org_id
        type: string
      - name: notes
        type: string
        sensitive: true
`;
    expect(hashSpec(specFrom(reordered))).toBe(hashSpec(specFrom(BASE)));
  });

  it('ignores rewrapped whitespace inside a statement', () => {
    const rewrapped = BASE.replace(
      'statement: "A user can only view invoices belonging to their own organization"',
      'statement: >-\n      A user can only view invoices\n      belonging to their own organization',
    );
    expect(hashSpec(specFrom(rewrapped))).toBe(hashSpec(specFrom(BASE)));
  });

  it('ignores the declaration order of actors and entities', () => {
    const swapped = BASE.replace(
      `  - id: owner
    description: "Authenticated user in organization 1"
  - id: outsider
    description: "Authenticated user in organization 2"`,
      `  - id: outsider
    description: "Authenticated user in organization 2"
  - id: owner
    description: "Authenticated user in organization 1"`,
    );
    expect(hashSpec(specFrom(swapped))).toBe(hashSpec(specFrom(BASE)));
  });

  it('ignores a hand-written identifier that only restates the derived one', () => {
    const explicit = BASE.replace(
      '      - actor: outsider',
      '      - id: AR-014-01\n        actor: outsider',
    );
    expect(hashSpec(specFrom(explicit))).toBe(hashSpec(specFrom(BASE)));
  });

  it('ignores the file the spec was loaded from', () => {
    expect(hashSpec(specFrom(BASE, 'one.spec.yaml'))).toBe(
      hashSpec(specFrom(BASE, 'another.spec.yaml')),
    );
  });

  it('is stable across repeated hashing of the same spec', () => {
    const spec = specFrom(BASE);
    expect(hashSpec(spec)).toBe(hashSpec(spec));
  });
});

describe('a semantic change moves the hash', () => {
  const base = () => hashSpec(specFrom(BASE));

  it.each([
    ['a changed condition', ['!= actor.org_id', '== actor.org_id']],
    ['a changed effect', ['effect: deny', 'effect: allow']],
    ['a changed action', ['action: read', 'action: list']],
    ['a changed actor', ['actor: outsider', 'actor: owner']],
    ['a changed resource', ['resource: Invoice', 'resource: Organization']],
    ['a changed statement', ['their own organization', 'any organization']],
    ['a changed requirement id', ['REQ-014', 'REQ-015']],
    ['a changed specVersion', ['specVersion: "0.1"', 'specVersion: "0.2"']],
    ['a changed sensitive flag', ['sensitive: true', 'sensitive: false']],
    [
      'a changed field type',
      ['name: org_id\n        type: string', 'name: org_id\n        type: number'],
    ],
  ])('moves for %s', (_label, [from, to]) => {
    const changed = BASE.replace(from ?? '', to ?? '');
    expect(changed).not.toBe(BASE);
    expect(hashSpec(specFrom(changed))).not.toBe(base());
  });

  it('moves when a requirement is added', () => {
    const added = `${BASE}
  - id: REQ-015
    statement: "another requirement"
    accessRules:
      - actor: outsider
        action: list
        resource: Invoice
        effect: deny
`;
    expect(hashSpec(specFrom(added))).not.toBe(base());
  });

  it('moves when an access rule is removed', () => {
    const removed = BASE.replace(
      `    accessRules:
      - actor: outsider
        action: read
        resource: Invoice
        condition: "Invoice.org_id != actor.org_id"
        effect: deny
`,
      '',
    );
    expect(hashSpec(specFrom(removed))).not.toBe(base());
  });

  it('moves when two access rules swap places, since that renames them', () => {
    const twoRules = BASE.replace(
      `      - actor: outsider
        action: read
        resource: Invoice
        condition: "Invoice.org_id != actor.org_id"
        effect: deny
`,
      `      - actor: outsider
        action: read
        resource: Invoice
        effect: deny
      - actor: outsider
        action: list
        resource: Invoice
        effect: deny
`,
    );
    const swapped = BASE.replace(
      `      - actor: outsider
        action: read
        resource: Invoice
        condition: "Invoice.org_id != actor.org_id"
        effect: deny
`,
      `      - actor: outsider
        action: list
        resource: Invoice
        effect: deny
      - actor: outsider
        action: read
        resource: Invoice
        effect: deny
`,
    );
    expect(hashSpec(specFrom(twoRules))).not.toBe(hashSpec(specFrom(swapped)));
  });
});

describe('the hash format', () => {
  it('is sha256 prefixed, matching spec.hash in the RunResult contract', () => {
    expect(hashSpec(specFrom(BASE))).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });
});
