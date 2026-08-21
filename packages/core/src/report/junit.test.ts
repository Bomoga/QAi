import { describe, expect, it } from 'vitest';

import type { RunResult } from '../contracts/index.ts';
import { renderJunit } from './junit.ts';

/**
 * Assertions are scoped to one suite wherever a requirement id could appear in more than
 * one, for the reason the M7.2 and M7.3 tests record: a document-wide search finds the
 * first occurrence and then passes or fails for the wrong reason.
 */
function suiteOf(rendered: string, name: string): string {
  const start = rendered.indexOf(`<testsuite name="${name}"`);
  expect(start, `suite "${name}" is missing`).toBeGreaterThanOrEqual(0);

  const end = rendered.indexOf('</testsuite>', start);
  return rendered.slice(start, end < 0 ? undefined : end);
}

function check(overrides: Partial<RunResult['checks'][number]> = {}): RunResult['checks'][number] {
  return {
    checkId: 'CHK-a91f2c',
    type: 'access',
    requirementId: 'REQ-014',
    ruleId: 'AR-014-01',
    verdict: 'pass',
    deterministic: true,
    severity: 'info',
    title: 'Invoice list scoped to the caller organization',
    evidence: [],
    ...overrides,
  } as RunResult['checks'][number];
}

function run(overrides: Partial<RunResult> = {}): RunResult {
  return {
    resultVersion: '0.1',
    runId: 'RUN-20260818-0001',
    toolVersion: '0.1.0',
    startedAt: '2026-08-18T00:00:00Z',
    finishedAt: '2026-08-18T00:00:10Z',
    spec: { hash: 'sha256:abc123', specVersion: '0.1', files: ['spec/ledger.spec.yaml'] },
    target: { baseUrl: 'http://127.0.0.1:3000' },
    requirements: [{ requirementId: 'REQ-014', verdict: 'verified', checkIds: ['CHK-a91f2c'] }],
    checks: [check()],
    structural: { specifiedNotObserved: [], observedNotSpecified: [], fieldMismatches: [] },
    summary: {
      requirements: { total: 1, verified: 1, failed: 0, unverified: 0 },
      checks: { total: 1, pass: 1, fail: 0, inconclusive: 0 },
      coverage: 1,
      findingsBySeverity: { high: 0, medium: 0, low: 0, info: 0 },
      modelAssistedCheckCount: 0,
    },
    unverifiedReasons: [],
    ...overrides,
  } as RunResult;
}

/** The three verdicts in one run, so a mapping can be read as a whole table. */
function mixedRun(): RunResult {
  return run({
    requirements: [
      { requirementId: 'REQ-001', verdict: 'failed', checkIds: ['CHK-f'] },
      { requirementId: 'REQ-002', verdict: 'unverified', checkIds: ['CHK-i'] },
      { requirementId: 'REQ-003', verdict: 'verified', checkIds: ['CHK-p'] },
    ],
    checks: [
      check({
        checkId: 'CHK-f',
        requirementId: 'REQ-001',
        ruleId: 'AR-001-01',
        verdict: 'fail',
        severity: 'high',
        title: 'Invoice readable by user outside owning organization',
        detail: 'GET /api/invoices/INV-1001 as actor outsider returned 200',
        locationRef: 'src/routes.ts:64',
        evidence: ['EV-7d10b3'],
      }),
      check({
        checkId: 'CHK-i',
        requirementId: 'REQ-002',
        ruleId: 'AC-002-01',
        verdict: 'inconclusive',
        detail: 'No browser capability is available, so nothing looked at the page.',
        deterministic: false,
      }),
      check({ checkId: 'CHK-p', requirementId: 'REQ-003', ruleId: 'AR-003-01' }),
    ],
  });
}

describe('rendering a run as JUnit XML', () => {
  it('maps an inconclusive check to skipped and never to failure', () => {
    // The whole point of this emitter's mapping, and invariant I4 in the format most
    // likely to break it. A dashboard has two columns and this belongs in neither.
    const suite = suiteOf(renderJunit(mixedRun()), 'REQ-002');

    expect(suite).toContain('<skipped');
    expect(suite).not.toContain('<failure');
  });

  it('maps the three check verdicts to the three case shapes', () => {
    const rendered = renderJunit(mixedRun());

    expect(suiteOf(rendered, 'REQ-001')).toContain('<failure');
    expect(suiteOf(rendered, 'REQ-002')).toContain('<skipped');

    const passing = suiteOf(rendered, 'REQ-003');
    expect(passing).not.toContain('<failure');
    expect(passing).not.toContain('<skipped');
    expect(passing).toContain('<testcase');
  });

  it('counts skipped separately from failures on every suite and on the root', () => {
    const rendered = renderJunit(mixedRun());

    expect(rendered).toContain(
      '<testsuites name="RUN-20260818-0001" tests="3" failures="1" skipped="1"',
    );
    expect(suiteOf(rendered, 'REQ-001')).toContain('tests="1" failures="1" skipped="0"');
    expect(suiteOf(rendered, 'REQ-002')).toContain('tests="1" failures="0" skipped="1"');
    expect(suiteOf(rendered, 'REQ-003')).toContain('tests="1" failures="0" skipped="0"');
  });

  it('gives a requirement with no checks a suite holding one skipped case with its reason', () => {
    // Emitting nothing would drop it from the dashboard, and a reader comparing runs
    // would see a requirement disappear rather than a gap appear.
    const suite = suiteOf(
      renderJunit(
        run({
          requirements: [{ requirementId: 'REQ-007', verdict: 'unverified', checkIds: [] }],
          checks: [],
          unverifiedReasons: [
            {
              requirementId: 'REQ-007',
              reason: 'capability-unavailable',
              detail: 'Playwright is not installed',
            },
          ],
        }),
      ),
      'REQ-007',
    );

    expect(suite).toContain('tests="1" failures="0" skipped="1"');
    expect(suite).toContain('capability-unavailable');
    expect(suite).toContain('Playwright is not installed');
    expect(suite).not.toContain('<failure');
  });

  it('keeps a check belonging to no requirement rather than dropping it', () => {
    const rendered = renderJunit(
      run({
        requirements: [],
        checks: [
          check({
            checkId: 'CHK-s',
            type: 'structural',
            requirementId: undefined,
            ruleId: undefined,
            verdict: 'fail',
            severity: 'medium',
            title: 'An endpoint nobody specified',
          }),
        ],
      }),
    );

    expect(suiteOf(rendered, 'unassigned')).toContain('An endpoint nobody specified');
    expect(rendered).toContain('tests="1" failures="1"');
  });

  it('puts one testsuite per requirement in the run result order', () => {
    const rendered = renderJunit(mixedRun());

    expect(rendered.indexOf('REQ-001')).toBeLessThan(rendered.indexOf('REQ-002'));
    expect(rendered.indexOf('REQ-002')).toBeLessThan(rendered.indexOf('REQ-003'));
  });

  it('names a case by its rule and its check id, so two actors on one rule stay distinct', () => {
    const suite = suiteOf(
      renderJunit(
        run({
          requirements: [{ requirementId: 'REQ-014', verdict: 'verified', checkIds: [] }],
          checks: [check({ checkId: 'CHK-one' }), check({ checkId: 'CHK-two' })],
        }),
      ),
      'REQ-014',
    );

    expect(suite).toContain('AR-014-01 CHK-one Invoice list scoped');
    expect(suite).toContain('AR-014-01 CHK-two Invoice list scoped');
  });

  it('carries the request summary, the source, and the evidence into the failure body', () => {
    const suite = suiteOf(renderJunit(mixedRun()), 'REQ-001');

    expect(suite).toContain('GET /api/invoices/INV-1001 as actor outsider returned 200');
    expect(suite).toContain('Source: src/routes.ts:64');
    expect(suite).toContain('Evidence: EV-7d10b3');
  });

  it('labels a model assisted check as one', () => {
    expect(suiteOf(renderJunit(mixedRun()), 'REQ-002')).toContain('Model assisted');
  });

  it('escapes the characters that would otherwise end an attribute or an element', () => {
    // A detail quoting a JSON body carries every one of these.
    const rendered = renderJunit(
      run({
        checks: [
          check({
            verdict: 'fail',
            title: 'Body held <script> & "quotes" and \'apostrophes\'',
            detail: 'Response was {"a": "<b>"} & more',
          }),
        ],
      }),
    );

    expect(rendered).toContain(
      '&lt;script&gt; &amp; &quot;quotes&quot; and &apos;apostrophes&apos;',
    );
    expect(rendered).not.toContain('<script>');
    expect(rendered).not.toContain('"a": "<b>"');
  });

  it('strips a control byte rather than writing a document no parser will read', () => {
    // Not escapable, only removable. One raw byte would cost the whole report rather
    // than one character of one message.
    const title = `bell \u0007 and null \u0000 here`;
    const rendered = renderJunit(run({ checks: [check({ verdict: 'fail', title })] }));

    expect(rendered).toContain('bell  and null  here');
    expect(rendered).not.toContain('\u0007');
    expect(rendered).not.toContain('\u0000');
  });

  it('declares the xml prolog and closes the root', () => {
    const rendered = renderJunit(run());

    expect(rendered.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(rendered.endsWith('</testsuites>\n')).toBe(true);
  });

  it('states the run duration from the recorded instants, not from a clock', () => {
    // Rule R6. The instants are data on the result; reading a clock here would make two
    // runs over one golden differ.
    expect(renderJunit(run())).toContain('time="10"');
  });

  it('omits the duration when the instants do not make one', () => {
    const rendered = renderJunit(run({ finishedAt: '2026-08-17T00:00:00Z' }));

    expect(rendered).not.toContain('time=');
  });

  it('produces identical bytes when rendered twice', () => {
    expect(renderJunit(mixedRun())).toBe(renderJunit(mixedRun()));
  });

  it('contains no em dash', () => {
    expect(renderJunit(mixedRun())).not.toContain('—');
  });
});
