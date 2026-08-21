import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isLoadFailure, loadSpec, type LoadedSpec } from './load.ts';
import type { SpecError } from './diagnostics.ts';

/**
 * These write real files to a temporary directory rather than mocking the filesystem.
 * The loader's job includes glob resolution and read failures, and a mock that answers
 * every read successfully would not exercise either. Rule R9 is about the network;
 * a scratch directory is local.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qai-spec-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, contents: string): void {
  const path = join(dir, name);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}

function load(...paths: string[]): LoadedSpec {
  const result = loadSpec(paths.length > 0 ? paths : ['*.spec.yaml'], { cwd: dir });
  if (isLoadFailure(result)) {
    throw new Error(`expected a successful load, got: ${result.error.message}`);
  }
  return result;
}

function loadFailing(...paths: string[]): SpecError {
  const result = loadSpec(paths.length > 0 ? paths : ['*.spec.yaml'], { cwd: dir });
  if (!isLoadFailure(result)) {
    throw new Error('expected the load to fail, but it succeeded');
  }
  return result.error;
}

const LEDGER = `
specVersion: "0.1"
name: "Invoicing app"
actors:
  - id: owner
    description: "Authenticated user belonging to organization 1"
  - id: outsider
    description: "Authenticated user belonging to organization 2"
entities:
  - name: Invoice
    ownedBy: Organization
    fields:
      - name: org_id
        type: string
requirements:
  - id: REQ-014
    statement: "A user can only view invoices belonging to their own organization"
    entities: [Invoice]
    accessRules:
      - actor: outsider
        action: read
        resource: Invoice
        condition: "Invoice.org_id != actor.org_id"
        effect: deny
    acceptanceCriteria:
      - mode: deterministic
        given: "an invoice belonging to organization 2"
        when: "actor owner requests that invoice by id"
        then: "the response status is 403 or 404"
`;

describe('loading a single file', () => {
  it('produces a Spec matching the contract', () => {
    write('ledger.spec.yaml', LEDGER);
    const { spec } = load();

    expect(spec.name).toBe('Invoicing app');
    expect(spec.actors.map((actor) => actor.id)).toEqual(['owner', 'outsider']);
    expect(spec.requirements).toHaveLength(1);
  });

  it('resolves a glob', () => {
    write('a.spec.yaml', LEDGER);
    const { spec } = load('*.spec.yaml');
    expect(spec.requirements).toHaveLength(1);
  });

  it('reports an empty file rather than loading nothing', () => {
    write('empty.spec.yaml', '');
    expect(loadFailing().diagnostics[0]?.message).toContain('empty');
  });

  it('names the file when no path matches', () => {
    expect(loadFailing('nothing/*.yaml').message).toContain('no spec files matched');
  });

  it('reports malformed YAML with the file named', () => {
    write('broken.spec.yaml', 'specVersion: "0.1"\n  name: bad indent\n');
    const failure = loadFailing();
    expect(failure.diagnostics[0]?.file).toBe('broken.spec.yaml');
    expect(failure.diagnostics[0]?.message).toContain('YAML');
  });

  it('reports a schema violation with the YAML path and a reason', () => {
    write(
      'bad.spec.yaml',
      `
specVersion: "0.1"
name: "App"
requirements:
  - id: REQ-001
    statement: "s"
    accessRules:
      - actor: outsider
        action: purge
        resource: Invoice
        effect: deny
`,
    );
    const failure = loadFailing();
    const diagnostic = failure.diagnostics[0];

    expect(diagnostic?.file).toBe('bad.spec.yaml');
    expect(diagnostic?.path).toBe('requirements[0].accessRules[0].action');
    expect(diagnostic?.message).toBeTruthy();
  });
});

describe('identifier derivation', () => {
  it('derives absent rule and criterion ids from the requirement and ordinal', () => {
    write('ledger.spec.yaml', LEDGER);
    const { spec } = load();
    const requirement = spec.requirements[0];

    expect(requirement?.accessRules[0]?.id).toBe('AR-014-01');
    expect(requirement?.acceptanceCriteria[0]?.id).toBe('AC-014-01');
  });

  it('never renumbers a hand-written identifier', () => {
    write(
      'ledger.spec.yaml',
      `
specVersion: "0.1"
name: "App"
requirements:
  - id: REQ-014
    statement: "s"
    accessRules:
      - id: AR-014-07
        actor: outsider
        action: read
        resource: Invoice
        effect: deny
      - actor: outsider
        action: list
        resource: Invoice
        effect: deny
`,
    );
    const { spec } = load();
    const rules = spec.requirements[0]?.accessRules;

    expect(rules?.[0]?.id).toBe('AR-014-07');
    expect(rules?.[1]?.id).toBe('AR-014-02');
  });

  it('rejects a hand-written id that collides with another', () => {
    write(
      'ledger.spec.yaml',
      `
specVersion: "0.1"
name: "App"
requirements:
  - id: REQ-014
    statement: "s"
    accessRules:
      - id: AR-014-01
        actor: outsider
        action: read
        resource: Invoice
        effect: deny
      - id: AR-014-01
        actor: outsider
        action: list
        resource: Invoice
        effect: deny
`,
    );
    expect(loadFailing().diagnostics.some((d) => d.message.includes('more than once'))).toBe(true);
  });

  it('is stable across loads of the same content', () => {
    write('ledger.spec.yaml', LEDGER);
    const first = load().spec.requirements[0]?.accessRules[0]?.id;
    const second = load().spec.requirements[0]?.accessRules[0]?.id;
    expect(first).toBe(second);
  });
});

describe('conditions', () => {
  it('parses every condition and keys the AST by rule id', () => {
    write('ledger.spec.yaml', LEDGER);
    const { conditions } = load();

    const ast = conditions.get('AR-014-01');
    expect(ast?.comparisons[0]?.operator).toBe('!=');
  });

  it('reports a malformed condition naming the file, requirement, and offending text', () => {
    write(
      'ledger.spec.yaml',
      `
specVersion: "0.1"
name: "App"
requirements:
  - id: REQ-014
    statement: "s"
    accessRules:
      - actor: outsider
        action: read
        resource: Invoice
        condition: "Invoice.total_cents > 100"
        effect: deny
`,
    );
    const failure = loadFailing();
    const diagnostic = failure.diagnostics.find((d) => d.path.includes('condition'));

    expect(diagnostic?.file).toBe('ledger.spec.yaml');
    expect(diagnostic?.message).toContain('REQ-014');
    expect(diagnostic?.message).toContain('>');
  });

  it('does not silently skip a rule whose condition failed to parse', () => {
    write(
      'ledger.spec.yaml',
      `
specVersion: "0.1"
name: "App"
requirements:
  - id: REQ-014
    statement: "s"
    accessRules:
      - actor: outsider
        action: read
        resource: Invoice
        condition: "nonsense"
        effect: deny
`,
    );
    expect(loadFailing().diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });
});

describe('merging multiple files', () => {
  const BASE = `
specVersion: "0.1"
name: "App"
actors:
  - id: owner
    description: "d"
entities:
  - name: Invoice
    fields:
      - name: org_id
        type: string
requirements:
  - id: REQ-001
    statement: "s"
    accessRules:
      - actor: owner
        action: read
        resource: Invoice
        effect: allow
`;

  it('merges actors and entities by name', () => {
    write('a.spec.yaml', BASE);
    write(
      'b.spec.yaml',
      `
specVersion: "0.1"
name: "App"
actors:
  - id: owner
    description: "d"
requirements:
  - id: REQ-002
    statement: "s"
    accessRules:
      - actor: owner
        action: list
        resource: Invoice
        effect: allow
`,
    );

    const { spec } = load();
    expect(spec.actors).toHaveLength(1);
    expect(spec.requirements.map((r) => r.id)).toEqual(['REQ-001', 'REQ-002']);
  });

  it('names both files when a requirement id collides', () => {
    write('a.spec.yaml', BASE);
    write('b.spec.yaml', BASE);

    const failure = loadFailing();
    const diagnostic = failure.diagnostics.find((d) => d.message.includes('REQ-001'));

    expect(diagnostic?.message).toContain('a.spec.yaml');
    expect(diagnostic?.message).toContain('b.spec.yaml');
  });

  it('rejects a conflicting actor redefinition rather than taking the last write', () => {
    write('a.spec.yaml', BASE);
    write(
      'b.spec.yaml',
      `
specVersion: "0.1"
name: "App"
actors:
  - id: owner
    description: "something else"
requirements:
  - id: REQ-002
    statement: "s"
`,
    );

    const failure = loadFailing();
    expect(failure.diagnostics.some((d) => d.message.includes('defined differently'))).toBe(true);
  });

  it('accepts the same entity with its fields declared in a different order', () => {
    write(
      'a.spec.yaml',
      `
specVersion: "0.1"
name: "App"
entities:
  - name: Invoice
    fields:
      - name: org_id
        type: string
      - name: total_cents
        type: number
requirements:
  - id: REQ-001
    statement: "s"
`,
    );
    write(
      'b.spec.yaml',
      `
specVersion: "0.1"
name: "App"
entities:
  - name: Invoice
    fields:
      - name: total_cents
        type: number
      - name: org_id
        type: string
requirements:
  - id: REQ-002
    statement: "s"
`,
    );

    const { spec } = load();
    expect(spec.entities).toHaveLength(1);
    expect(spec.entities[0]?.fields.map((field) => field.name)).toEqual(['org_id', 'total_cents']);
  });

  it('still rejects an entity whose fields differ in more than order', () => {
    write('a.spec.yaml', BASE);
    write(
      'b.spec.yaml',
      `
specVersion: "0.1"
name: "App"
entities:
  - name: Invoice
    fields:
      - name: org_id
        type: number
requirements:
  - id: REQ-002
    statement: "s"
`,
    );

    expect(loadFailing().diagnostics.some((d) => d.message.includes('defined differently'))).toBe(
      true,
    );
  });

  it('rejects a conflicting entity redefinition', () => {
    write('a.spec.yaml', BASE);
    write(
      'b.spec.yaml',
      `
specVersion: "0.1"
name: "App"
entities:
  - name: Invoice
    fields:
      - name: total_cents
        type: number
requirements:
  - id: REQ-002
    statement: "s"
`,
    );

    expect(loadFailing().diagnostics.some((d) => d.message.includes('defined differently'))).toBe(
      true,
    );
  });

  it('rejects a specVersion mismatch across files', () => {
    write('a.spec.yaml', BASE);
    write('b.spec.yaml', BASE.replace('"0.1"', '"0.2"').replace('REQ-001', 'REQ-002'));

    expect(loadFailing().diagnostics.some((d) => d.path === 'specVersion')).toBe(true);
  });

  it('merges in sorted file order, so results do not depend on the filesystem', () => {
    write('z.spec.yaml', BASE.replace('REQ-001', 'REQ-009'));
    write('a.spec.yaml', BASE);

    const { spec } = load();
    expect(spec.requirements.map((r) => r.id)).toEqual(['REQ-001', 'REQ-009']);
  });
});

describe('warnings that are not errors', () => {
  it('warns about an actor no rule references, and still loads', () => {
    write(
      'ledger.spec.yaml',
      `${LEDGER}
  - id: REQ-015
    statement: "another"
    accessRules:
      - actor: outsider
        action: list
        resource: Invoice
        effect: deny
`,
    );
    const { diagnostics } = load();

    const actorWarning = diagnostics.find((d) => d.message.includes('"owner"'));
    expect(actorWarning?.severity).toBe('warning');
  });

  it('warns about a requirement with no checks and names the reason it will carry', () => {
    write(
      'ledger.spec.yaml',
      `
specVersion: "0.1"
name: "App"
requirements:
  - id: REQ-021
    statement: "Every write to an invoice is recorded in an audit log"
`,
    );
    const { diagnostics } = load();
    const warn = diagnostics.find((d) => d.message.includes('REQ-021'));

    expect(warn?.severity).toBe('warning');
    expect(warn?.message).toContain('no-checks-defined');
  });

  it('warns about an entity no requirement references', () => {
    write(
      'ledger.spec.yaml',
      `
specVersion: "0.1"
name: "App"
entities:
  - name: AuditLog
requirements:
  - id: REQ-001
    statement: "s"
    accessRules:
      - actor: owner
        action: read
        resource: Invoice
        effect: allow
`,
    );
    const { diagnostics } = load();
    expect(diagnostics.some((d) => d.message.includes('AuditLog'))).toBe(true);
  });
});

describe('paths, on every platform', () => {
  it('loads a spec named by an absolute path', () => {
    // Found at M8.4 by handing `qai validate` an absolute path. The read used to join
    // cwd and the file with a slash, which on Windows produced a path carrying two
    // drive letters and failed naming something nobody wrote.
    write('a.spec.yaml', LEDGER);

    const result = loadSpec([join(dir, 'a.spec.yaml')], { cwd: dir });

    expect(isLoadFailure(result)).toBe(false);
    if (isLoadFailure(result)) throw new Error('unreachable');
    expect(result.spec.name).toBe('Invoicing app');
  });

  it('reports the files it actually read, not the patterns it was given', () => {
    write('a.spec.yaml', LEDGER);
    write('b.spec.yaml', LEDGER.replace(/REQ-014/g, 'REQ-015').replace(/AR-014/g, 'AR-015'));

    const loaded = load('*.spec.yaml');

    expect([...loaded.files].sort()).toStrictEqual(['a.spec.yaml', 'b.spec.yaml']);
  });
});
