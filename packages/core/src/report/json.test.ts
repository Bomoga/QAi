import { describe, expect, it } from 'vitest';

import { RunResultSchema, type RunResult } from '../contracts/index.ts';
import { renderJson } from './json.ts';

/**
 * This is the golden format, so the tests are about bytes rather than about shape. A
 * golden file that changed when nothing changed would be worse than no golden file.
 */

function run(overrides: Partial<RunResult> = {}): RunResult {
  return {
    resultVersion: '0.1',
    runId: 'RUN-20260818-0001',
    toolVersion: '0.1.0',
    startedAt: '2026-08-18T00:00:00Z',
    finishedAt: '2026-08-18T00:00:10Z',
    spec: { hash: 'sha256:abc', specVersion: '0.1', files: ['spec/ledger.spec.yaml'] },
    target: { baseUrl: 'http://127.0.0.1:3000' },
    requirements: [
      {
        requirementId: 'REQ-001',
        verdict: 'verified',
        reason: '1 of 1 check(s) passed',
        checkIds: ['CHK-1'],
      },
    ],
    checks: [
      {
        checkId: 'CHK-1',
        type: 'access',
        requirementId: 'REQ-001',
        verdict: 'pass',
        deterministic: true,
        severity: 'info',
        title: 'A check',
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

describe('rendering a run as JSON', () => {
  it('produces identical bytes when rendered twice', () => {
    expect(renderJson(run())).toBe(renderJson(run()));
  });

  it('produces identical bytes when the same content was built in a different order', () => {
    // The thing a golden file has to be immune to. `JSON.stringify` alone fails this.
    const forward = run();
    const shuffled: Record<string, unknown> = {};
    for (const key of Object.keys(forward).reverse()) {
      shuffled[key] = (forward as unknown as Record<string, unknown>)[key];
    }

    expect(renderJson(shuffled as unknown as RunResult)).toBe(renderJson(forward));
    expect(JSON.stringify(shuffled)).not.toBe(JSON.stringify(forward));
  });

  it('sorts keys at every level, not only the top', () => {
    const rendered = renderJson(run());
    const summary = rendered.slice(rendered.indexOf('"summary"'));

    expect(summary.indexOf('"checks"')).toBeLessThan(summary.indexOf('"coverage"'));
    expect(summary.indexOf('"coverage"')).toBeLessThan(summary.indexOf('"findingsBySeverity"'));
  });

  it('leaves array order alone, since array order carries meaning here', () => {
    // `assembleRun` puts requirements in spec order so two runs read down the same list.
    // Sorting them by id would quietly destroy that.
    const rendered = renderJson(
      run({
        checks: [],
        requirements: [
          { requirementId: 'REQ-003', verdict: 'verified', checkIds: [] },
          { requirementId: 'REQ-001', verdict: 'verified', checkIds: [] },
        ],
      }),
    );

    // Scoped to the requirements block on purpose. A requirement id also appears inside
    // `checks`, which sorts earlier, so searching the whole document would find the wrong
    // occurrence and pass or fail for a reason that has nothing to do with array order.
    const requirements = rendered.slice(rendered.indexOf('"requirements"'));
    expect(requirements.indexOf('REQ-003')).toBeLessThan(requirements.indexOf('REQ-001'));
  });

  it('round trips into something the contract schema still accepts', () => {
    const parsed: unknown = JSON.parse(renderJson(run()));

    expect(RunResultSchema.safeParse(parsed).success).toBe(true);
  });

  it('omits an absent optional field rather than writing null', () => {
    // A strict schema rejects `null` where it expects an absent optional string, so
    // writing null here would make the output fail to load back.
    const rendered = renderJson(run());

    expect(rendered).not.toContain('null');
    expect(rendered).not.toContain('"observation"');
  });

  it('keeps a field that is present, including one that is false or zero', () => {
    const rendered = renderJson(run());

    expect(rendered).toContain('"deterministic": true');
    expect(rendered).toContain('"modelAssistedCheckCount": 0');
  });

  it('is indented for a reader and ends with a newline', () => {
    const rendered = renderJson(run());

    expect(rendered).toContain('\n  "checks"');
    expect(rendered.endsWith('}\n')).toBe(true);
  });
});
