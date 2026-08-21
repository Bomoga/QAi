import { describe, expect, it } from 'vitest';

import type { RunResult } from '../contracts/index.ts';
import { renderSarif } from './sarif.ts';
import { SarifLogSchema, type SarifLog } from './sarif-schema.ts';

/**
 * The schema check here is against `sarif-schema.ts`, which transcribes the published
 * SARIF 2.1.0 document rather than being it. Running the real JSON Schema needs a
 * validator dependency and none is approved; recorded in the M7 Open questions.
 */

function parsed(result: RunResult): SarifLog {
  const document: unknown = JSON.parse(renderSarif(result));
  const check = SarifLogSchema.safeParse(document);

  expect(check.error?.issues ?? [], 'output does not conform to SARIF 2.1.0').toStrictEqual([]);
  return check.data as SarifLog;
}

function firstRun(result: RunResult): SarifLog['runs'][number] {
  const run = parsed(result).runs[0];
  expect(run).toBeDefined();
  return run as SarifLog['runs'][number];
}

function failing(
  overrides: Partial<RunResult['checks'][number]> = {},
): RunResult['checks'][number] {
  return {
    checkId: 'CHK-a91f2c',
    type: 'access',
    requirementId: 'REQ-014',
    ruleId: 'AR-014-01',
    verdict: 'fail',
    deterministic: true,
    severity: 'high',
    title: 'Invoice readable by user outside owning organization',
    detail: 'GET /api/invoices/INV-1001 as actor outsider returned 200 with fields id, org_id',
    evidence: ['EV-7d10b3'],
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
    requirements: [],
    checks: [],
    structural: { specifiedNotObserved: [], observedNotSpecified: [], fieldMismatches: [] },
    summary: {
      requirements: { total: 1, verified: 0, failed: 1, unverified: 0 },
      checks: { total: 1, pass: 0, fail: 1, inconclusive: 0 },
      coverage: 1,
      findingsBySeverity: { high: 1, medium: 0, low: 0, info: 0 },
      modelAssistedCheckCount: 0,
    },
    unverifiedReasons: [],
    ...overrides,
  } as RunResult;
}

describe('rendering a run as SARIF', () => {
  it('conforms to SARIF 2.1.0 with no results at all', () => {
    const log = parsed(run());

    expect(log.version).toBe('2.1.0');
    expect(log.runs).toHaveLength(1);
  });

  it('conforms to SARIF 2.1.0 with every kind of result present', () => {
    const log = parsed(
      run({
        checks: [
          failing(),
          failing({ checkId: 'CHK-b1', type: 'behavioral', severity: 'medium' }),
          failing({ checkId: 'CHK-c1', severity: 'low', locationRef: 'src/routes.ts:64' }),
          failing({ checkId: 'CHK-d1', severity: 'info', deterministic: false }),
        ],
        structural: {
          specifiedNotObserved: [{ kind: 'entity', name: 'AuditLog', requirementIds: ['REQ-007'] }],
          observedNotSpecified: [
            { kind: 'endpoint', id: 'GET /api/debug/state', severity: 'medium' },
          ],
          fieldMismatches: [
            { entity: 'Invoice', specifiedNotObserved: [], observedNotSpecified: ['internal_ref'] },
          ],
        },
      }),
    );

    expect(log.runs[0]?.results).toHaveLength(7);
  });

  it('names the document with the published schema url', () => {
    const log = parsed(run());

    expect(log.$schema).toBe(
      'https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json',
    );
  });

  it('declares one rule per check type', () => {
    const rules = firstRun(run()).tool.driver.rules ?? [];

    expect(rules.map((rule) => rule.id)).toStrictEqual(['access', 'behavioral', 'structural']);
  });

  it('gives every result a ruleId and a ruleIndex that resolve to a declared rule', () => {
    // A dangling ruleId renders as an untitled alert in the GitHub UI, which is the
    // failure mode that makes hand-rolled SARIF worth testing.
    const emitted = firstRun(
      run({
        checks: [failing()],
        structural: {
          specifiedNotObserved: [{ kind: 'entity', name: 'AuditLog', requirementIds: [] }],
          observedNotSpecified: [],
          fieldMismatches: [],
        },
      }),
    );
    const rules = emitted.tool.driver.rules ?? [];

    for (const result of emitted.results ?? []) {
      expect(rules[result.ruleIndex ?? -1]?.id).toBe(result.ruleId);
    }
  });

  it('maps severity to level exactly as the module states it', () => {
    const emitted = firstRun(
      run({
        checks: [
          failing({ checkId: 'CHK-1', severity: 'high', requirementId: 'REQ-001' }),
          failing({ checkId: 'CHK-2', severity: 'medium', requirementId: 'REQ-002' }),
          failing({ checkId: 'CHK-3', severity: 'low', requirementId: 'REQ-003' }),
          failing({ checkId: 'CHK-4', severity: 'info', requirementId: 'REQ-004' }),
        ],
      }),
    );

    expect((emitted.results ?? []).map((result) => result.level)).toStrictEqual([
      'error',
      'warning',
      'note',
      'note',
    ]);
  });

  it('reports only failures, so a pass and an inconclusive are not results', () => {
    const emitted = firstRun(
      run({
        checks: [
          failing({ checkId: 'CHK-p', verdict: 'pass', severity: 'info' }),
          failing({ checkId: 'CHK-i', verdict: 'inconclusive', severity: 'info' }),
        ],
      }),
    );

    expect(emitted.results).toStrictEqual([]);
  });

  it('uses a physical location with a line when the check cites source', () => {
    const result = (firstRun(run({ checks: [failing({ locationRef: 'src/routes.ts:64' })] }))
      .results ?? [])[0];

    expect(result?.locations?.[0]?.physicalLocation?.artifactLocation?.uri).toBe('src/routes.ts');
    expect(result?.locations?.[0]?.physicalLocation?.region?.startLine).toBe(64);
  });

  it('keeps a path that ends in something other than a line number intact', () => {
    // A trailing colon and digits is a line number. Anything else is part of the path,
    // and slicing it off would point the reader at a file that does not exist.
    const result = (firstRun(run({ checks: [failing({ locationRef: 'src/routes.ts' })] }))
      .results ?? [])[0];

    expect(result?.locations?.[0]?.physicalLocation?.artifactLocation?.uri).toBe('src/routes.ts');
    expect(result?.locations?.[0]?.physicalLocation?.region).toBeUndefined();
  });

  it('falls back to a logical location when no source is available', () => {
    const result = (firstRun(run({ checks: [failing()] })).results ?? [])[0];
    const logical = result?.locations?.[0]?.logicalLocations?.[0];

    expect(result?.locations?.[0]?.physicalLocation).toBeUndefined();
    expect(logical?.name).toBe('AR-014-01');
    expect(logical?.fullyQualifiedName).toBe('REQ-014/AR-014-01');
  });

  it('names the endpoint on a structural result, which does carry one', () => {
    const emitted = firstRun(
      run({
        structural: {
          specifiedNotObserved: [],
          observedNotSpecified: [
            { kind: 'endpoint', id: 'GET /api/debug/state', severity: 'medium' },
          ],
          fieldMismatches: [],
        },
      }),
    );
    const logical = (emitted.results ?? [])[0]?.locations?.[0]?.logicalLocations?.[0];

    expect(logical?.name).toBe('GET /api/debug/state');
    expect(logical?.kind).toBe('endpoint');
  });

  it('carries the entity the spec declares and the application never built', () => {
    // D6 in the fixture catalog. It is not a check failure, so without the structural
    // rule it would never reach the one surface a CI user reads.
    const emitted = firstRun(
      run({
        structural: {
          specifiedNotObserved: [{ kind: 'entity', name: 'AuditLog', requirementIds: ['REQ-007'] }],
          observedNotSpecified: [],
          fieldMismatches: [],
        },
      }),
    );
    const text = (emitted.results ?? [])[0]?.message.text ?? '';

    expect(text).toContain('AuditLog');
    expect(text).toContain('REQ-007');
    expect((emitted.results ?? [])[0]?.ruleId).toBe('structural');
  });

  it('puts the request and response summary in the message, so the UI needs no second page', () => {
    const text = (firstRun(run({ checks: [failing()] })).results ?? [])[0]?.message.text ?? '';
    const lines = text.split('\n');

    // Title first, on its own line. A code scanning list shows the leading line, so a
    // title that runs into the request summary is what a reviewer sees in the list.
    expect(lines[0]).toBe('Invoice readable by user outside owning organization');
    expect(lines[1]).toBe(
      'GET /api/invoices/INV-1001 as actor outsider returned 200 with fields id, org_id',
    );
    expect(text).toContain('Evidence: EV-7d10b3');
  });

  it('labels a model assisted result as one', () => {
    const text =
      (firstRun(run({ checks: [failing({ deterministic: false })] })).results ?? [])[0]?.message
        .text ?? '';

    expect(text).toContain('Model assisted');
  });

  it('fingerprints a check result by its content hashed check id', () => {
    // Without this GitHub opens a new alert every run rather than tracking one.
    const result = (firstRun(run({ checks: [failing()] })).results ?? [])[0];

    expect(result?.partialFingerprints).toStrictEqual({ qaiCheckId: 'CHK-a91f2c' });
  });

  it('orders results by severity and then by requirement id', () => {
    const emitted = firstRun(
      run({
        checks: [
          failing({ checkId: 'CHK-1', severity: 'medium', requirementId: 'REQ-020' }),
          failing({ checkId: 'CHK-2', severity: 'high', requirementId: 'REQ-030' }),
          failing({ checkId: 'CHK-3', severity: 'medium', requirementId: 'REQ-010' }),
          failing({ checkId: 'CHK-4', severity: 'high', requirementId: 'REQ-005' }),
        ],
      }),
    );

    expect(
      (emitted.results ?? []).map((result) => result.properties?.['requirementId']),
    ).toStrictEqual(['REQ-005', 'REQ-030', 'REQ-010', 'REQ-020']);
  });

  it('reports the invocation as successful even when the run found things', () => {
    // Whether findings exist is what `level` says. Reporting the tool as having failed
    // would make a working run look like a broken one in the checks tab.
    const emitted = firstRun(run({ checks: [failing()] }));

    expect(emitted.invocations?.[0]?.executionSuccessful).toBe(true);
    expect(emitted.automationDetails?.id).toBe('RUN-20260818-0001');
  });

  it('states coverage as coverage in the run properties, never as a pass rate', () => {
    const rendered = renderSarif(run({ checks: [failing()] }));
    const emitted = firstRun(run({ checks: [failing()] }));

    expect(emitted.properties?.['coverageMeaning']).toBe(
      'requirements with at least one check that reached a verdict',
    );
    expect(rendered.toLowerCase()).not.toContain('pass rate');
  });

  it('produces identical bytes when rendered twice', () => {
    const withEverything = run({
      checks: [failing(), failing({ checkId: 'CHK-z', severity: 'low' })],
      structural: {
        specifiedNotObserved: [{ kind: 'entity', name: 'AuditLog', requirementIds: ['REQ-007'] }],
        observedNotSpecified: [{ kind: 'endpoint', id: 'GET /health', severity: 'info' }],
        fieldMismatches: [
          { entity: 'Invoice', specifiedNotObserved: ['notes'], observedNotSpecified: ['x'] },
        ],
      },
    });

    expect(renderSarif(withEverything)).toBe(renderSarif(withEverything));
  });

  it('writes no evidence body into the document, per rule R8', () => {
    // The emitter reads no evidence, only the ids and the summary the check already
    // redacted, so there is nothing here that could carry a body.
    const rendered = renderSarif(
      run({
        checks: [
          failing({
            detail: 'GET /api/invoices/INV-1001 as actor outsider returned 200 with fields id',
          }),
        ],
      }),
    );

    expect(rendered).not.toContain('bodyRef');
    expect(rendered).not.toContain('authorization');
    expect(rendered).toContain('EV-7d10b3');
  });

  it('contains no em dash', () => {
    expect(renderSarif(run({ checks: [failing()] }))).not.toContain('—');
  });
});
