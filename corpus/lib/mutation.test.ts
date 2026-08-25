import { describe, expect, it } from 'vitest';

import { applyEdit, judge, type Mutation } from './mutation.ts';

const REPAIR: Mutation = {
  id: 'example',
  app: 'p0-example',
  description: 'an example repair',
  intent: 'repair',
  file: 'app/index.ts',
  find: 'return true;',
  replace: 'return owns(person, record);',
  expect: ['CHK-aaaa'],
};

const BREAK: Mutation = { ...REPAIR, intent: 'break' };

const set = (...ids: string[]): ReadonlySet<string> => new Set(ids);

describe('applyEdit', () => {
  it('replaces the one occurrence it found', () => {
    expect(applyEdit('function may() { return true; }', REPAIR)).toBe(
      'function may() { return owns(person, record); }',
    );
  });

  it('refuses text it cannot find, because the application moved under the table', () => {
    expect(() => applyEdit('function may() { return false; }', REPAIR)).toThrow(/stale/u);
  });

  it('refuses an edit that would match twice, rather than picking one', () => {
    // A best effort here would edit a line nobody chose, and report a finding movement
    // about it as though it were the mutation under test.
    expect(() => applyEdit('return true; return true;', REPAIR)).toThrow(/more than once/u);
  });
});

describe('judge, repairing', () => {
  it('is satisfied when the listed finding stops', () => {
    expect(judge(set('CHK-aaaa'), set(), REPAIR)).toStrictEqual({
      problems: [],
      collateral: [],
    });
  });

  it('reports a finding that survived the repair of the defect it names', () => {
    const { problems } = judge(set('CHK-aaaa'), set('CHK-aaaa'), REPAIR);
    expect(problems).toStrictEqual(['CHK-aaaa survived the repair of the defect it names']);
  });

  it('reports a stale table when the finding was never produced', () => {
    // Without this the mutation passes while proving nothing, which is the same shape as
    // a test asserting on a condition it never established.
    const { problems } = judge(set(), set(), REPAIR);
    expect(problems).toStrictEqual([
      'CHK-aaaa is not produced before the repair, so the table is stale',
    ]);
  });

  it('names findings that moved and were not listed, without failing on them', () => {
    const { problems, collateral } = judge(set('CHK-aaaa', 'CHK-bbbb'), set(), REPAIR);
    expect(problems).toStrictEqual([]);
    expect(collateral).toStrictEqual(['CHK-bbbb']);
  });

  it('counts a finding that appeared as collateral too', () => {
    const { collateral } = judge(set('CHK-aaaa'), set('CHK-cccc'), REPAIR);
    expect(collateral).toStrictEqual(['CHK-cccc']);
  });
});

describe('judge, breaking', () => {
  it('is satisfied when the listed finding starts', () => {
    expect(judge(set(), set('CHK-aaaa'), BREAK)).toStrictEqual({ problems: [], collateral: [] });
  });

  it('reports a break that produced nothing', () => {
    const { problems } = judge(set(), set(), BREAK);
    expect(problems).toStrictEqual([
      'CHK-aaaa was not produced after the break that should cause it',
    ]);
  });

  it('reports a stale table when the finding was already there', () => {
    const { problems } = judge(set('CHK-aaaa'), set('CHK-aaaa'), BREAK);
    expect(problems).toStrictEqual([
      'CHK-aaaa is already produced before the break, so the table is stale',
    ]);
  });
});
