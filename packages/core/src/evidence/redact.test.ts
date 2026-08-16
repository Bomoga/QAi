import { describe, expect, it } from 'vitest';

import { SpecSchema } from '../contracts/index.ts';
import {
  compilePatterns,
  redactBody,
  redactHeaders,
  rulesFor,
  sensitiveFieldsOf,
} from './redact.ts';

const SPEC = SpecSchema.parse({
  specVersion: '0.1',
  name: 'Ledger',
  entities: [
    {
      name: 'Invoice',
      fields: [
        { name: 'org_id', type: 'string' },
        { name: 'notes', type: 'string', sensitive: true },
      ],
    },
    {
      name: 'User',
      fields: [
        { name: 'email', type: 'string' },
        { name: 'token', type: 'string', sensitive: true },
      ],
    },
  ],
  requirements: [],
});

describe('reading sensitive fields from the spec', () => {
  it('collects every field marked sensitive across entities', () => {
    expect(sensitiveFieldsOf(SPEC)).toEqual(new Set(['notes', 'token']));
  });

  it('leaves unmarked fields alone', () => {
    expect(sensitiveFieldsOf(SPEC).has('org_id')).toBe(false);
  });
});

describe('headers', () => {
  const rules = rulesFor(SPEC);

  it('always removes authorization, whatever the spec says', () => {
    const { value, redactions } = redactHeaders(
      { authorization: 'Bearer ledger-owner-token' },
      rules,
      'request.headers',
    );

    expect(value['authorization']).toBe('[redacted]');
    expect(redactions).toEqual(['request.headers.authorization']);
  });

  it.each(['cookie', 'set-cookie', 'proxy-authorization'])('always removes %s', (header) => {
    const { value } = redactHeaders({ [header]: 'secret' }, rules, 'response.headers');
    expect(value[header]).toBe('[redacted]');
  });

  it('is case insensitive about header names', () => {
    const { value } = redactHeaders({ Authorization: 'Bearer t' }, rules, 'request.headers');
    expect(value['Authorization']).toBe('[redacted]');
  });

  it('leaves an ordinary header intact', () => {
    const { value, redactions } = redactHeaders(
      { 'content-type': 'application/json' },
      rules,
      'response.headers',
    );

    expect(value['content-type']).toBe('application/json');
    expect(redactions).toEqual([]);
  });

  it('applies configured extra patterns to header names', () => {
    const withPattern = rulesFor(SPEC, ['(?i)api[_-]?key']);
    const { value } = redactHeaders({ 'X-Api-Key': 'k' }, withPattern, 'request.headers');
    expect(value['X-Api-Key']).toBe('[redacted]');
  });
});

describe('bodies', () => {
  const rules = rulesFor(SPEC);

  it('removes a field the spec marks sensitive', () => {
    const body = JSON.stringify({ id: 'INV-1001', org_id: 'org-1', notes: 'private note' });
    const { value, redactions } = redactBody(body, rules, 'response.body');

    expect(value).not.toContain('private note');
    expect(redactions).toEqual(['response.body.notes']);
    expect(JSON.parse(value)).toMatchObject({ id: 'INV-1001', org_id: 'org-1' });
  });

  it('finds a sensitive field at any depth', () => {
    const body = JSON.stringify({ data: { invoice: { notes: 'private' } } });
    const { value, redactions } = redactBody(body, rules, 'response.body');

    expect(value).not.toContain('private');
    expect(redactions).toEqual(['response.body.data.invoice.notes']);
  });

  it('records the index of an array element it altered', () => {
    const body = JSON.stringify({ invoices: [{ notes: 'a' }, { notes: 'b' }] });
    const { redactions } = redactBody(body, rules, 'response.body');

    expect(redactions).toEqual([
      'response.body.invoices[0].notes',
      'response.body.invoices[1].notes',
    ]);
  });

  it('leaves a body with nothing sensitive byte identical', () => {
    const body = JSON.stringify({ id: 'INV-1001', org_id: 'org-1' });
    const { value, redactions } = redactBody(body, rules, 'response.body');

    expect(value).toBe(body);
    expect(redactions).toEqual([]);
  });

  it('passes a body it cannot parse through rather than guessing at structure', () => {
    const { value, redactions } = redactBody('<html>not json</html>', rules, 'response.body');
    expect(value).toBe('<html>not json</html>');
    expect(redactions).toEqual([]);
  });

  it('handles an empty body', () => {
    expect(redactBody('', rules, 'response.body')).toEqual({ value: '', redactions: [] });
  });

  it('removes a credential a target echoed back in its response body', () => {
    const body = JSON.stringify({ authorization: 'Bearer ledger-owner-token', id: '1' });
    const { value, redactions } = redactBody(body, rules, 'response.body');

    expect(value).not.toContain('ledger-owner-token');
    expect(redactions).toEqual(['response.body.authorization']);
  });

  it.each(['cookie', 'set-cookie', 'proxy-authorization'])(
    'removes a body field named %s wherever it appears',
    (key) => {
      const body = JSON.stringify({ [key]: 'secret-value' });
      const { value } = redactBody(body, rules, 'response.body');
      expect(value).not.toContain('secret-value');
    },
  );

  it('applies configured extra patterns to field names', () => {
    const withPattern = rulesFor(SPEC, ['(?i)api[_-]?key']);
    const body = JSON.stringify({ apiKey: 'k', id: '1' });
    const { value, redactions } = redactBody(body, withPattern, 'response.body');

    expect(value).not.toContain('"k"');
    expect(redactions).toEqual(['response.body.apiKey']);
  });
});

describe('compiling configured patterns', () => {
  it('translates the inline case insensitive flag YAML configs tend to carry', () => {
    const { compiled, invalid } = compilePatterns(['(?i)api[_-]?key']);
    expect(invalid).toEqual([]);
    expect(compiled[0]?.test('X-API-KEY')).toBe(true);
  });

  it('reports an invalid pattern rather than throwing mid run', () => {
    const { compiled, invalid } = compilePatterns(['([unclosed']);
    expect(compiled).toEqual([]);
    expect(invalid).toEqual(['([unclosed']);
  });

  it('keeps the good patterns when one is bad', () => {
    const { compiled, invalid } = compilePatterns(['([unclosed', 'secret']);
    expect(compiled).toHaveLength(1);
    expect(invalid).toHaveLength(1);
  });
});
