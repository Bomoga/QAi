import { describe, expect, it } from 'vitest';

import type { RunResult } from '../contracts/index.ts';
import { renderJunit } from './junit.ts';
import { renderSarif } from './sarif.ts';
import { renderText } from './text.ts';

/**
 * Every emitter labels a suggestion, and the rule is a test rather than a habit.
 *
 * The style guide says a suggested fix is "always labeled as suggestions". Until
 * 2026-08-23 that was guaranteed by the value carrying its own `Suggestion:` prefix, which
 * worked because the text was about to be concatenated into `detail` and nothing could
 * strip it. Now that it is a field, the label belongs to whoever renders it, and a field
 * that quietly loses its label in one of three emitters is exactly the kind of thing
 * nobody notices.
 *
 * The reference has the same shape of risk and is checked here too: a finding ends with a
 * file reference when source is available and a request reference when it is not, and both
 * of those now come from fields rather than from a sentence.
 */

function runWith(check: Partial<RunResult['checks'][number]>): RunResult {
  return {
    resultVersion: '0.3',
    runId: 'RUN-20260823-0001',
    toolVersion: '0.1.0',
    startedAt: '2026-08-23T00:00:00Z',
    finishedAt: '2026-08-23T00:00:10Z',
    spec: { hash: 'sha256:abc', specVersion: '0.1', files: ['spec/app.spec.yaml'] },
    target: { baseUrl: 'http://127.0.0.1:3000' },
    requirements: [{ requirementId: 'REQ-001', verdict: 'failed', checkIds: ['CHK-000001'] }],
    checks: [
      {
        checkId: 'CHK-000001',
        type: 'access',
        requirementId: 'REQ-001',
        ruleId: 'AR-001-01',
        verdict: 'fail',
        deterministic: true,
        severity: 'high',
        title: 'Invoice readable by actor outsider, which the spec denies',
        detail: 'GET /api/invoices/INV-1001 as actor outsider returned 200 with Invoice fields id.',
        requestRef: 'GET /api/invoices/INV-1001',
        suggestion: 'check the caller identity before returning the record.',
        evidence: ['EV-000001'],
        ...check,
      },
    ],
    structural: { specifiedNotObserved: [], observedNotSpecified: [], fieldMismatches: [] },
    summary: {
      requirements: { total: 1, verified: 0, failed: 1, unverified: 0 },
      checks: { total: 1, pass: 0, fail: 1, inconclusive: 0 },
      coverage: 1,
      findingsBySeverity: { high: 1, medium: 0, low: 0, info: 0 },
      modelAssistedCheckCount: 0,
    },
    unverifiedReasons: [],
  } as RunResult;
}

const EMITTERS: readonly (readonly [string, (run: RunResult) => string])[] = [
  ['text', (run) => renderText(run, {})],
  ['junit', (run) => renderJunit(run)],
  ['sarif', (run) => renderSarif(run)],
];

describe('a suggested fix reaches every surface labelled', () => {
  it.each(EMITTERS)('%s labels it', (_name, render) => {
    const out = render(runWith({}));

    expect(out).toContain('Suggestion:');
    expect(out).toContain('check the caller identity before returning the record.');
  });

  it.each(EMITTERS)('%s says nothing about a suggestion when there is none', (_name, render) => {
    // A passing check carries no suggestion, and a bare label with nothing after it would
    // read as one that went missing.
    const out = render(runWith({ suggestion: undefined }));

    expect(out).not.toContain('Suggestion:');
  });
});

describe('a finding names where to look', () => {
  it.each(EMITTERS)('%s prints the request when there is no source', (_name, render) => {
    const out = render(runWith({}));

    expect(out).toContain('Request: GET /api/invoices/INV-1001');
  });

  it.each(EMITTERS)('%s prints the source when a probe read one', (_name, render) => {
    const out = render(runWith({ locationRef: 'src/routes.ts:24' }));

    expect(out).toContain('Source: src/routes.ts:24');
  });

  it.each(EMITTERS)('%s prints each reference once, not twice', (_name, render) => {
    // The defect this whole change exists to remove. `detail` used to carry the reference
    // as well, so every emitter printed it in the sentence and again on its own line.
    const out = render(runWith({ locationRef: 'src/routes.ts:24' }));

    expect(out.split('Source: src/routes.ts:24')).toHaveLength(2);
    expect(out.split('Request: GET /api/invoices/INV-1001')).toHaveLength(2);
  });
});
