import { describe, expect, it } from 'vitest';

import {
  isConditionParseError,
  parseCondition,
  type ConditionAst,
  type ConditionParseError,
} from './condition.ts';

function parseOk(input: string): ConditionAst {
  const result = parseCondition(input);
  if (isConditionParseError(result)) {
    throw new Error(`expected "${input}" to parse, got: ${result.message}`);
  }
  return result;
}

function parseErr(input: string): ConditionParseError {
  const result = parseCondition(input);
  if (!isConditionParseError(result)) {
    throw new Error(`expected "${input}" to be rejected, but it parsed`);
  }
  return result;
}

describe('the condition the fixture spec depends on', () => {
  it('parses the example from 03-CONTRACTS.md', () => {
    const ast = parseOk('Invoice.org_id != actor.org_id');

    expect(ast.comparisons).toHaveLength(1);
    expect(ast.comparisons[0]).toEqual({
      kind: 'comparison',
      operator: '!=',
      left: { kind: 'entityRef', entity: 'Invoice', property: 'org_id' },
      right: { kind: 'actorRef', property: 'org_id' },
    });
  });
});

describe('operators', () => {
  it.each([
    ['Invoice.org_id == actor.org_id', '=='],
    ['Invoice.org_id != actor.org_id', '!='],
    ['Invoice.status in ["draft", "sent"]', 'in'],
    ['Invoice.status not in ["void"]', 'not in'],
  ])('parses %s', (input, operator) => {
    expect(parseOk(input).comparisons[0]?.operator).toBe(operator);
  });

  it.each(['Invoice.total_cents > 100', 'Invoice.total_cents >= 100', 'Invoice.org_id = actor.x'])(
    'rejects the out of grammar operator in %s',
    (input) => {
      expect(parseErr(input).message).toBeTruthy();
    },
  );

  it('names the offending text when the operator is unsupported', () => {
    const error = parseErr('Invoice.total_cents > 100');
    expect(error.offendingText).toBe('>');
  });

  it('rejects "not" that is not followed by "in"', () => {
    const error = parseErr('Invoice.status not "void"');
    expect(error.message).toContain('expected "in" after "not"');
  });
});

describe('conjunction', () => {
  it.each(['and', '&&'])('joins comparisons with %s', (keyword) => {
    const ast = parseOk(`Invoice.org_id != actor.org_id ${keyword} Invoice.status == "sent"`);
    expect(ast.comparisons).toHaveLength(2);
  });

  it('chains more than two comparisons', () => {
    const ast = parseOk(
      'Invoice.org_id != actor.org_id and Invoice.status == "sent" and Invoice.total_cents == 100',
    );
    expect(ast.comparisons).toHaveLength(3);
  });

  it('presents a single comparison as a conjunction of one', () => {
    expect(parseOk('actor.role == "admin"').kind).toBe('and');
  });

  it('rejects a trailing conjunction', () => {
    expect(parseErr('Invoice.org_id != actor.org_id and').message).toBeTruthy();
  });

  it('rejects disjunction, which the grammar does not include', () => {
    expect(parseErr('Invoice.org_id != actor.org_id || Invoice.status == "sent"')).toBeTruthy();
  });
});

describe('operands', () => {
  it('parses an actor reference', () => {
    expect(parseOk('actor.org_id == "org-1"').comparisons[0]?.left).toEqual({
      kind: 'actorRef',
      property: 'org_id',
    });
  });

  it('parses an entity reference', () => {
    expect(parseOk('Invoice.org_id == "org-1"').comparisons[0]?.left).toEqual({
      kind: 'entityRef',
      entity: 'Invoice',
      property: 'org_id',
    });
  });

  it.each([
    ['actor.role == "admin"', 'admin'],
    ["actor.role == 'admin'", 'admin'],
  ])('parses the string literal in %s', (input, value) => {
    expect(parseOk(input).comparisons[0]?.right).toEqual({ kind: 'literal', value });
  });

  it.each([
    ['Invoice.total_cents == 125000', 125000],
    ['Invoice.total_cents == -1', -1],
    ['Invoice.rate == 1.5', 1.5],
  ])('parses the number literal in %s', (input, value) => {
    expect(parseOk(input).comparisons[0]?.right).toEqual({ kind: 'literal', value });
  });

  it('parses a null literal', () => {
    expect(parseOk('Invoice.notes == null').comparisons[0]?.right).toEqual({
      kind: 'literal',
      value: null,
    });
  });

  it('parses a list literal', () => {
    expect(parseOk('Invoice.status in ["draft", "sent"]').comparisons[0]?.right).toEqual({
      kind: 'list',
      items: [
        { kind: 'literal', value: 'draft' },
        { kind: 'literal', value: 'sent' },
      ],
    });
  });

  it('parses an empty list', () => {
    expect(parseOk('Invoice.status in []').comparisons[0]?.right).toEqual({
      kind: 'list',
      items: [],
    });
  });

  it('allows a literal on the left, since the grammar does not fix operand order', () => {
    expect(parseOk('"org-1" == actor.org_id').comparisons[0]?.left).toEqual({
      kind: 'literal',
      value: 'org-1',
    });
  });
});

describe('rejections', () => {
  it('rejects an empty condition', () => {
    expect(parseErr('').message).toContain('empty');
    expect(parseErr('   ').message).toContain('empty');
  });

  it('rejects a bare identifier rather than treating it as a string', () => {
    const error = parseErr('Invoice.org_id == admin');
    expect(error.message).toContain('bare identifier');
    expect(error.offendingText).toBe('admin');
  });

  it('rejects a reference with no property', () => {
    expect(parseErr('actor == "admin"').message).toContain('bare identifier');
  });

  it('rejects a dotted path deeper than two segments', () => {
    expect(parseErr('actor.org.id == "org-1"').message).toBeTruthy();
  });

  it('rejects an unterminated string', () => {
    const error = parseErr('actor.role == "admin');
    expect(error.message).toContain('unterminated string');
  });

  it('rejects an unbalanced list', () => {
    expect(parseErr('Invoice.status in ["draft"').message).toBeTruthy();
  });

  it('rejects a reference inside a list', () => {
    const error = parseErr('Invoice.status in [actor.role]');
    expect(error.message).toContain('string, number, or null');
  });

  it('rejects a comparison with a missing right operand', () => {
    expect(parseErr('Invoice.org_id ==').message).toBeTruthy();
  });

  it('rejects a comparison with no operator', () => {
    expect(parseErr('Invoice.org_id actor.org_id').message).toBeTruthy();
  });

  it.each(['%', '$', '#', '@'])('rejects the unexpected character %s', (char) => {
    const error = parseErr(`Invoice.org_id == ${char}`);
    expect(error.offendingText).toBe(char);
  });

  it('reports an offset into the input so a caller can point at a column', () => {
    const error = parseErr('Invoice.total_cents > 100');
    expect(error.offset).toBe('Invoice.total_cents '.length);
  });
});

describe('parsing is not evaluation', () => {
  it('treats a condition that looks like code as data', () => {
    const error = parseErr('process.exit(1) == 1');
    expect(error.message).toBeTruthy();
  });

  it('does not resolve references, only records them', () => {
    const ast = parseOk('Ghost.nonexistent == actor.alsoNonexistent');
    expect(ast.comparisons[0]?.left).toEqual({
      kind: 'entityRef',
      entity: 'Ghost',
      property: 'nonexistent',
    });
  });
});
