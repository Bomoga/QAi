import { describe, expect, it } from 'vitest';

import type { RunResult, Severity } from '../contracts/index.ts';
import { computeExitCode } from './exit-code.ts';

const SEVERITIES: readonly Severity[] = ['high', 'medium', 'low', 'info'];

function run(overrides: Partial<RunResult['summary']> = {}): RunResult {
  return {
    resultVersion: '0.1',
    runId: 'RUN-20260818-0001',
    toolVersion: '0.1.0',
    startedAt: '2026-08-18T00:00:00Z',
    finishedAt: '2026-08-18T00:00:10Z',
    spec: { hash: 'sha256:abc', specVersion: '0.1', files: [] },
    target: {},
    requirements: [],
    checks: [],
    structural: { specifiedNotObserved: [], observedNotSpecified: [], fieldMismatches: [] },
    summary: {
      requirements: { total: 1, verified: 1, failed: 0, unverified: 0 },
      checks: { total: 1, pass: 1, fail: 0, inconclusive: 0 },
      coverage: 1,
      findingsBySeverity: { high: 0, medium: 0, low: 0, info: 0 },
      modelAssistedCheckCount: 0,
      ...overrides,
    },
    unverifiedReasons: [],
  } as RunResult;
}

/** One finding at the given severity and nothing else. */
function withFinding(severity: Severity): RunResult {
  return run({
    findingsBySeverity: { high: 0, medium: 0, low: 0, info: 0, [severity]: 1 } as Record<
      Severity,
      number
    >,
    checks: { total: 1, pass: 0, fail: 1, inconclusive: 0 },
    requirements: { total: 1, verified: 0, failed: 1, unverified: 0 },
  });
}

describe('computing the exit code a run recommends', () => {
  it('exits 0 on a clean run', () => {
    expect(computeExitCode(run(), {})).toBe(0);
  });

  it('defaults the threshold to high, per the exit code table', () => {
    expect(computeExitCode(withFinding('high'), {})).toBe(1);
    expect(computeExitCode(withFinding('medium'), {})).toBe(0);
    expect(computeExitCode(withFinding('low'), {})).toBe(0);
    expect(computeExitCode(withFinding('info'), {})).toBe(0);
  });

  it('fails on a finding at or above the threshold, over the whole table', () => {
    // Read as a grid rather than as four lookups, so a comparator inverted in one
    // direction cannot pass by agreeing with itself.
    const grid = SEVERITIES.map((threshold) =>
      SEVERITIES.map((severity) => computeExitCode(withFinding(severity), { failOn: threshold })),
    );

    expect(grid).toStrictEqual([
      // failOn high: only high
      [1, 0, 0, 0],
      // failOn medium: high and medium
      [1, 1, 0, 0],
      // failOn low: everything but info
      [1, 1, 1, 0],
      // failOn info: everything
      [1, 1, 1, 1],
    ]);
  });

  it('fails when a finding above the threshold is present alongside one below it', () => {
    const mixed = run({
      findingsBySeverity: { high: 1, medium: 0, low: 3, info: 9 },
      checks: { total: 13, pass: 0, fail: 13, inconclusive: 0 },
    });

    expect(computeExitCode(mixed, { failOn: 'medium' })).toBe(1);
  });

  it('does not fail on an inconclusive check by itself', () => {
    // 03-CONTRACTS.md states this directly. An inconclusive check is not a finding and
    // carries no severity into `findingsBySeverity`.
    const inconclusive = run({
      checks: { total: 4, pass: 0, fail: 0, inconclusive: 4 },
      requirements: { total: 2, verified: 0, failed: 0, unverified: 2 },
      coverage: 0,
    });

    expect(computeExitCode(inconclusive, {})).toBe(0);
    expect(computeExitCode(inconclusive, { failOn: 'info' })).toBe(0);
  });

  it('fails on an unverified requirement only when the caller opts in', () => {
    const gaps = run({
      requirements: { total: 3, verified: 2, failed: 0, unverified: 1 },
      coverage: 2 / 3,
    });

    expect(computeExitCode(gaps, {})).toBe(0);
    expect(computeExitCode(gaps, { failOnUnverified: false })).toBe(0);
    expect(computeExitCode(gaps, { failOnUnverified: true })).toBe(1);
  });

  it('leaves the opt in inert when nothing is unverified', () => {
    expect(computeExitCode(run(), { failOnUnverified: true })).toBe(0);
  });

  it('reads unverified requirements rather than inconclusive checks for the opt in', () => {
    // A requirement with one inconclusive check and one that passed is verified, and it
    // is not a coverage gap. Counting checks here would fail a run that has none.
    const partial = run({
      checks: { total: 2, pass: 1, fail: 0, inconclusive: 1 },
      requirements: { total: 1, verified: 1, failed: 0, unverified: 0 },
    });

    expect(computeExitCode(partial, { failOnUnverified: true })).toBe(0);
  });

  it('returns only 0 or 1, never a code that belongs to the CLI', () => {
    // 2 and 3 describe a run that did not happen or did not finish, and a function handed
    // a finished RunResult is by construction in neither case.
    const codes = new Set(
      SEVERITIES.flatMap((severity) =>
        SEVERITIES.flatMap((threshold) => [
          computeExitCode(withFinding(severity), { failOn: threshold }),
          computeExitCode(withFinding(severity), { failOn: threshold, failOnUnverified: true }),
        ]),
      ),
    );

    expect([...codes].sort()).toStrictEqual([0, 1]);
  });

  it('computes without exiting, per rule R5', () => {
    // The guarantee is structural: this returns a number. A test can only state that the
    // process survived calling it, which is what it does.
    expect(typeof computeExitCode(withFinding('high'), {})).toBe('number');
  });
});
