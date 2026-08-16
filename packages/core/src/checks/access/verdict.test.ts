import { describe, expect, it } from 'vitest';

import type { RequestOutcome } from '../../target/request.ts';
import { assessDenyOutcome, resourceFieldsIn } from './verdict.ts';

const INVOICE_FIELDS = ['id', 'org_id', 'total_cents', 'notes'];

function responseWith(status: number, body = ''): RequestOutcome {
  return {
    kind: 'response',
    response: { status, headers: {}, body, truncated: false, durationMs: 1 },
  };
}

const LEAKED_INVOICE = JSON.stringify({
  id: 'INV-1001',
  org_id: 'org-1',
  total_cents: 125000,
  notes: '[redacted]',
});

/**
 * One test per row of the table in modules/M3-access-checks.md. The rows are the
 * product decision; if one of these changes, the module document changes with it.
 */
describe('the deny verdict table', () => {
  it.each([401, 403, 404])('row 1: %d with no resource fields is a pass', (status) => {
    const assessment = assessDenyOutcome(
      responseWith(status, '{"error":"not_found"}'),
      INVOICE_FIELDS,
    );

    expect(assessment.verdict).toBe('pass');
    expect(assessment.reason).toBe('refused');
  });

  it('row 2: 2xx carrying resource fields is a fail', () => {
    const assessment = assessDenyOutcome(responseWith(200, LEAKED_INVOICE), INVOICE_FIELDS);

    expect(assessment.verdict).toBe('fail');
    expect(assessment.reason).toBe('resource-fields-returned');
    expect(assessment.observedFields).toEqual(['id', 'notes', 'org_id', 'total_cents']);
  });

  it.each([200, 201, 204])('row 3: %d with an empty body is inconclusive, not a pass', (status) => {
    const assessment = assessDenyOutcome(responseWith(status, ''), INVOICE_FIELDS);

    expect(assessment.verdict).toBe('inconclusive');
    expect(assessment.reason).toBe('empty-or-unrelated-body');
  });

  it('row 3: 2xx with an unrelated body is inconclusive', () => {
    const assessment = assessDenyOutcome(
      responseWith(200, '{"message":"ok","requestId":"abc"}'),
      INVOICE_FIELDS,
    );

    expect(assessment.verdict).toBe('inconclusive');
    expect(assessment.reason).toBe('empty-or-unrelated-body');
  });

  it.each([500, 502, 503])('row 4: %d is inconclusive', (status) => {
    const assessment = assessDenyOutcome(responseWith(status, 'boom'), INVOICE_FIELDS);

    expect(assessment.verdict).toBe('inconclusive');
    expect(assessment.reason).toBe('server-error');
  });

  it('row 5: a transport error is inconclusive', () => {
    const outcome: RequestOutcome = {
      kind: 'transport-error',
      message: 'connect ECONNREFUSED',
      durationMs: 1,
    };
    const assessment = assessDenyOutcome(outcome, INVOICE_FIELDS);

    expect(assessment.verdict).toBe('inconclusive');
    expect(assessment.reason).toBe('transport-error');
  });
});

describe('the cases the table exists to get right', () => {
  it('never calls an empty 200 a pass', () => {
    for (const body of ['', '{}', '[]', '   ', 'null']) {
      expect(assessDenyOutcome(responseWith(200, body), INVOICE_FIELDS).verdict).toBe(
        'inconclusive',
      );
    }
  });

  it('treats a 404 that still returns the record as a failure, not a refusal', () => {
    const assessment = assessDenyOutcome(responseWith(404, LEAKED_INVOICE), INVOICE_FIELDS);

    expect(assessment.verdict).toBe('fail');
    expect(assessment.observedFields).toContain('org_id');
  });

  it('does not guess about a status the table does not name', () => {
    for (const status of [301, 302, 400, 405, 418, 429]) {
      expect(assessDenyOutcome(responseWith(status, ''), INVOICE_FIELDS).verdict).toBe(
        'inconclusive',
      );
    }
  });

  it('reports the status it saw, so a finding can name it', () => {
    expect(assessDenyOutcome(responseWith(200, LEAKED_INVOICE), INVOICE_FIELDS).status).toBe(200);
  });

  it('names no fields on a pass', () => {
    expect(assessDenyOutcome(responseWith(403), INVOICE_FIELDS).observedFields).toEqual([]);
  });
});

describe('finding resource fields in a body', () => {
  it('finds them at the top level', () => {
    expect(resourceFieldsIn('{"id":"1","org_id":"org-1"}', INVOICE_FIELDS)).toEqual([
      'id',
      'org_id',
    ]);
  });

  it('finds them inside an envelope', () => {
    expect(resourceFieldsIn('{"data":{"invoice":{"org_id":"org-1"}}}', INVOICE_FIELDS)).toEqual([
      'org_id',
    ]);
  });

  it('finds them inside a list, which is how a leak usually arrives', () => {
    const body = JSON.stringify({ invoices: [{ org_id: 'org-1' }, { org_id: 'org-2' }] });
    expect(resourceFieldsIn(body, INVOICE_FIELDS)).toEqual(['org_id']);
  });

  it('matches field names case insensitively', () => {
    expect(resourceFieldsIn('{"Org_Id":"org-1"}', INVOICE_FIELDS)).toEqual(['Org_Id']);
  });

  it('ignores a field the resource does not declare', () => {
    expect(resourceFieldsIn('{"unrelated":"x"}', INVOICE_FIELDS)).toEqual([]);
  });

  it('returns nothing for a body it cannot parse, rather than matching on substrings', () => {
    expect(resourceFieldsIn('<html>org_id</html>', INVOICE_FIELDS)).toEqual([]);
  });

  it('returns nothing when the resource declares no fields', () => {
    expect(resourceFieldsIn(LEAKED_INVOICE, [])).toEqual([]);
  });

  it('sorts what it found, so a finding reads the same on every run', () => {
    const body = JSON.stringify({ total_cents: 1, id: '2', org_id: '3' });
    expect(resourceFieldsIn(body, INVOICE_FIELDS)).toEqual(['id', 'org_id', 'total_cents']);
  });
});
