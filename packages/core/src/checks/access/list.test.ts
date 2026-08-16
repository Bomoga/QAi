import { describe, expect, it } from 'vitest';

import { parseCondition, type ConditionAst } from '../../spec/condition.ts';
import type { RequestOutcome } from '../../target/request.ts';
import { assessDenyListOutcome, extractRows } from './list.ts';

function ast(source: string): ConditionAst {
  const parsed = parseCondition(source);
  if (parsed.kind === 'error') throw new Error(parsed.message);
  return parsed;
}

const FOREIGN = ast('Invoice.org_id != actor.org_id');
const OUTSIDER = { org_id: 'org-2' };

function responseWith(body: string, status = 200): RequestOutcome {
  return {
    kind: 'response',
    response: { status, headers: {}, body, truncated: false, durationMs: 1 },
  };
}

function assess(body: string, status = 200, condition: ConditionAst | undefined = FOREIGN) {
  return assessDenyListOutcome({
    outcome: responseWith(body, status),
    condition,
    entity: 'Invoice',
    actorAttributes: OUTSIDER,
  });
}

describe('Q5: the assertion is the absence of foreign rows', () => {
  it('fails when a row belongs to another owner', () => {
    const body = JSON.stringify([
      { id: 'INV-2001', org_id: 'org-2' },
      { id: 'INV-1001', org_id: 'org-1' },
    ]);
    const assessment = assess(body);

    expect(assessment.verdict).toBe('fail');
    expect(assessment.reason).toBe('foreign-rows-returned');
    expect(assessment.foreignRowCount).toBe(1);
    expect(assessment.foreignRowIds).toEqual(['INV-1001']);
    expect(assessment.totalRows).toBe(2);
  });

  it('passes when rows are present and none are foreign', () => {
    const body = JSON.stringify([{ id: 'INV-2001', org_id: 'org-2' }]);
    const assessment = assess(body);

    expect(assessment.verdict).toBe('pass');
    expect(assessment.reason).toBe('no-foreign-rows');
    expect(assessment.totalRows).toBe(1);
  });

  it('is inconclusive on an empty list, never a pass', () => {
    for (const body of ['[]', '{"invoices":[]}']) {
      const assessment = assess(body);
      expect(assessment.verdict).toBe('inconclusive');
      expect(assessment.reason).toBe('no-rows-returned');
    }
  });

  it('names every foreign row, so a finding can point at them', () => {
    const body = JSON.stringify([
      { id: 'INV-1001', org_id: 'org-1' },
      { id: 'INV-1002', org_id: 'org-1' },
      { id: 'INV-2001', org_id: 'org-2' },
    ]);
    const assessment = assess(body);

    expect(assessment.foreignRowIds).toEqual(['INV-1001', 'INV-1002']);
    expect(assessment.foreignRowCount).toBe(2);
  });

  it('falls back to a positional label when a row has no id', () => {
    const body = JSON.stringify([{ org_id: 'org-1' }]);
    expect(assess(body).foreignRowIds).toEqual(['row 0']);
  });
});

describe('what cannot be judged is inconclusive', () => {
  it('is inconclusive when ownership cannot be established for a row', () => {
    const body = JSON.stringify([{ id: 'INV-2001', org_id: 'org-2' }, { id: 'INV-3001' }]);
    const assessment = assess(body);

    expect(assessment.verdict).toBe('inconclusive');
    expect(assessment.reason).toBe('ownership-undecidable');
  });

  it('is inconclusive when the rule states no condition, since foreign has no meaning', () => {
    const body = JSON.stringify([{ id: 'INV-1001', org_id: 'org-1' }]);
    // Called directly: a default parameter would swallow an explicitly passed undefined.
    const assessment = assessDenyListOutcome({
      outcome: responseWith(body),
      condition: undefined,
      entity: 'Invoice',
      actorAttributes: OUTSIDER,
    });

    expect(assessment.verdict).toBe('inconclusive');
    expect(assessment.reason).toBe('ownership-undecidable');
  });

  it('is inconclusive when the body is not a list it can read', () => {
    for (const body of ['{"message":"ok"}', '<html></html>', '']) {
      const assessment = assess(body);
      expect(assessment.verdict).toBe('inconclusive');
      expect(assessment.reason).toBe('no-rows-recognized');
    }
  });

  it('still fails if a foreign row is present alongside an unreadable one', () => {
    const body = JSON.stringify([{ id: 'INV-1001', org_id: 'org-1' }, { id: 'INV-3001' }]);
    expect(assess(body).verdict).toBe('fail');
  });

  it.each([500, 503])('is inconclusive on %d', (status) => {
    expect(assess('[]', status).verdict).toBe('inconclusive');
  });

  it('is inconclusive on a transport error', () => {
    const assessment = assessDenyListOutcome({
      outcome: { kind: 'transport-error', message: 'x', durationMs: 1 },
      condition: FOREIGN,
      entity: 'Invoice',
      actorAttributes: OUTSIDER,
    });
    expect(assessment.verdict).toBe('inconclusive');
  });

  it.each([400, 302, 429])('is inconclusive on the unhandled status %d', (status) => {
    expect(assess('[]', status).reason).toBe('unexpected-status');
  });
});

describe('a refusal', () => {
  it.each([401, 403, 404])('passes on %d, since nothing foreign was returned', (status) => {
    const assessment = assess('{"error":"no"}', status);
    expect(assessment.verdict).toBe('pass');
    expect(assessment.reason).toBe('refused');
  });
});

describe('finding the rows', () => {
  it('reads a top level array', () => {
    expect(extractRows('[{"id":"1"}]')).toEqual([{ id: '1' }]);
  });

  it('reads rows under a named key, without guessing which key', () => {
    expect(extractRows('{"invoices":[{"id":"1"}]}')).toEqual([{ id: '1' }]);
    expect(extractRows('{"data":[{"id":"1"}]}')).toEqual([{ id: '1' }]);
  });

  it('distinguishes an empty list from a shape it cannot read', () => {
    expect(extractRows('[]')).toEqual([]);
    expect(extractRows('{"message":"ok"}')).toBeUndefined();
  });

  it('ignores an array that does not hold objects', () => {
    expect(extractRows('{"ids":["a","b"]}')).toBeUndefined();
  });

  it('returns nothing for a body it cannot parse', () => {
    expect(extractRows('<html>')).toBeUndefined();
    expect(extractRows('')).toBeUndefined();
  });
});
