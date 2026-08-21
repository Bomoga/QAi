import { describe, expect, it } from 'vitest';

import type { RunResult } from '../../packages/core/src/index.ts';
import {
  EMPTY_LEDGER,
  FALSE_POSITIVE_THRESHOLD,
  falsePositiveRates,
  findingsOf,
  mergeFindings,
  type Ledger,
  type LedgerEntry,
} from './ledger.ts';

/**
 * The ledger holds the most expensive thing this stage produces: a human's judgement of
 * every finding, one at a time. Losing one means reviewing it again.
 *
 * The rate computed from it is the number the project has to be able to defend, so the
 * assertions here are about the ways a rate can flatter itself: counting a passing check,
 * folding unclear into either side, dividing by nothing, or reporting a partial review as
 * a finished one.
 */

function run(overrides: Partial<RunResult> = {}): RunResult {
  return {
    resultVersion: '0.1',
    runId: 'RUN-20260821-000001',
    toolVersion: '0.1.0',
    startedAt: '2026-08-21T00:00:00Z',
    finishedAt: '2026-08-21T00:00:10Z',
    spec: { hash: 'sha256:abc', specVersion: '0.1', files: ['spec/app.spec.yaml'] },
    target: { baseUrl: 'http://127.0.0.1:47810' },
    requirements: [],
    checks: [],
    structural: { specifiedNotObserved: [], observedNotSpecified: [], fieldMismatches: [] },
    summary: {
      requirements: { total: 0, verified: 0, failed: 0, unverified: 0 },
      checks: { total: 0, pass: 0, fail: 0, inconclusive: 0 },
      coverage: 0,
      findingsBySeverity: { high: 0, medium: 0, low: 0, info: 0 },
      modelAssistedCheckCount: 0,
    },
    unverifiedReasons: [],
    ...overrides,
  } as RunResult;
}

function check(overrides: Partial<RunResult['checks'][number]> = {}): RunResult['checks'][number] {
  return {
    checkId: 'CHK-a',
    type: 'access',
    requirementId: 'REQ-001',
    ruleId: 'AR-001-01',
    verdict: 'fail',
    deterministic: true,
    severity: 'high',
    title: 'A deny rule did not deny',
    evidence: [],
    ...overrides,
  } as RunResult['checks'][number];
}

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    app: 'invoicing',
    findingId: 'CHK-a',
    type: 'access',
    severity: 'high',
    title: 'A deny rule did not deny',
    ruleId: 'AR-001-01',
    classification: 'unreviewed',
    ...overrides,
  };
}

function ledgerOf(...entries: LedgerEntry[]): Ledger {
  return { version: '0.1', entries };
}

describe('collecting the findings a run produced', () => {
  it('counts a failed check and never a passing one', () => {
    // A passing check carries info severity and was never a finding. Counting one would
    // put work the tool got right into the denominator and flatter the rate.
    const findings = findingsOf(
      'invoicing',
      run({
        checks: [
          check(),
          check({ checkId: 'CHK-b', verdict: 'pass', severity: 'info' }),
          check({ checkId: 'CHK-c', verdict: 'inconclusive' }),
        ],
      }),
    );

    expect(findings.map((one) => one.findingId)).toStrictEqual(['CHK-a']);
  });

  it('counts the structural disagreements, which are findings too', () => {
    const findings = findingsOf(
      'invoicing',
      run({
        structural: {
          specifiedNotObserved: [{ kind: 'entity', name: 'AuditLog', requirementIds: [] }],
          observedNotSpecified: [{ kind: 'endpoint', id: 'GET /api/debug', severity: 'medium' }],
          fieldMismatches: [
            { entity: 'Invoice', specifiedNotObserved: [], observedNotSpecified: ['notes'] },
          ],
        },
      } as Partial<RunResult>),
    );

    expect(findings).toHaveLength(3);
    expect(findings.every((one) => one.type === 'structural')).toBe(true);
  });

  it('does not count a field mismatch that mismatches nothing', () => {
    const findings = findingsOf(
      'invoicing',
      run({
        structural: {
          specifiedNotObserved: [],
          observedNotSpecified: [],
          fieldMismatches: [
            { entity: 'Invoice', specifiedNotObserved: [], observedNotSpecified: [] },
          ],
        },
      } as Partial<RunResult>),
    );

    expect(findings).toStrictEqual([]);
  });

  it('arrives unreviewed, because nobody has looked at it yet', () => {
    expect(findingsOf('invoicing', run({ checks: [check()] }))[0]?.classification).toBe(
      'unreviewed',
    );
  });
});

describe('keeping a review across runs', () => {
  it('keeps a classification when the finding is still there', () => {
    // The point of the whole ledger. checkId is a content hash, so the same finding on
    // the same application is the same finding next week, and reviewing it again would
    // be repeating the expensive step for nothing.
    const before = ledgerOf(
      entry({ classification: 'false-positive', note: 'the route requires auth in a middleware' }),
    );

    const { ledger, added } = mergeFindings(
      before,
      findingsOf('invoicing', run({ checks: [check()] })),
    );

    expect(added).toStrictEqual([]);
    expect(ledger.entries[0]?.classification).toBe('false-positive');
    expect(ledger.entries[0]?.note).toBe('the route requires auth in a middleware');
  });

  it('refreshes everything except the human judgement', () => {
    // A title or a severity can change without the finding becoming a different finding.
    // The classification and the note are the only things a run must not overwrite.
    const before = ledgerOf(
      entry({ classification: 'true-positive', title: 'the old wording', severity: 'low' }),
    );

    const { ledger } = mergeFindings(
      before,
      findingsOf('invoicing', run({ checks: [check({ title: 'the new wording' })] })),
    );

    expect(ledger.entries[0]?.title).toBe('the new wording');
    expect(ledger.entries[0]?.severity).toBe('high');
    expect(ledger.entries[0]?.classification).toBe('true-positive');
  });

  it('names a finding that is new, so a reviewer knows what is waiting', () => {
    const { ledger, added } = mergeFindings(
      ledgerOf(entry({ classification: 'true-positive' })),
      findingsOf('invoicing', run({ checks: [check(), check({ checkId: 'CHK-new' })] })),
    );

    expect(added).toStrictEqual(['CHK-new']);
    expect(ledger.entries.find((one) => one.findingId === 'CHK-new')?.classification).toBe(
      'unreviewed',
    );
  });

  it('keeps a review whose finding has gone, and says it has gone', () => {
    // A finding that vanished because somebody fixed the application is a fact worth
    // keeping. Dropping it would throw away the most expensive step in the procedure.
    const { ledger, absent } = mergeFindings(
      ledgerOf(entry({ findingId: 'CHK-fixed', classification: 'true-positive', note: 'real' })),
      findingsOf('invoicing', run({ checks: [check()] })),
    );

    expect(absent).toStrictEqual(['CHK-fixed']);
    expect(ledger.entries.find((one) => one.findingId === 'CHK-fixed')?.note).toBe('real');
  });

  it('marks a kept review the run no longer produced', () => {
    // The mark is what keeps a repaired false positive out of the rate. Without it the
    // entry stays in the denominator forever and fixing the cause cannot move the
    // number, which would make the measurement blind to exactly the work it asks for.
    const { ledger } = mergeFindings(
      ledgerOf(entry({ findingId: 'CHK-fixed', classification: 'false-positive', note: 'was' })),
      findingsOf('invoicing', run({ checks: [check()] })),
    );

    expect(ledger.entries.find((one) => one.findingId === 'CHK-fixed')?.absent).toBe(true);
    expect(ledger.entries.find((one) => one.findingId === 'CHK-a')?.absent).toBeUndefined();
  });

  it('unmarks a finding that came back', () => {
    // An application regressing, or a corpus application being added, brings a finding
    // back. It is rebuilt from the run, so the mark goes with it and the review stays.
    const gone = ledgerOf(
      entry({ findingId: 'CHK-a', classification: 'false-positive', note: 'was', absent: true }),
    );

    const { ledger } = mergeFindings(gone, findingsOf('invoicing', run({ checks: [check()] })));

    expect(ledger.entries[0]?.absent).toBeUndefined();
    expect(ledger.entries[0]?.classification).toBe('false-positive');
  });

  it('does not confuse the same check id in two applications', () => {
    // Two applications can produce the same check id, because the hash is over what the
    // check is and both specs can say the same thing. The ledger is keyed by both.
    const before = ledgerOf(entry({ app: 'one', classification: 'false-positive' }));

    const { ledger } = mergeFindings(before, [entry({ app: 'one' }), entry({ app: 'two' })]);

    expect(ledger.entries.find((e) => e.app === 'one')?.classification).toBe('false-positive');
    expect(ledger.entries.find((e) => e.app === 'two')?.classification).toBe('unreviewed');
  });

  it('starts from nothing without special casing', () => {
    const findings = findingsOf('invoicing', run({ checks: [check()] }));
    const { ledger, added, absent } = mergeFindings(EMPTY_LEDGER, findings);

    expect(ledger.entries).toHaveLength(1);
    expect(added).toStrictEqual(['CHK-a']);
    expect(absent).toStrictEqual([]);
  });
});

describe('the false positive rate', () => {
  it('is false positives over what was actually judged', () => {
    const rates = falsePositiveRates(
      ledgerOf(
        entry({ findingId: 'a', classification: 'true-positive' }),
        entry({ findingId: 'b', classification: 'true-positive' }),
        entry({ findingId: 'c', classification: 'true-positive' }),
        entry({ findingId: 'd', classification: 'false-positive' }),
      ),
    );

    expect(rates.overall.judged).toBe(4);
    expect(rates.overall.rate).toBe(0.25);
  });

  it('leaves unclear out of the rate and reports it', () => {
    // Invariant I4's rule applied here: a reviewer who cannot tell has recorded a fact.
    // Folding those into either side would manufacture a number nobody decided.
    const rates = falsePositiveRates(
      ledgerOf(
        entry({ findingId: 'a', classification: 'true-positive' }),
        entry({ findingId: 'b', classification: 'unclear' }),
        entry({ findingId: 'c', classification: 'unclear' }),
      ),
    );

    expect(rates.overall.unclear).toBe(2);
    expect(rates.overall.judged).toBe(1);
    expect(rates.overall.rate).toBe(0);
  });

  it('reports no rate at all rather than zero when nothing was judged', () => {
    // Zero would read as a check that never fires wrongly. The truth is that nobody has
    // looked, which is the same distinction renderText draws for an absent observation.
    const rates = falsePositiveRates(ledgerOf(entry({ classification: 'unreviewed' })));

    expect(rates.overall.rate).toBeUndefined();
    expect(rates.overall.aboveThreshold).toBe(false);
  });

  it('says a rate is incomplete while anything is unreviewed', () => {
    // A number that looks finished and is not is worse than no number, and this is the
    // number the whole stage exists to defend.
    const partial = falsePositiveRates(
      ledgerOf(
        entry({ findingId: 'a', classification: 'true-positive' }),
        entry({ findingId: 'b', classification: 'unreviewed' }),
      ),
    );
    expect(partial.overall.complete).toBe(false);
    expect(partial.overall.rate).toBe(0);

    const done = falsePositiveRates(ledgerOf(entry({ classification: 'true-positive' })));
    expect(done.overall.complete).toBe(true);
  });

  it('flags a check strictly above five percent, and not one exactly at it', () => {
    // The plan says above five percent. One in twenty is five percent exactly and ships;
    // two in twenty does not. Asserted at the boundary in both directions, since an
    // inclusive comparison would disable a check the plan permits.
    const at = ledgerOf(
      ...Array.from({ length: 19 }, (_, index) =>
        entry({ findingId: `tp-${index}`, classification: 'true-positive' }),
      ),
      entry({ findingId: 'fp-0', classification: 'false-positive' }),
    );
    expect(falsePositiveRates(at).overall.rate).toBe(FALSE_POSITIVE_THRESHOLD);
    expect(falsePositiveRates(at).overall.aboveThreshold).toBe(false);

    const over = ledgerOf(
      ...Array.from({ length: 18 }, (_, index) =>
        entry({ findingId: `tp-${index}`, classification: 'true-positive' }),
      ),
      entry({ findingId: 'fp-0', classification: 'false-positive' }),
      entry({ findingId: 'fp-1', classification: 'false-positive' }),
    );
    expect(falsePositiveRates(over).overall.aboveThreshold).toBe(true);
  });

  it('counts only what the latest run produced, and says how much it held aside', () => {
    // The rate answers how often a finding the tool produces is wrong. A review of
    // something it no longer reports belongs in the ledger and not in the denominator,
    // and the count is printed so the narrowing is visible rather than silent.
    const rates = falsePositiveRates(
      ledgerOf(
        entry({ findingId: 'a', classification: 'true-positive' }),
        entry({ findingId: 'b', classification: 'true-positive' }),
        entry({ findingId: 'c', classification: 'false-positive', absent: true }),
        entry({ findingId: 'd', classification: 'false-positive', absent: true }),
      ),
    );

    expect(rates.heldAside).toBe(2);
    expect(rates.overall.judged).toBe(2);
    expect(rates.overall.rate).toBe(0);
    expect(rates.byType[0]?.rate.judged).toBe(2);
  });

  it('breaks the rate down by check type and by rule', () => {
    const rates = falsePositiveRates(
      ledgerOf(
        entry({ findingId: 'a', type: 'access', ruleId: 'AR-1', classification: 'false-positive' }),
        entry({ findingId: 'b', type: 'access', ruleId: 'AR-1', classification: 'false-positive' }),
        entry({
          findingId: 'c',
          type: 'behavioral',
          ruleId: 'AC-1',
          classification: 'true-positive',
        }),
      ),
    );

    expect(rates.byType.find((one) => one.type === 'access')?.rate.rate).toBe(1);
    expect(rates.byType.find((one) => one.type === 'behavioral')?.rate.rate).toBe(0);
    expect(rates.byRule.find((one) => one.ruleId === 'AR-1')?.rate.rate).toBe(1);
  });

  it('names everything over the threshold, so a summary cannot omit one', () => {
    const rates = falsePositiveRates(
      ledgerOf(
        entry({ findingId: 'a', type: 'access', ruleId: 'AR-1', classification: 'false-positive' }),
        entry({
          findingId: 'b',
          type: 'behavioral',
          ruleId: 'AC-1',
          classification: 'true-positive',
        }),
      ),
    );

    expect(rates.overThreshold).toContain('access');
    expect(rates.overThreshold).toContain('AR-1');
    expect(rates.overThreshold).not.toContain('behavioral');
  });

  it('holds over an empty ledger rather than dividing by nothing', () => {
    const rates = falsePositiveRates(EMPTY_LEDGER);

    expect(rates.overall.rate).toBeUndefined();
    expect(rates.byType).toStrictEqual([]);
    expect(rates.overThreshold).toStrictEqual([]);
  });
});
