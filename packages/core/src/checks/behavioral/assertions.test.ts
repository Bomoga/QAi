import { describe, expect, it } from 'vitest';

import type { Spec } from '../../contracts/index.ts';
import {
  ASSERTION_FORMS,
  isSupported,
  parseThen,
  splitClauses,
  validateAcceptanceCriteria,
} from './assertions.ts';

function assertionsOf(text: string) {
  const parsed = parseThen(text);
  if (!isSupported(parsed)) throw new Error(`expected "${text}" to parse, got ${parsed.reason}`);
  return parsed.assertions;
}

describe('clause splitting', () => {
  it('splits on and', () => {
    expect(splitClauses('status is 200 and body contains field Invoice.id')).toEqual([
      'status is 200',
      'body contains field Invoice.id',
    ]);
  });

  it('leaves a single clause alone', () => {
    expect(splitClauses('status is 404')).toEqual(['status is 404']);
  });

  it('does not split an and inside a quoted literal', () => {
    expect(splitClauses('body.message equals "created and sent"')).toEqual([
      'body.message equals "created and sent"',
    ]);
  });

  it('does not split the word inside a longer one', () => {
    expect(splitClauses('body.brand equals "android"')).toEqual(['body.brand equals "android"']);
  });
});

describe('the status form', () => {
  it.each([
    ['status is 404', [404]],
    ['status is 403 or 404', [403, 404]],
    ['status in 401, 403', [401, 403]],
    ['status in [401, 403]', [401, 403]],
    ['the response status is 200', [200]],
  ])('reads %s', (text, codes) => {
    expect(assertionsOf(text)).toEqual([{ kind: 'status', codes }]);
  });

  it.each([['status is ok'], ['status is 4040'], ['status is 99'], ['status is 200 or maybe']])(
    'refuses %s rather than guessing',
    (text) => {
      expect(parseThen(text).kind).toBe('unsupported');
    },
  );
});

describe('the field forms', () => {
  it('reads field presence', () => {
    expect(assertionsOf('body contains field Invoice.org_id')).toEqual([
      { kind: 'field-present', entity: 'Invoice', field: 'org_id' },
    ]);
  });

  it('reads field absence', () => {
    expect(assertionsOf('body omits field Invoice.notes')).toEqual([
      { kind: 'field-absent', entity: 'Invoice', field: 'notes' },
    ]);
  });

  it('keeps the entity name as written, since entity matching is case sensitive here', () => {
    const [assertion] = assertionsOf('body contains field AuditLog.id');
    expect(assertion).toMatchObject({ entity: 'AuditLog' });
  });

  it('refuses a field reference with no entity', () => {
    expect(parseThen('body contains field org_id').kind).toBe('unsupported');
  });
});

describe('the value form', () => {
  it.each([
    ['body.status equals "ok"', 'status', 'ok'],
    ["body.status equals 'ok'", 'status', 'ok'],
    ['body.total_cents equals 1000', 'total_cents', 1000],
    ['body.paid equals true', 'paid', true],
    ['body.deleted_at equals null', 'deleted_at', null],
    ['body.invoice.id equals "INV-1001"', 'invoice.id', 'INV-1001'],
  ])('reads %s', (text, path, value) => {
    expect(assertionsOf(text)).toEqual([
      { kind: 'body-equals', path, expected: { kind: 'literal', value } },
    ]);
  });

  it('refuses a bare word, which is more likely a typo than a literal', () => {
    expect(parseThen('body.status equals ok').kind).toBe('unsupported');
  });

  it('reads a comparison against the acting actor', () => {
    expect(assertionsOf('body.org_id equals actor.org_id')).toEqual([
      { kind: 'body-equals', path: 'org_id', expected: { kind: 'actor', attribute: 'org_id' } },
    ]);
  });

  it('refuses an entity reference, which nothing here can resolve', () => {
    expect(parseThen('body.org_id equals Invoice.org_id').kind).toBe('unsupported');
  });
});

describe('the every endpoint form', () => {
  it('reads a field that no endpoint may return', () => {
    expect(assertionsOf('every endpoint omits field User.token')).toEqual([
      { kind: 'every-endpoint-omits', entity: 'User', field: 'token', actors: 'acting' },
    ]);
  });

  it('reads the actor axis only when the criterion asks for it', () => {
    expect(assertionsOf('every endpoint omits field User.token as every actor')).toEqual([
      { kind: 'every-endpoint-omits', entity: 'User', field: 'token', actors: 'all' },
    ]);
  });

  it('refuses a half-written actor axis rather than reading past it', () => {
    // Multiplying the request count by the actor list is not something to infer from a
    // sentence that trails off.
    expect(parseThen('every endpoint omits field User.token as every').kind).toBe('unsupported');
    expect(parseThen('every endpoint omits field User.token for every actor').kind).toBe(
      'unsupported',
    );
  });

  it('does not collide with the every row form', () => {
    expect(assertionsOf('every Invoice has org_id equal to actor.org_id')).toEqual([
      {
        kind: 'every-row',
        entity: 'Invoice',
        field: 'org_id',
        expected: { kind: 'actor', attribute: 'org_id' },
      },
    ]);
  });

  it('refuses the prose it replaced', () => {
    expect(parseThen('no response body contains a token field').kind).toBe('unsupported');
    expect(parseThen('every endpoint is fine').kind).toBe('unsupported');
  });
});

describe('the status matches form', () => {
  it('reads a reference stated in the request vocabulary', () => {
    expect(assertionsOf('status matches actor outsider reads Invoice INV-9999')).toEqual([
      {
        kind: 'status-matches',
        phrase: 'actor outsider reads Invoice INV-9999',
        reference: {
          actorId: 'outsider',
          action: 'read',
          entity: 'Invoice',
          instanceId: 'INV-9999',
          mutates: false,
        },
      },
    ]);
  });

  it('reads a reference to a literal path', () => {
    const [assertion] = assertionsOf('status matches actor anonymous requests /health');

    expect(assertion).toMatchObject({ kind: 'status-matches' });
  });

  it('refuses a reference that would write, so an assertion cannot change the target', () => {
    // Invariant I7 from inside a verdict. The criterion is unsupported rather than the
    // runner being trusted to skip it.
    expect(parseThen('status matches actor owner deletes Invoice INV-1001').kind).toBe(
      'unsupported',
    );
    expect(parseThen('status matches actor owner updates Invoice INV-1001').kind).toBe(
      'unsupported',
    );
    expect(parseThen('status matches actor owner creates Invoice').kind).toBe('unsupported');
  });

  it('refuses a reference that is not a request at all', () => {
    expect(parseThen('status matches the one for a missing invoice').kind).toBe('unsupported');
  });

  it('leaves the ordinary status forms alone', () => {
    expect(assertionsOf('status is 404')).toEqual([{ kind: 'status', codes: [404] }]);
    expect(assertionsOf('status in 401, 403')).toEqual([{ kind: 'status', codes: [401, 403] }]);
  });
});

describe('the unchanged form', () => {
  it('reads a record named by instance', () => {
    expect(assertionsOf('record Invoice INV-1001 is unchanged')).toEqual([
      { kind: 'record-unchanged', entity: 'Invoice', instanceId: 'INV-1001' },
    ]);
  });

  it('reads a record with no instance, which means the one the when clause acts on', () => {
    expect(assertionsOf('record Invoice is unchanged')).toEqual([
      { kind: 'record-unchanged', entity: 'Invoice' },
    ]);
  });

  it('does not collide with the count form, which also begins with record', () => {
    expect(assertionsOf('record count of AuditLog is 1')).toEqual([
      { kind: 'record-count', entity: 'AuditLog', count: 1 },
    ]);
  });

  it('joins a status clause without either swallowing the other', () => {
    expect(assertionsOf('status is 401 and record Invoice INV-1001 is unchanged')).toEqual([
      { kind: 'status', codes: [401] },
      { kind: 'record-unchanged', entity: 'Invoice', instanceId: 'INV-1001' },
    ]);
  });

  it('still refuses the prose it replaced', () => {
    expect(parseThen('the invoice is unchanged').kind).toBe('unsupported');
  });
});

describe('the every row form', () => {
  it('reads a comparison against the acting actor', () => {
    expect(assertionsOf('every Invoice has org_id equal to actor.org_id')).toEqual([
      {
        kind: 'every-row',
        entity: 'Invoice',
        field: 'org_id',
        expected: { kind: 'actor', attribute: 'org_id' },
      },
    ]);
  });

  it('reads a comparison against a literal', () => {
    expect(assertionsOf('every Invoice has status equal to "open"')).toEqual([
      {
        kind: 'every-row',
        entity: 'Invoice',
        field: 'status',
        expected: { kind: 'literal', value: 'open' },
      },
    ]);
  });

  it('absorbs the same filler every other form absorbs, and nothing more', () => {
    expect(assertionsOf('every Invoice has org_id equal to actor.org_id.')).toHaveLength(1);
    expect(parseThen('every returned invoice belongs to the caller').kind).toBe('unsupported');
  });

  it('refuses a bare word on the right, the same as the value form does', () => {
    expect(parseThen('every Invoice has org_id equal to caller').kind).toBe('unsupported');
  });
});

describe('the remaining forms', () => {
  it('reads a record count', () => {
    expect(assertionsOf('record count of AuditLog is 1')).toEqual([
      { kind: 'record-count', entity: 'AuditLog', count: 1 },
    ]);
  });

  it.each(['response time under 500ms', 'response time under 500'])('reads %s', (text) => {
    expect(assertionsOf(text)).toEqual([{ kind: 'response-time', maxMs: 500 }]);
  });
});

describe('several clauses', () => {
  it('reads a conjunction', () => {
    expect(assertionsOf('the response status is 200 and body contains field Invoice.id')).toEqual([
      { kind: 'status', codes: [200] },
      { kind: 'field-present', entity: 'Invoice', field: 'id' },
    ]);
  });

  it('tolerates a trailing period', () => {
    expect(assertionsOf('status is 404.')).toEqual([{ kind: 'status', codes: [404] }]);
  });

  it('rejects the whole criterion when one clause is outside the vocabulary', () => {
    const parsed = parseThen('the response status is 401 and the invoice is unchanged');

    expect(parsed.kind).toBe('unsupported');
    if (parsed.kind !== 'unsupported') throw new Error('unreachable');
    expect(parsed.clause).toBe('the invoice is unchanged');
  });

  it('names the clause it could not read, not the whole sentence', () => {
    const parsed = parseThen('status is 200 and every returned invoice belongs to the caller');

    if (parsed.kind !== 'unsupported') throw new Error('expected unsupported');
    expect(parsed.clause).toBe('every returned invoice belongs to the caller');
    expect(parsed.reason).toContain('assertion forms');
  });
});

describe('what it refuses to interpret', () => {
  it.each([
    'the body contains no Invoice fields',
    'every returned invoice has org_id equal to the caller organization',
    'no returned invoice includes a notes field',
    'the body reports status ok',
    'an AuditLog entry exists referencing that invoice',
    'the response status matches the status returned for an invoice id that does not exist',
    'the invoice is unchanged',
  ])('refuses to guess at %s', (text) => {
    expect(parseThen(text).kind).toBe('unsupported');
  });
});

function specWith(
  criteria: { then: string; mode: 'deterministic' | 'fuzzy'; id?: string }[],
): Spec {
  return {
    specVersion: '0.1',
    name: 'Ledger',
    actors: [],
    entities: [],
    requirements: [
      {
        id: 'REQ-001',
        statement: 'A requirement',
        entities: [],
        fields: [],
        tags: [],
        accessRules: [],
        acceptanceCriteria: criteria.map((criterion) => ({
          ...(criterion.id === undefined ? {} : { id: criterion.id }),
          mode: criterion.mode,
          given: 'a thing',
          when: 'something happens',
          then: criterion.then,
        })),
      },
    ],
  };
}

describe('validation warnings', () => {
  it('says nothing about a criterion the vocabulary expresses', () => {
    const spec = specWith([{ mode: 'deterministic', then: 'status is 404' }]);
    expect(validateAcceptanceCriteria(spec, 'ledger.spec.yaml')).toEqual([]);
  });

  it('warns rather than errors, so the spec still loads', () => {
    const spec = specWith([{ mode: 'deterministic', then: 'the invoice is unchanged' }]);
    const [diagnostic] = validateAcceptanceCriteria(spec, 'ledger.spec.yaml');

    expect(diagnostic?.severity).toBe('warning');
    expect(diagnostic?.file).toBe('ledger.spec.yaml');
    expect(diagnostic?.path).toBe('requirements[0].acceptanceCriteria[0].then');
  });

  it('names the criterion, the clause, and both ways out', () => {
    const spec = specWith([
      { id: 'AC-001-01', mode: 'deterministic', then: 'the invoice is unchanged' },
    ]);
    const [diagnostic] = validateAcceptanceCriteria(spec, 'ledger.spec.yaml');

    expect(diagnostic?.message).toContain('AC-001-01');
    expect(diagnostic?.message).toContain('the invoice is unchanged');
    expect(diagnostic?.message).toContain('mode: fuzzy');
    expect(diagnostic?.message).toContain(ASSERTION_FORMS[0] ?? '');
  });

  it('identifies a criterion that was never given an id', () => {
    const spec = specWith([{ mode: 'deterministic', then: 'the invoice is unchanged' }]);
    const [diagnostic] = validateAcceptanceCriteria(spec, 'ledger.spec.yaml');

    expect(diagnostic?.message).toContain('REQ-001 criterion 1');
  });

  it('leaves a fuzzy criterion alone, since the vocabulary is not its contract', () => {
    const spec = specWith([{ mode: 'fuzzy', then: 'the page looks right to a reasonable person' }]);
    expect(validateAcceptanceCriteria(spec, 'ledger.spec.yaml')).toEqual([]);
  });

  it('reports one warning per unsupported criterion', () => {
    const spec = specWith([
      { mode: 'deterministic', then: 'status is 404' },
      { mode: 'deterministic', then: 'the invoice is unchanged' },
      { mode: 'deterministic', then: 'every row belongs to the caller' },
    ]);

    expect(validateAcceptanceCriteria(spec, 'ledger.spec.yaml')).toHaveLength(2);
  });
});
