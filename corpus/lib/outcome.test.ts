import { describe, expect, it } from 'vitest';

import { classifyCheckExit } from './outcome.ts';

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
