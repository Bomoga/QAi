import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FIXTURE_SPEC_PATH } from '../../scripts/validate-fixture-spec.ts';
import { isLoadFailure, loadSpec, type LoadedSpec } from './load.ts';

/**
 * The Definition of Done in modules/M1-spec.md requires that the fixture spec loads
 * with zero errors and the expected requirement count. It is also the only spec in
 * the repository written the way a user would write one, so it is the first place a
 * schema or grammar change will show up as something an author cannot express.
 */

const ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');

function loadFixture(): LoadedSpec {
  const result = loadSpec([FIXTURE_SPEC_PATH], { cwd: ROOT });
  if (isLoadFailure(result)) {
    throw new Error(`fixture spec failed to load: ${result.error.message}`);
  }
  return result;
}

describe('fixtures/ledger/spec/ledger.spec.yaml', () => {
  it('loads with zero errors', () => {
    const { diagnostics } = loadFixture();
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('has the requirement count 06-TESTING.md asks for', () => {
    expect(loadFixture().spec.requirements).toHaveLength(15);
  });

  it('declares the two actors cross-organization access needs, plus the two refusal cases', () => {
    const ids = loadFixture().spec.actors.map((actor) => actor.id);

    // `anonymous` presents nothing and `impostor` presents a credential belonging to
    // nobody. A target can refuse the first and accept the second, so they are two
    // actors rather than one.
    expect(ids).toEqual(['owner', 'outsider', 'anonymous', 'impostor']);
  });

  it('parses every condition it declares', () => {
    const { spec, conditions } = loadFixture();
    const withCondition = spec.requirements
      .flatMap((requirement) => requirement.accessRules)
      .filter((rule) => rule.condition !== undefined);

    expect(withCondition.length).toBeGreaterThan(0);
    for (const rule of withCondition) {
      expect(conditions.get(rule.id ?? '')).toBeDefined();
    }
  });

  it('covers every defect in the catalog', () => {
    const { spec } = loadFixture();
    const byId = new Map(spec.requirements.map((requirement) => [requirement.id, requirement]));

    // D1, cross-organization read, the defect S3 must find.
    expect(byId.get('REQ-001')?.accessRules[0]?.effect).toBe('deny');
    expect(byId.get('REQ-001')?.accessRules[0]?.action).toBe('read');

    // D2, unscoped list.
    expect(byId.get('REQ-002')?.accessRules[0]?.action).toBe('list');

    // D3, unauthenticated mutation.
    expect(byId.get('REQ-003')?.accessRules.map((rule) => rule.action)).toEqual([
      'update',
      'delete',
    ]);

    // D4, a sensitive field returned where it should be omitted.
    expect(byId.get('REQ-004')?.fields).toContain('Invoice.notes');

    // D5, the undeclared debug endpoint: nothing declares it, and REQ-005 says so.
    expect(byId.get('REQ-005')?.statement).toContain('no administrative or debug endpoints');

    // D6, an entity specified and never implemented.
    expect(spec.entities.map((entity) => entity.name)).toContain('AuditLog');

    // D7, a requirement with no checks at all.
    const noChecks = byId.get('REQ-007');
    expect(noChecks?.accessRules).toEqual([]);
    expect(noChecks?.acceptanceCriteria).toEqual([]);
  });

  it('covers both negative controls', () => {
    const { spec } = loadFixture();
    const byId = new Map(spec.requirements.map((requirement) => [requirement.id, requirement]));

    // N1, owner reads own invoice: an allow rule, so a finding here is a false positive.
    expect(byId.get('REQ-008')?.accessRules[0]?.effect).toBe('allow');
    expect(byId.get('REQ-008')?.accessRules[0]?.actor).toBe('owner');

    // N2, cross-organization write already refused.
    expect(byId.get('REQ-009')?.accessRules[0]?.action).toBe('update');
    expect(byId.get('REQ-009')?.accessRules[0]?.effect).toBe('deny');
  });

  it('warns about the requirement with no checks and nothing else', () => {
    const { diagnostics } = loadFixture();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe('warning');
    expect(diagnostics[0]?.message).toContain('REQ-007');
    expect(diagnostics[0]?.message).toContain('no-checks-defined');
  });

  it('marks the fields redaction has to protect', () => {
    const { spec } = loadFixture();
    const sensitive = spec.entities.flatMap((entity) =>
      entity.fields
        .filter((field) => field.sensitive === true)
        .map((f) => `${entity.name}.${f.name}`),
    );
    expect(sensitive).toContain('Invoice.notes');
    expect(sensitive).toContain('User.token');
  });

  it('hashes stably across loads', () => {
    expect(loadFixture().hash).toBe(loadFixture().hash);
  });
});
