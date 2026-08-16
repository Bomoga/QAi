import { describe, expect, it } from 'vitest';

import { parseCondition, type ConditionAst } from '../../spec/condition.ts';
import { evaluateCondition, selectCandidate, type CandidateRecord } from './evaluate.ts';

function ast(source: string): ConditionAst {
  const parsed = parseCondition(source);
  if (parsed.kind === 'error') throw new Error(`could not parse "${source}": ${parsed.message}`);
  return parsed;
}

const OUTSIDER = { org_id: 'org-2' };
const OWN_INVOICE = { org_id: 'org-2', status: 'sent' };
const FOREIGN_INVOICE = { org_id: 'org-1', status: 'draft' };

function scope(record: Record<string, string>, actor = OUTSIDER) {
  return { record, actor, entity: 'Invoice' };
}

describe('the condition the fixture depends on', () => {
  const condition = ast('Invoice.org_id != actor.org_id');

  it('holds for an invoice belonging to another organization', () => {
    expect(evaluateCondition(condition, scope(FOREIGN_INVOICE))).toBe('true');
  });

  it('does not hold for the actor own invoice', () => {
    expect(evaluateCondition(condition, scope(OWN_INVOICE))).toBe('false');
  });
});

describe('operators', () => {
  it.each([
    ['Invoice.org_id == actor.org_id', OWN_INVOICE, 'true'],
    ['Invoice.org_id == actor.org_id', FOREIGN_INVOICE, 'false'],
    ['Invoice.org_id != actor.org_id', FOREIGN_INVOICE, 'true'],
    ['Invoice.status in ["draft", "void"]', FOREIGN_INVOICE, 'true'],
    ['Invoice.status in ["void"]', FOREIGN_INVOICE, 'false'],
    ['Invoice.status not in ["void"]', FOREIGN_INVOICE, 'true'],
    ['Invoice.status not in ["draft"]', FOREIGN_INVOICE, 'false'],
    ['Invoice.org_id == "org-1"', FOREIGN_INVOICE, 'true'],
  ])('evaluates %s', (source, record, expected) => {
    expect(evaluateCondition(ast(source), scope(record))).toBe(expected);
  });

  it('compares a number and a string loosely, so org_id 1 matches "1"', () => {
    expect(evaluateCondition(ast('Invoice.org_id == 1'), scope({ org_id: '1' }))).toBe('true');
  });
});

describe('conjunction', () => {
  it('is true only when every comparison holds', () => {
    const condition = ast('Invoice.org_id != actor.org_id and Invoice.status == "draft"');
    expect(evaluateCondition(condition, scope(FOREIGN_INVOICE))).toBe('true');
  });

  it('is false when any comparison fails', () => {
    const condition = ast('Invoice.org_id != actor.org_id and Invoice.status == "sent"');
    expect(evaluateCondition(condition, scope(FOREIGN_INVOICE))).toBe('false');
  });

  it('is false even when another term is unknown, since a false term settles it', () => {
    const condition = ast('Invoice.status == "sent" and Invoice.missing == "x"');
    expect(evaluateCondition(condition, scope(FOREIGN_INVOICE))).toBe('false');
  });
});

describe('what cannot be resolved is unknown, not false', () => {
  it('reports a field the record does not carry as unknown', () => {
    expect(evaluateCondition(ast('Invoice.missing == "x"'), scope(FOREIGN_INVOICE))).toBe(
      'unknown',
    );
  });

  it('reports an actor attribute that was never configured as unknown', () => {
    const condition = ast('Invoice.org_id != actor.team_id');
    expect(evaluateCondition(condition, scope(FOREIGN_INVOICE))).toBe('unknown');
  });

  it('reports a reference to a different entity as unknown', () => {
    const condition = ast('Organization.id == actor.org_id');
    expect(evaluateCondition(condition, scope(FOREIGN_INVOICE))).toBe('unknown');
  });

  it('matches the entity name case insensitively', () => {
    expect(evaluateCondition(ast('invoice.org_id == "org-1"'), scope(FOREIGN_INVOICE))).toBe(
      'true',
    );
  });

  it('reports a list compared with an equality operator as unknown', () => {
    const condition = ast('Invoice.status == ["draft"]');
    expect(evaluateCondition(condition, scope(FOREIGN_INVOICE))).toBe('unknown');
  });
});

describe('selecting the record a deny check should act on', () => {
  const candidates: CandidateRecord[] = [
    { id: 'INV-2001', attributes: { org_id: 'org-2' } },
    { id: 'INV-1001', attributes: { org_id: 'org-1' } },
  ];

  it('picks the record that belongs to someone else', () => {
    const selection = selectCandidate(
      candidates,
      ast('Invoice.org_id != actor.org_id'),
      'Invoice',
      OUTSIDER,
    );
    expect(selection.matched?.id).toBe('INV-1001');
  });

  it('picks the actor own record for an allow rule', () => {
    const selection = selectCandidate(
      candidates,
      ast('Invoice.org_id == actor.org_id'),
      'Invoice',
      OUTSIDER,
    );
    expect(selection.matched?.id).toBe('INV-2001');
  });

  it('reports that nothing was seeded rather than inventing an id', () => {
    const selection = selectCandidate(
      [],
      ast('Invoice.org_id != actor.org_id'),
      'Invoice',
      OUTSIDER,
    );
    expect(selection.matched).toBeUndefined();
    expect(selection.reason).toBe('no-candidates');
  });

  it('reports that no record matched when the condition is decidable and false', () => {
    const ownOnly: CandidateRecord[] = [{ id: 'INV-2001', attributes: { org_id: 'org-2' } }];
    const selection = selectCandidate(
      ownOnly,
      ast('Invoice.org_id != actor.org_id'),
      'Invoice',
      OUTSIDER,
    );
    expect(selection.reason).toBe('none-matched');
  });

  it('refuses to fall through to an arbitrary record when ownership is undecidable', () => {
    const selection = selectCandidate(
      candidates,
      ast('Invoice.org_id != actor.team_id'),
      'Invoice',
      OUTSIDER,
    );

    expect(selection.matched).toBeUndefined();
    expect(selection.reason).toBe('undecidable');
  });

  it('takes any seeded record when the rule states no condition', () => {
    const selection = selectCandidate(candidates, undefined, 'Invoice', OUTSIDER);
    expect(selection.matched?.id).toBe('INV-2001');
  });

  it('is stable, picking the same record for the same inputs', () => {
    const condition = ast('Invoice.org_id != actor.org_id');
    const first = selectCandidate(candidates, condition, 'Invoice', OUTSIDER);
    const second = selectCandidate(candidates, condition, 'Invoice', OUTSIDER);
    expect(first.matched?.id).toBe(second.matched?.id);
  });
});

describe('evaluation is not execution', () => {
  it('treats a reference that looks like code as an unknown attribute', () => {
    const condition = ast('Invoice.constructor == "x"');
    expect(evaluateCondition(condition, scope(FOREIGN_INVOICE))).toBe('unknown');
  });

  it('does not read inherited properties from the record object', () => {
    const condition = ast('Invoice.toString == "x"');
    expect(evaluateCondition(condition, scope(FOREIGN_INVOICE))).toBe('unknown');
  });
});
