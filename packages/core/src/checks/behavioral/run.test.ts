import { describe, expect, it } from 'vitest';

import type { CapturedResponse, RequestSpec } from '../../target/request.ts';
import type { ActorSession } from '../../target/session.ts';
import type { BrowserLauncher } from './browser.ts';
import { loadLauncher } from './browser.ts';
import type { Judge, JudgeAnswer, JudgeQuestion } from './judge.ts';
import { runBehavioralChecks } from './run.ts';
import type { BehavioralPlan } from './types.ts';

/**
 * Graceful degradation when Playwright is absent, which is this repository's actual
 * state rather than a mock of it. `loadLauncher` is exercised against reality here: the
 * optional dependency is genuinely not installed, so the unavailable path is the one
 * that runs, and a test asserts that premise before the rest lean on it.
 *
 * The judges are declared here rather than imported from `llm/`. Rule R1 forbids
 * anything under `checks/` importing that directory and lint enforces it for tests as
 * much as for runners. A boundary a test may cross is not a boundary.
 */

function response(overrides: Partial<CapturedResponse> = {}): CapturedResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: '{"status":"ok"}',
    truncated: false,
    durationMs: 4,
    ...overrides,
  };
}

function sessions(sent: RequestSpec[] = []): ReadonlyMap<string, ActorSession> {
  const session = {
    id: 'anonymous',
    attributes: {},
    request(spec: RequestSpec) {
      sent.push(spec);
      return Promise.resolve({
        outcome: { kind: 'response' as const, response: response() },
        evidenceId: 'EV-000001',
        evidence: {} as never,
      });
    },
  };

  return new Map([['anonymous', session]]);
}

function plan(overrides: Partial<BehavioralPlan> = {}): BehavioralPlan {
  return {
    identity: { type: 'behavioral', requirementId: 'REQ-015', ruleId: 'AC-015-01' },
    mutates: false,
    severityOnFail: 'medium',
    requirementId: 'REQ-015',
    criterionId: 'AC-015-01',
    actorId: 'anonymous',
    request: { method: 'GET', path: '/health' },
    assertions: [{ kind: 'status', codes: [200] }],
    mode: 'deterministic',
    given: 'the running application',
    when: 'actor anonymous requests /health',
    then: 'status is 200',
    ...overrides,
  };
}

function fuzzyPlan(overrides: Partial<BehavioralPlan> = {}): BehavioralPlan {
  return plan({
    identity: { type: 'behavioral', requirementId: 'REQ-005', ruleId: 'AC-005-02' },
    requirementId: 'REQ-005',
    criterionId: 'AC-005-02',
    request: { method: 'GET', path: '/' },
    assertions: [],
    mode: 'fuzzy',
    when: 'actor anonymous requests /',
    then: 'the page offers no administrative or debug route',
    ...overrides,
  });
}

/** A judge that records whether it was consulted at all, which is the point of most of these. */
function countingJudge(answer: JudgeAnswer = 'satisfied'): Judge & { asked: JudgeQuestion[] } {
  const asked: JudgeQuestion[] = [];
  return {
    asked,
    judge(question: JudgeQuestion) {
      asked.push(question);
      return Promise.resolve({ answer, reason: 'the index lists three ordinary routes' });
    },
  };
}

/** A launcher standing in for Playwright, so the available path runs without a browser. */
function fakeLauncher(text: string, launches: string[] = []): BrowserLauncher {
  return {
    launch() {
      launches.push('launch');
      return Promise.resolve({
        newContext() {
          return Promise.resolve({
            newPage() {
              return Promise.resolve({
                goto: () => Promise.resolve(undefined),
                innerText: () => Promise.resolve(text),
                screenshot: () => Promise.resolve(undefined),
              });
            },
          });
        },
        close: () => Promise.resolve(undefined),
      });
    },
  };
}

const browser = { baseUrl: 'http://127.0.0.1:3000' };

describe('the premise these tests rest on', () => {
  it('has no Playwright installed, so the absent path is real rather than mocked', async () => {
    expect(await loadLauncher()).toBeUndefined();
  });
});

describe('a run with Playwright absent', () => {
  it('completes, and reports the fuzzy criterion inconclusive rather than failing', async () => {
    const judge = countingJudge();
    const { results } = await runBehavioralChecks([plan(), fuzzyPlan()], {
      sessions: sessions(),
      browser,
      judge,
    });

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.verdict).sort()).toEqual(['inconclusive', 'pass']);
    expect(judge.asked).toEqual([]);
  });

  it('names the reason as capability-unavailable, not as a model being unsure', async () => {
    const { unverified } = await runBehavioralChecks([fuzzyPlan()], {
      sessions: sessions(),
      browser,
      judge: countingJudge(),
    });

    expect(unverified).toEqual([
      {
        requirementId: 'REQ-005',
        criterionId: 'AC-005-02',
        reason: 'capability-unavailable',
        detail: expect.stringContaining('Playwright is not installed') as string,
      },
    ]);
  });

  it('tells the reader how to enable it, in the detail they will actually read', async () => {
    const { results } = await runBehavioralChecks([fuzzyPlan()], {
      sessions: sessions(),
      browser,
      judge: countingJudge(),
    });

    expect(results[0]?.detail).toContain('playwright install chromium');
  });

  it('leaves the deterministic checks untouched, so a run still reports verdicts', async () => {
    const sent: RequestSpec[] = [];
    const { results } = await runBehavioralChecks([fuzzyPlan(), plan()], {
      sessions: sessions(sent),
      browser,
      judge: countingJudge(),
    });

    expect(sent).toEqual([{ method: 'GET', path: '/health' }]);
    expect(results.find((result) => result.ruleId === 'AC-015-01')?.verdict).toBe('pass');
  });

  it('produces nothing that could move the exit code, since no check failed', async () => {
    const { results } = await runBehavioralChecks([fuzzyPlan(), fuzzyPlan()], {
      sessions: sessions(),
      browser,
      judge: countingJudge(),
    });

    expect(results.some((result) => result.verdict === 'fail')).toBe(false);
    expect(results.every((result) => result.severity === 'info')).toBe(true);
  });

  it('counts a skipped fuzzy criterion as not deterministic', async () => {
    const { results } = await runBehavioralChecks([fuzzyPlan()], {
      sessions: sessions(),
      browser,
      judge: countingJudge(),
    });

    expect(results[0]?.deterministic).toBe(false);
  });
});

describe('a run with nothing configured for fuzzy criteria', () => {
  it('says the browser target is missing rather than blaming the dependency', async () => {
    const { results, unverified } = await runBehavioralChecks([fuzzyPlan()], {
      sessions: sessions(),
      judge: countingJudge(),
    });

    expect(unverified[0]?.reason).toBe('capability-unavailable');
    expect(results[0]?.detail).toContain('no browser target is configured');
    expect(results[0]?.detail).not.toContain('Playwright is not installed');
  });

  it('says the judge is missing when the browser is there and nothing answers', async () => {
    const { results, unverified } = await runBehavioralChecks([fuzzyPlan()], {
      sessions: sessions(),
      browser: { ...browser, launcher: fakeLauncher('Routes: /health') },
    });

    expect(unverified[0]?.reason).toBe('capability-unavailable');
    expect(results[0]?.detail).toContain('no judge is configured');
  });

  it('attempts no optional import at all when nothing fuzzy is planned', async () => {
    const { results, unverified } = await runBehavioralChecks([plan()], {
      sessions: sessions(),
    });

    expect(results.map((result) => result.verdict)).toEqual(['pass']);
    expect(unverified).toEqual([]);
  });
});

describe('a run with a browser available', () => {
  it('assesses the fuzzy criterion and marks it model assisted', async () => {
    const judge = countingJudge('satisfied');
    const { results, unverified } = await runBehavioralChecks([fuzzyPlan()], {
      sessions: sessions(),
      browser: { ...browser, launcher: fakeLauncher('Routes: /health, /api/invoices') },
      judge,
    });

    expect(judge.asked).toHaveLength(1);
    expect(results[0]?.verdict).toBe('pass');
    expect(results[0]?.deterministic).toBe(false);
    expect(results[0]?.detail).toContain('Model assisted');
    expect(unverified).toEqual([]);
  });

  it('separates a model that was unsure from a browser that was missing', async () => {
    const { unverified } = await runBehavioralChecks([fuzzyPlan()], {
      sessions: sessions(),
      browser: { ...browser, launcher: fakeLauncher('Routes: /admin') },
      judge: countingJudge('uncertain'),
    });

    expect(unverified[0]?.reason).toBe('model-inconclusive');
  });

  it('cannot produce a fail from any answer a model can give', async () => {
    for (const answer of ['satisfied', 'not-satisfied', 'uncertain'] as const) {
      const { results } = await runBehavioralChecks([fuzzyPlan()], {
        sessions: sessions(),
        browser: { ...browser, launcher: fakeLauncher('Routes: /admin/debug') },
        judge: countingJudge(answer),
      });

      expect(results[0]?.verdict).not.toBe('fail');
    }
  });

  it('opens the page once per fuzzy criterion and no more', async () => {
    const launches: string[] = [];
    await runBehavioralChecks([fuzzyPlan(), plan()], {
      sessions: sessions(),
      browser: { ...browser, launcher: fakeLauncher('Routes: /health', launches) },
      judge: countingJudge(),
    });

    expect(launches).toHaveLength(1);
  });
});
