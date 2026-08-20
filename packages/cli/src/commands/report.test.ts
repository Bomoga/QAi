import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openStore, type RunResult } from '@qai/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Stream } from '../reporter.ts';
import { BUILT_IN_DEFAULTS, type Settings } from '../settings.ts';
import { runReport } from './report.ts';

/**
 * `qai report` over a real store file, because the command is a read of one.
 *
 * What is worth pinning is every way it refuses, and the code each refusal produces. The
 * table gives this command 0 and 2 and nothing else: 1 belongs to a run that completed
 * and found something, and this command completes no run.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qai-report-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function capture(): { stream: Stream; text: () => string } {
  const chunks: string[] = [];
  return {
    stream: { write: (chunk: string) => void chunks.push(chunk) },
    text: () => chunks.join(''),
  };
}

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    format: { value: BUILT_IN_DEFAULTS.format, source: 'default' },
    out: { value: undefined, source: 'default' },
    failOn: { value: BUILT_IN_DEFAULTS.failOn, source: 'default' },
    failOnUnverified: { value: BUILT_IN_DEFAULTS.failOnUnverified, source: 'default' },
    concurrency: { value: BUILT_IN_DEFAULTS.concurrency, source: 'default' },
    ...overrides,
  };
}

function run(runId = 'RUN-20260820-000001'): RunResult {
  return {
    resultVersion: '0.1',
    runId,
    toolVersion: '0.1.0',
    startedAt: '2026-08-20T00:00:00Z',
    finishedAt: '2026-08-20T00:00:10Z',
    spec: { hash: 'sha256:abc', specVersion: '0.1', files: ['spec/app.spec.yaml'] },
    target: { baseUrl: 'http://127.0.0.1:3000' },
    requirements: [
      {
        requirementId: 'REQ-001',
        verdict: 'failed',
        reason: '1 of 1 checks failed',
        checkIds: ['CHK-a'],
      },
    ],
    checks: [
      {
        checkId: 'CHK-a',
        type: 'access',
        requirementId: 'REQ-001',
        ruleId: 'AR-001-01',
        verdict: 'fail',
        deterministic: true,
        severity: 'high',
        title: 'Invoice readable by a user outside the owning organization',
        detail: 'GET /api/invoices/42 as actor outsider returned 200',
        evidence: ['EV-000001'],
      },
    ],
    structural: { specifiedNotObserved: [], observedNotSpecified: [], fieldMismatches: [] },
    summary: {
      requirements: { total: 1, verified: 0, failed: 1, unverified: 0 },
      checks: { total: 1, pass: 0, fail: 1, inconclusive: 0 },
      coverage: 1,
      findingsBySeverity: { high: 1, medium: 0, low: 0, info: 0 },
      modelAssistedCheckCount: 0,
    },
    unverifiedReasons: [],
  } as RunResult;
}

function store(...results: RunResult[]): void {
  const opened = openStore(dir);
  try {
    for (const result of results) opened.saveRun(result, []);
  } finally {
    opened.close();
  }
}

function report(runId: string, overrides: Partial<Settings> = {}) {
  const stdout = capture();
  const stderr = capture();
  const code = runReport({
    cwd: dir,
    runId,
    settings: settings(overrides),
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  return { code, out: stdout.text(), err: stderr.text() };
}

describe('rendering a stored run again', () => {
  it('renders the run the id names, and exits 0', () => {
    store(run());

    const { code, out } = report('RUN-20260820-000001');

    expect(code).toBe(0);
    expect(out).toContain('RUN-20260820-000001');
    expect(out).toContain('REQ-001');
  });

  it('renders the same document in every format the emitters produce', () => {
    store(run());

    const text = report('RUN-20260820-000001');
    const json = report('RUN-20260820-000001', {
      format: { value: 'json', source: 'flag' },
    });
    const sarif = report('RUN-20260820-000001', {
      format: { value: 'sarif', source: 'flag' },
    });
    const junit = report('RUN-20260820-000001', {
      format: { value: 'junit', source: 'flag' },
    });

    expect(text.code).toBe(0);
    expect((JSON.parse(json.out) as RunResult).runId).toBe('RUN-20260820-000001');
    expect((JSON.parse(sarif.out) as { version: string }).version).toBe('2.1.0');
    expect(junit.out).toContain('<testsuites');
  });

  it('re-renders rather than recomputing, so two renderings agree', () => {
    // A report that re-ran the checks would be a different run wearing an old run's id.
    store(run());

    const first = report('RUN-20260820-000001', { format: { value: 'json', source: 'flag' } });
    const second = report('RUN-20260820-000001', { format: { value: 'json', source: 'flag' } });

    expect(first.out).toBe(second.out);
    expect(JSON.parse(first.out)).toStrictEqual(JSON.parse(JSON.stringify(run())));
  });

  it('writes to a file when --out says so, and says where', () => {
    store(run());

    const { code, out, err } = report('RUN-20260820-000001', {
      format: { value: 'json', source: 'flag' },
      out: { value: 'report.json', source: 'flag' },
    });

    expect(code).toBe(0);
    expect(out).toBe('');
    expect(err).toContain('report.json');
    expect((JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) as RunResult).runId).toBe(
      'RUN-20260820-000001',
    );
  });
});

describe('refusing, and how', () => {
  it('exits 2 and names what is stored when the run id is unknown', () => {
    // A mistyped id is the common case, and the fix is knowing what is actually there.
    store(run('RUN-20260820-000001'), run('RUN-20260820-000002'));

    const { code, err } = report('RUN-nope');

    expect(code).toBe(2);
    expect(err).toContain('no run with id RUN-nope is stored');
    expect(err).toContain('RUN-20260820-000001');
    expect(err).toContain('RUN-20260820-000002');
  });

  it('says the store is empty rather than listing nothing', () => {
    const { code, err } = report('RUN-20260820-000001');

    expect(code).toBe(2);
    expect(err).toContain('the store holds no runs at all');
    expect(err).toContain('Run "qai check" to record one.');
  });

  it('never exits 1, whatever the stored run found', () => {
    // The stored run has a high severity finding. A command that returned 1 for it would
    // tell CI an application has findings from a command that judged nothing.
    store(run());

    expect(report('RUN-20260820-000001').code).toBe(0);
    expect(report('RUN-20260820-000001', { failOn: { value: 'high', source: 'flag' } }).code).toBe(
      0,
    );
    expect(
      report('RUN-20260820-000001', { failOnUnverified: { value: true, source: 'flag' } }).code,
    ).toBe(0);
  });

  it('says a threshold flag does not apply, rather than ignoring it', () => {
    // A silently ignored flag is a user believing they configured something they did not.
    store(run());

    const typed = report('RUN-20260820-000001', { failOn: { value: 'low', source: 'flag' } });
    expect(typed.err).toContain('--fail-on');
    expect(typed.err).toContain('exits 0 either way');

    // And says nothing when nobody typed one, since a note on every run is a note nobody
    // reads.
    expect(report('RUN-20260820-000001').err).not.toContain('--fail-on');
  });

  it('exits 2 when the store cannot be opened at all', () => {
    // A store that will not open has to reach the user as an error rather than as an
    // empty report, which would read as a project with no history.
    mkdirSync(join(dir, '.qai'), { recursive: true });
    writeFileSync(join(dir, '.qai', 'runs.db'), 'this is not a database', 'utf8');

    const { code, err } = report('RUN-20260820-000001');

    expect(code).toBe(2);
    expect(err).toContain('could not open the run store');
    expect(err).toContain('.qai/runs.db');
  });
});
