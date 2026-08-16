import { describe, expect, it } from 'vitest';

import {
  AccessRuleSchema,
  AcceptanceCriterionSchema,
  EntitySchema,
  RequirementSchema,
  SpecSchema,
} from './spec.ts';

/**
 * The canonical example from section 1 of 03-CONTRACTS.md, verbatim. If this stops
 * parsing, either the schema drifted from the contract or the contract changed without
 * this file being updated in the same commit. Both are the change protocol failing.
 */
const CONTRACT_EXAMPLE = {
  specVersion: '0.1',
  name: 'Invoicing app',
  actors: [
    { id: 'owner', description: 'Authenticated user belonging to organization 1' },
    { id: 'outsider', description: 'Authenticated user belonging to organization 2' },
  ],
  entities: [
    {
      name: 'Invoice',
      ownedBy: 'Organization',
      fields: [
        { name: 'org_id', type: 'string' },
        { name: 'total_cents', type: 'number' },
        { name: 'notes', type: 'string', sensitive: true },
      ],
    },
  ],
  requirements: [
    {
      id: 'REQ-014',
      statement: 'A user can only view invoices belonging to their own organization',
      entities: ['Invoice', 'Organization'],
      fields: ['Invoice.org_id'],
      tags: ['access-control'],
      accessRules: [
        {
          id: 'AR-014-01',
          actor: 'outsider',
          action: 'read',
          resource: 'Invoice',
          condition: 'Invoice.org_id != actor.org_id',
          effect: 'deny',
        },
      ],
      acceptanceCriteria: [
        {
          id: 'AC-014-01',
          mode: 'deterministic',
          given: 'an invoice belonging to organization 2',
          when: 'actor owner requests that invoice by id',
          then: 'the response status is 403 or 404 and the body contains no Invoice fields',
        },
      ],
    },
  ],
};

describe('SpecSchema', () => {
  it('accepts the example in 03-CONTRACTS.md unchanged', () => {
    const result = SpecSchema.safeParse(CONTRACT_EXAMPLE);
    expect(result.success).toBe(true);
  });

  it('preserves field names exactly as the contract writes them', () => {
    const spec = SpecSchema.parse(CONTRACT_EXAMPLE);
    const requirement = spec.requirements[0];
    const rule = requirement?.accessRules[0];

    expect(requirement?.id).toBe('REQ-014');
    expect(rule?.condition).toBe('Invoice.org_id != actor.org_id');
    expect(spec.entities[0]?.fields[2]?.sensitive).toBe(true);
  });

  it('requires specVersion and name', () => {
    expect(SpecSchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(SpecSchema.safeParse({ specVersion: '0.1' }).success).toBe(false);
  });

  it('defaults the collections so a minimal spec still has a usable shape', () => {
    const spec = SpecSchema.parse({ specVersion: '0.1', name: 'Empty' });
    expect(spec.actors).toEqual([]);
    expect(spec.entities).toEqual([]);
    expect(spec.requirements).toEqual([]);
  });

  it('rejects a key it does not know rather than dropping it', () => {
    const typo = {
      ...CONTRACT_EXAMPLE,
      requirements: [{ ...CONTRACT_EXAMPLE.requirements[0], acceptanceCriterion: [] }],
    };
    expect(SpecSchema.safeParse(typo).success).toBe(false);
  });
});

describe('closed enums', () => {
  const rule = {
    actor: 'outsider',
    action: 'read',
    resource: 'Invoice',
    effect: 'deny',
  };

  it.each(['read', 'create', 'update', 'delete', 'list'])('accepts action %s', (action) => {
    expect(AccessRuleSchema.safeParse({ ...rule, action }).success).toBe(true);
  });

  it.each(['write', 'READ', 'patch', ''])('rejects action %s', (action) => {
    expect(AccessRuleSchema.safeParse({ ...rule, action }).success).toBe(false);
  });

  it.each(['allow', 'deny'])('accepts effect %s', (effect) => {
    expect(AccessRuleSchema.safeParse({ ...rule, effect }).success).toBe(true);
  });

  it.each(['forbid', 'Deny', 'permit'])('rejects effect %s', (effect) => {
    expect(AccessRuleSchema.safeParse({ ...rule, effect }).success).toBe(false);
  });

  const criterion = { given: 'g', when: 'w', then: 't' };

  it.each(['deterministic', 'fuzzy'])('accepts mode %s', (mode) => {
    expect(AcceptanceCriterionSchema.safeParse({ ...criterion, mode }).success).toBe(true);
  });

  it.each(['heuristic', 'Deterministic', 'manual'])('rejects mode %s', (mode) => {
    expect(AcceptanceCriterionSchema.safeParse({ ...criterion, mode }).success).toBe(false);
  });
});

describe('identifier shapes', () => {
  it.each(['REQ-014', 'REQ-invoice-read', 'REQ-1'])('accepts requirement id %s', (id) => {
    const requirement = { id, statement: 'a statement' };
    expect(RequirementSchema.safeParse(requirement).success).toBe(true);
  });

  it.each(['014', 'req-014', 'AR-014', 'REQ '])('rejects requirement id %s', (id) => {
    const requirement = { id, statement: 'a statement' };
    expect(RequirementSchema.safeParse(requirement).success).toBe(false);
  });

  it('leaves rule and criterion ids optional, since M1.5 derives them', () => {
    const rule = { actor: 'outsider', action: 'read', resource: 'Invoice', effect: 'deny' };
    expect(AccessRuleSchema.safeParse(rule).success).toBe(true);

    const criterion = { mode: 'deterministic', given: 'g', when: 'w', then: 't' };
    expect(AcceptanceCriterionSchema.safeParse(criterion).success).toBe(true);
  });

  it('still rejects a hand-written rule id with the wrong prefix', () => {
    const rule = {
      id: 'AC-014-01',
      actor: 'outsider',
      action: 'read',
      resource: 'Invoice',
      effect: 'deny',
    };
    expect(AccessRuleSchema.safeParse(rule).success).toBe(false);
  });
});

describe('requirements with no checks', () => {
  it('loads successfully, so the coverage gap is visible rather than hidden', () => {
    const requirement = RequirementSchema.parse({
      id: 'REQ-021',
      statement: 'Every write to an invoice is recorded in an audit log',
    });
    expect(requirement.accessRules).toEqual([]);
    expect(requirement.acceptanceCriteria).toEqual([]);
  });
});

describe('entities', () => {
  it('treats ownedBy as optional and fields as defaulting to empty', () => {
    const entity = EntitySchema.parse({ name: 'Organization' });
    expect(entity.fields).toEqual([]);
    expect(entity.ownedBy).toBeUndefined();
  });

  it('rejects a field with no declared type', () => {
    const entity = { name: 'Invoice', fields: [{ name: 'org_id' }] };
    expect(EntitySchema.safeParse(entity).success).toBe(false);
  });
});
