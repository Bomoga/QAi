import { describe, expect, it } from 'vitest';

import type { RunResult } from '../../packages/core/src/index.ts';
import { classifyCheckExit, describeCoverage } from './outcome.ts';

/**
 * The rule that decides what lands in the corpus and what is reported as a gap.
 *
 * Getting it wrong in one direction drops every application that had findings, which is
 * every application worth measuring. Getting it wrong in the other counts an application
 * whose spec never loaded as a clean result, which is a false denominator.
 */

describe('what an exit code means to a corpus run', () => {
  it('counts a clean run as checked', () => {
    expect(classifyCheckExit(0)).toStrictEqual({ kind: 'checked', exitCode: 0 });
  });

  it('counts a run that found something as checked, because that is the point', () => {
    // 1 is a completed run with findings at or above the threshold. An application with
    // findings is the interesting case, not a failure of the corpus run.
    expect(classifyCheckExit(1)).toStrictEqual({ kind: 'checked', exitCode: 1 });
  });

  it('treats a spec or configuration error as a gap, not a result', () => {
    // 2 is a run that did not happen. There are no findings to review, so it must not
    // read as an application that came back clean.
    const outcome = classifyCheckExit(2, 'error: no configuration was found\n  at qai.config.yaml');

    expect(outcome.kind).toBe('check-failed');
    expect(outcome.kind === 'check-failed' && outcome.reason).toContain('exited 2');
    expect(outcome.kind === 'check-failed' && outcome.reason).toContain('no configuration');
  });

  it('treats an unreachable target as a gap too', () => {
    expect(classifyCheckExit(3, 'error: could not reach the target').kind).toBe('check-failed');
  });

  it('never reports any other code as checked', () => {
    // Swept rather than asserted one at a time, since the risk is a new code drifting
    // into the accepted set later.
    for (const code of [-1, 2, 3, 4, 5, 42, 127, 255]) {
      expect(classifyCheckExit(code).kind, `exit ${code}`).toBe('check-failed');
    }
  });

  it('carries the reason without demanding one', () => {
    // stderr that is empty, or that is only whitespace, still produces a usable sentence
    // rather than one ending in a colon with nothing after it.
    const bare = classifyCheckExit(2);
    expect(bare.kind === 'check-failed' ? bare.reason : '').toBe('qai check exited 2');

    const blank = classifyCheckExit(2, '   \n  \n ');
    expect(blank.kind === 'check-failed' ? blank.reason : '').toBe('qai check exited 2');
  });
});

describe('the coverage line', () => {
  function result(
    requirements: RunResult['summary']['requirements'],
    unverifiedReasons: RunResult['unverifiedReasons'] = [],
  ): RunResult {
    return {
      summary: { requirements },
      unverifiedReasons,
    } as RunResult;
  }

  it('states what was and was not established', () => {
    const line = describeCoverage(result({ total: 8, verified: 6, failed: 1, unverified: 1 }));
    expect(line).toBe('6 verified, 1 failed, 1 unverified of 8 requirement(s)');
  });

  it('names why a requirement went unverified, which is the part nobody was seeing', () => {
    // Five of the first six corpus applications carried a criterion the vocabulary could
    // not read. Each checked, exited 0, and said nothing about it. The reason is the
    // whole value of the line.
    const line = describeCoverage(
      result({ total: 8, verified: 5, failed: 1, unverified: 2 }, [
        { requirementId: 'REQ-002', reason: 'unsupported-condition' },
        { requirementId: 'REQ-006', reason: 'no-checks-defined' },
      ]),
    );

    expect(line).toContain('unverified for no-checks-defined, unsupported-condition');
  });

  it('names a reason once however many requirements carry it', () => {
    const line = describeCoverage(
      result({ total: 4, verified: 2, failed: 0, unverified: 2 }, [
        { requirementId: 'REQ-001', reason: 'unsupported-condition' },
        { requirementId: 'REQ-002', reason: 'unsupported-condition' },
      ]),
    );

    expect(line).toBe(
      '2 verified, 0 failed, 2 unverified of 4 requirement(s), unverified for unsupported-condition',
    );
  });
});
