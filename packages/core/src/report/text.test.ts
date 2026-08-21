import { describe, expect, it } from 'vitest';

import { FORBIDDEN_FINDING_TERMS } from '../checks/access/findings.ts';
import type { Observation, RunResult } from '../contracts/index.ts';
import { renderText } from './text.ts';

/**
 * Every assertion here is scoped to the section it is about.
 *
 * A rendered report names the same requirement id in four different places, so searching
 * the whole document for one finds whichever section happens to come first and then
 * passes or fails for a reason unrelated to what was under test. `sectionOf` slices the
 * document between two headings so a test can only see the part it means.
 */

const HEADINGS = [
  'Run',
  'What was built',
  'Disagreements',
  'Findings',
  'Unverified',
  'Summary',
] as const;

function sectionOf(rendered: string, heading: (typeof HEADINGS)[number]): string {
  const start = rendered.indexOf(heading);
  expect(start, `section "${heading}" is missing`).toBeGreaterThanOrEqual(0);

  const later = HEADINGS.slice(HEADINGS.indexOf(heading) + 1)
    .map((next) => rendered.indexOf(next, start + heading.length))
    .filter((index) => index >= 0);

  return rendered.slice(start, later.length > 0 ? Math.min(...later) : undefined);
}

function run(overrides: Partial<RunResult> = {}): RunResult {
  return {
    resultVersion: '0.1',
    runId: 'RUN-20260818-0001',
    toolVersion: '0.1.0',
    startedAt: '2026-08-18T00:00:00Z',
    finishedAt: '2026-08-18T00:00:10Z',
    spec: { hash: 'sha256:abc123', specVersion: '0.1', files: ['spec/ledger.spec.yaml'] },
    target: { baseUrl: 'http://127.0.0.1:3000', commit: 'a1b2c3d' },
    requirements: [
      {
        requirementId: 'REQ-001',
        verdict: 'verified',
        reason: '1 of 1 check(s) passed',
        checkIds: ['CHK-aaa'],
      },
    ],
    checks: [
      {
        checkId: 'CHK-aaa',
        type: 'access',
        requirementId: 'REQ-001',
        verdict: 'pass',
        deterministic: true,
        severity: 'info',
        title: 'A check that passed',
        evidence: [],
      },
    ],
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

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    observationVersion: '0.1',
    observedAt: '2026-08-18T00:00:05Z',
    mode: 'hybrid',
    target: { baseUrl: 'http://127.0.0.1:3000' },
    entities: [
      { name: 'Invoice', origin: 'schema', confidence: 'high', fields: [], evidence: [] },
      { name: 'Ledger', origin: 'inferred', confidence: 'low', fields: [], evidence: [] },
    ],
    endpoints: [
      {
        id: 'GET /api/invoices',
        method: 'GET',
        path: '/api/invoices',
        origin: 'source',
        confidence: 'high',
        authRequired: 'unknown',
        actorVisibility: {},
        evidence: [],
      },
      {
        id: 'GET /health',
        method: 'GET',
        path: '/health',
        origin: 'blackbox',
        confidence: 'low',
        authRequired: 'unknown',
        actorVisibility: {},
        evidence: [],
      },
    ],
    notes: [],
    ...overrides,
  } as Observation;
}

describe('rendering a run as text', () => {
  it('leads with the map and puts the summary last', () => {
    // The module's information design: the demystification is the product and the
    // verification is the evidence that the map is accurate. A report opening on a
    // number reverses that.
    const rendered = renderText(run(), {});
    const order = HEADINGS.map((heading) => rendered.indexOf(heading));

    expect(order).toStrictEqual([...order].sort((left, right) => left - right));
    expect(order.every((index) => index >= 0)).toBe(true);
  });

  it('states the target, the spec hash, and the commit in the header', () => {
    const header = sectionOf(renderText(run(), {}), 'Run');

    expect(header).toContain('RUN-20260818-0001');
    expect(header).toContain('http://127.0.0.1:3000');
    expect(header).toContain('sha256:abc123');
    expect(header).toContain('a1b2c3d');
  });

  it('counts entities and endpoints by origin and by confidence when an observation is given', () => {
    const built = sectionOf(renderText(run(), { observation: observation() }), 'What was built');

    expect(built).toContain('2 entities');
    expect(built).toContain('2 endpoints');
    expect(built).toContain('schema 1');
    expect(built).toContain('inferred 1');
    expect(built).toContain('source 1');
    expect(built).toContain('blackbox 1');
    expect(built).toContain('high 1');
    expect(built).toContain('low 1');
  });

  it('names the observation reference rather than inventing counts when none was given', () => {
    // RunResult carries only a reference to the observation. Reporting zero entities
    // would be a claim about the application; reporting nothing at all would hide that
    // a probe ran.
    const built = sectionOf(
      renderText(run({ observation: { ref: 'OBS-20260818-0001' } }), {}),
      'What was built',
    );

    expect(built).toContain('OBS-20260818-0001');
    expect(built).not.toContain('0 entities');
  });

  it('says plainly that no probe ran when the result records none', () => {
    const built = sectionOf(renderText(run(), {}), 'What was built');

    expect(built).toContain('No probe');
  });

  it('lists all three kinds of disagreement', () => {
    const rendered = renderText(
      run({
        structural: {
          specifiedNotObserved: [{ kind: 'entity', name: 'AuditLog', requirementIds: ['REQ-021'] }],
          observedNotSpecified: [
            { kind: 'endpoint', id: 'GET /api/debug/state', severity: 'medium' },
          ],
          fieldMismatches: [
            {
              entity: 'Invoice',
              specifiedNotObserved: ['notes'],
              observedNotSpecified: ['internal_ref'],
            },
          ],
        },
      }),
      {},
    );
    const disagreements = sectionOf(rendered, 'Disagreements');

    expect(disagreements).toContain('AuditLog');
    expect(disagreements).toContain('REQ-021');
    expect(disagreements).toContain('GET /api/debug/state');
    expect(disagreements).toContain('Invoice');
    expect(disagreements).toContain('notes');
    expect(disagreements).toContain('internal_ref');
  });

  it('orders findings by severity and then by requirement id', () => {
    const failing = (checkId: string, requirementId: string, severity: 'high' | 'medium') =>
      ({
        checkId,
        type: 'access',
        requirementId,
        verdict: 'fail',
        deterministic: true,
        severity,
        title: `finding for ${requirementId}`,
        evidence: [],
      }) as RunResult['checks'][number];

    const findings = sectionOf(
      renderText(
        run({
          checks: [
            failing('CHK-m2', 'REQ-020', 'medium'),
            failing('CHK-h2', 'REQ-030', 'high'),
            failing('CHK-m1', 'REQ-010', 'medium'),
            failing('CHK-h1', 'REQ-005', 'high'),
          ],
        }),
        {},
      ),
      'Findings',
    );

    const at = (id: string) => findings.indexOf(id);
    expect(at('REQ-005')).toBeLessThan(at('REQ-030'));
    expect(at('REQ-030')).toBeLessThan(at('REQ-010'));
    expect(at('REQ-010')).toBeLessThan(at('REQ-020'));
  });

  it('shows only failures as findings, so a passing check is not one', () => {
    const findings = sectionOf(renderText(run(), {}), 'Findings');

    expect(findings).not.toContain('CHK-aaa');
    expect(findings).toContain('No findings');
  });

  it('names the actor, the request, the response, and the file reference on a finding', () => {
    const findings = sectionOf(
      renderText(
        run({
          checks: [
            {
              checkId: 'CHK-f1',
              type: 'access',
              requirementId: 'REQ-014',
              ruleId: 'AR-014-01',
              verdict: 'fail',
              deterministic: true,
              severity: 'high',
              title: 'Invoice readable by user outside owning organization',
              detail:
                'GET /api/invoices/INV-1001 as actor outsider returned 200 with fields id, org_id',
              locationRef: 'src/routes/invoices.ts:12',
              evidence: ['EV-7d10b3'],
            },
          ],
        }),
        {},
      ),
      'Findings',
    );

    expect(findings).toContain('as actor outsider');
    expect(findings).toContain('GET /api/invoices/INV-1001');
    expect(findings).toContain('200');
    expect(findings).toContain('src/routes/invoices.ts:12');
    expect(findings).toContain('EV-7d10b3');
    expect(findings).toContain('AR-014-01');
  });

  it('keeps unverified in its own section with a reason each, never folded into pass or fail', () => {
    // Invariant I4. A coverage gap that reads as a pass is the failure this tool exists
    // to stop somebody shipping.
    const rendered = renderText(
      run({
        requirements: [
          { requirementId: 'REQ-007', verdict: 'unverified', reason: 'nothing ran', checkIds: [] },
        ],
        checks: [],
        summary: {
          requirements: { total: 1, verified: 0, failed: 0, unverified: 1 },
          checks: { total: 0, pass: 0, fail: 0, inconclusive: 0 },
          coverage: 0,
          findingsBySeverity: { high: 0, medium: 0, low: 0, info: 0 },
          modelAssistedCheckCount: 0,
        },
        unverifiedReasons: [
          {
            requirementId: 'REQ-007',
            reason: 'capability-unavailable',
            detail: 'Playwright is not installed',
          },
        ],
      }),
      {},
    );

    const unverified = sectionOf(rendered, 'Unverified');
    expect(unverified).toContain('REQ-007');
    expect(unverified).toContain('capability-unavailable');
    expect(unverified).toContain('Playwright is not installed');

    expect(sectionOf(rendered, 'Findings')).not.toContain('REQ-007');
  });

  it('gives an unverified requirement a reason even when the run recorded none', () => {
    const unverified = sectionOf(
      renderText(
        run({
          requirements: [{ requirementId: 'REQ-009', verdict: 'unverified', checkIds: [] }],
          checks: [],
          unverifiedReasons: [],
        }),
        {},
      ),
      'Unverified',
    );

    expect(unverified).toContain('REQ-009');
    expect(unverified).toContain('no reason was recorded');
  });

  it('labels coverage as coverage and never as a pass rate', () => {
    const rendered = renderText(run({ summary: { ...run().summary, coverage: 0.8 } }), {});
    const summary = sectionOf(rendered, 'Summary');

    expect(summary).toContain('Coverage');
    expect(summary).toContain('80%');
    expect(rendered.toLowerCase()).not.toContain('pass rate');
    expect(rendered.toLowerCase()).not.toContain('passing rate');
    expect(rendered.toLowerCase()).not.toContain('% passed');
  });

  it('says what coverage counts, so the number is not read as a grade', () => {
    const summary = sectionOf(renderText(run(), {}), 'Summary');

    expect(summary).toContain('requirements with at least one check that reached a verdict');
  });

  it('displays the model assisted check count even when it is zero', () => {
    const summary = sectionOf(renderText(run(), {}), 'Summary');

    expect(summary).toContain('Model assisted checks: 0');
  });

  it('produces identical bytes when rendered twice', () => {
    expect(renderText(run(), {})).toBe(renderText(run(), {}));
  });

  it('emits no escape codes by default, since the default is a piped stream', () => {
    // Core cannot read the environment, per rule R6, so it never decides this itself.
    // Whether the stream is a TTY is the caller's fact to establish.
    expect(renderText(run(), {})).not.toContain('[');
    expect(renderText(run(), { color: false })).not.toContain('[');
  });

  it('emits escape codes when the caller says the stream is a TTY', () => {
    expect(renderText(run(), { color: true })).toContain('[');
  });

  it('renders the same text with color stripped as it does with color off', () => {
    // Color is decoration over one document, not a second document.
    // eslint-disable-next-line no-control-regex
    const stripped = renderText(run(), { color: true }).replace(/\[[0-9;]*m/g, '');

    expect(stripped).toBe(renderText(run(), { color: false }));
  });

  it('names no vulnerability class in a finding, per the module Do Not', () => {
    // Scoped to the findings section, and to the same exported list the access findings
    // are asserted against, so the two cannot drift apart. Scoping matters here for a
    // second reason: `specVersion` in the header lowercases to "spe(cve)rsion", so a
    // sweep over the whole document fails on a word that classifies nothing.
    const findings = sectionOf(
      renderText(
        run({
          checks: [
            {
              checkId: 'CHK-f1',
              type: 'access',
              requirementId: 'REQ-014',
              verdict: 'fail',
              deterministic: true,
              severity: 'high',
              title: 'Invoice readable by user outside owning organization',
              detail: 'GET /api/invoices/INV-1001 as actor outsider returned 200',
              evidence: [],
            },
          ],
        }),
        {},
      ),
      'Findings',
    );

    for (const term of FORBIDDEN_FINDING_TERMS) {
      expect(findings.toLowerCase()).not.toContain(term);
    }
  });

  it('ends with a newline and contains no em dash', () => {
    const rendered = renderText(run({ observation: { ref: 'OBS-1' } }), {
      observation: observation(),
    });

    expect(rendered.endsWith('\n')).toBe(true);
    expect(rendered).not.toContain('—');
  });
});
