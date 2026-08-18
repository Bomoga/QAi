import { describe, expect, it } from 'vitest';

import { collectCoverageGaps, formatCoverageGap } from './gaps.ts';

/**
 * The point of this function is that a caller cannot drop a gap by remembering two of the
 * three places gaps come from, so most of these are about nothing going missing.
 */

const accessGap = {
  requirementId: 'REQ-011',
  ruleId: 'AR-011-01',
  reason: 'unsupported-condition' as const,
  detail: 'No route is known for read on "User".',
};

const criterionGap = {
  requirementId: 'REQ-002',
  criterionId: 'AC-002-01',
  reason: 'unsupported-condition' as const,
  detail: 'its then clause could not be read',
};

const fuzzyGap = {
  requirementId: 'REQ-005',
  criterionId: 'AC-005-02',
  reason: 'capability-unavailable' as const,
  detail: 'Playwright is not installed',
};

describe('gathering coverage gaps', () => {
  it('takes all three sources, since remembering two is how one gets lost', () => {
    const gaps = collectCoverageGaps({
      accessUnplannable: [accessGap],
      behavioralUnplannable: [criterionGap],
      behavioralUnverified: [fuzzyGap],
    });

    expect(gaps.map((gap) => gap.id)).toEqual(['AC-002-01', 'AC-005-02', 'AR-011-01']);
  });

  it('says which side each came from, since the fix differs', () => {
    const gaps = collectCoverageGaps({
      accessUnplannable: [accessGap],
      behavioralUnplannable: [criterionGap],
    });

    expect(gaps.find((gap) => gap.id === 'AR-011-01')?.kind).toBe('access');
    expect(gaps.find((gap) => gap.id === 'AC-002-01')?.kind).toBe('behavioral');
  });

  it('orders by requirement then id, so two runs compare by eye', () => {
    const gaps = collectCoverageGaps({
      behavioralUnplannable: [
        { ...criterionGap, requirementId: 'REQ-014', criterionId: 'AC-014-02' },
        { ...criterionGap, requirementId: 'REQ-014', criterionId: 'AC-014-01' },
        criterionGap,
      ],
    });

    expect(gaps.map((gap) => `${gap.requirementId} ${gap.id}`)).toEqual([
      'REQ-002 AC-002-01',
      'REQ-014 AC-014-01',
      'REQ-014 AC-014-02',
    ]);
  });

  it('reports one criterion once when two sources both name it', () => {
    const gaps = collectCoverageGaps({
      behavioralUnplannable: [{ ...criterionGap, criterionId: 'AC-005-02' }],
      behavioralUnverified: [{ ...fuzzyGap, requirementId: 'REQ-002' }],
    });

    // Planning runs before the runner, so its reason is the earlier and more actionable
    // one. The same gap listed twice reads as two problems.
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.reason).toBe('unsupported-condition');
  });

  it('keeps two gaps on one requirement, since each names a different thing to fix', () => {
    const gaps = collectCoverageGaps({
      accessUnplannable: [accessGap, { ...accessGap, ruleId: 'AR-011-02' }],
    });

    expect(gaps.map((gap) => gap.id)).toEqual(['AR-011-01', 'AR-011-02']);
  });

  it('returns nothing when a run has no gaps at all', () => {
    expect(collectCoverageGaps({})).toEqual([]);
    expect(collectCoverageGaps({ accessUnplannable: [], behavioralUnplannable: [] })).toEqual([]);
  });

  it('formats a line naming the thing, the reason, and what to do', () => {
    const [gap] = collectCoverageGaps({ accessUnplannable: [accessGap] });

    const line = formatCoverageGap(gap as NonNullable<typeof gap>);
    expect(line).toContain('AR-011-01');
    expect(line).toContain('unsupported-condition');
    expect(line).toContain('No route is known');
  });
});
