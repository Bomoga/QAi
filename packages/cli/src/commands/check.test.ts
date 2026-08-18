import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  fixedDeps,
  isConfigFailure,
  loadConfig,
  silentReporter,
  type TargetConfig,
} from '@qai/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Stream } from '../reporter.ts';
import { BUILT_IN_DEFAULTS, type Settings } from '../settings.ts';
import { runCheck } from './check.ts';

/**
 * The paths through `check` that need no target.
 *
 * A run against a live application is an integration test and lives at M8.9, against
 * `fixtures/ledger`. What is worth pinning here is every way a run refuses to start, and
 * the exit code each one produces, because those are the codes CI reads and 1 is
 * reserved: 03-CONTRACTS.md gives it to a run that completed and found something, so
 * nothing that failed to start may return it.
 *
 * The unreachable case points at a closed local port. That is a refused connection on
 * loopback, not network access, so rule R9 holds.
 */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qai-check-'));
  mkdirSync(join(dir, 'spec'), { recursive: true });
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

const SPEC = `specVersion: '0.1'
name: 'Small app'
actors:
  - id: owner
    description: 'The owner'
entities:
  - name: Document
    fields:
      - name: id
        type: string
requirements:
  - id: REQ-001
    statement: 'An owner can read their own document'
    entities: [Document]
    accessRules:
      - id: AR-001-01
        actor: owner
        action: read
        resource: Document
        effect: allow
`;

/** A port nothing is listening on, so the connection is refused rather than answered. */
const CLOSED_PORT_URL = 'http://127.0.0.1:9';

function configWith(baseUrl?: string): TargetConfig {
  const body = [
    'target:',
    ...(baseUrl === undefined ? [] : [`  baseUrl: ${baseUrl}`]),
    '  disposable: false',
    'actors:',
    '  - id: owner',
    '    auth:',
    '      kind: none',
    '',
  ].join('\n');

  writeFileSync(join(dir, 'qai.config.yaml'), body, 'utf8');
  const loaded = loadConfig('qai.config.yaml', dir);
  if (isConfigFailure(loaded)) throw new Error(loaded.error.message);
  return loaded.config;
}

function settings(overrides: Partial<Record<keyof Settings, unknown>> = {}): Settings {
  return {
    format: { value: BUILT_IN_DEFAULTS.format, source: 'default' },
    out: { value: undefined, source: 'default' },
    failOn: { value: BUILT_IN_DEFAULTS.failOn, source: 'default' },
    failOnUnverified: { value: false, source: 'default' },
    concurrency: { value: 1, source: 'default' },
    ...overrides,
  } as Settings;
}

async function check(options: { config?: TargetConfig; paths?: readonly string[] } = {}) {
  const out = capture();
  const err = capture();
  const code = await runCheck({
    cwd: dir,
    env: {},
    paths: options.paths ?? [],
    config: options.config,
    configPath: 'qai.config.yaml',
    settings: settings(),
    stdout: out.stream,
    stderr: err.stream,
    reporter: silentReporter,
    // Pinned so a failure here is never about the clock.
    deps: fixedDeps('2026-08-18T12:00:00.000Z'),
  });
  return { code, out: out.text(), err: err.text() };
}

describe('qai check, before a run can start', () => {
  it('exits 2 with no configuration, naming the command that writes one', async () => {
    writeFileSync(join(dir, 'spec', 'app.spec.yaml'), SPEC, 'utf8');

    const { code, err, out } = await check();

    expect(code).toBe(2);
    expect(err).toContain('qai init');
    expect(out).toBe('');
  });

  it('exits 2 when no spec matches, and points at validate for the detail', async () => {
    const { code, err } = await check({ config: configWith(CLOSED_PORT_URL) });

    expect(code).toBe(2);
    expect(err).toContain('no spec files matched');
    expect(err).toContain('qai validate');
  });

  it('exits 2 when a spec will not load', async () => {
    writeFileSync(join(dir, 'spec', 'app.spec.yaml'), 'requirements: not-a-list\n', 'utf8');

    expect((await check({ config: configWith(CLOSED_PORT_URL) })).code).toBe(2);
  });

  it('exits 2 when the target has no baseUrl, since a check has nowhere to send requests', async () => {
    writeFileSync(join(dir, 'spec', 'app.spec.yaml'), SPEC, 'utf8');

    const { code, err } = await check({ config: configWith() });

    expect(code).toBe(2);
    expect(err).toContain('target.baseUrl');
  });

  it('exits 3 naming the url and the reason when the target cannot be reached', async () => {
    // Not 1. A run that never happened has not found anything, and reporting it as
    // findings is the failure that would make CI unreadable.
    writeFileSync(join(dir, 'spec', 'app.spec.yaml'), SPEC, 'utf8');

    const { code, err, out } = await check({ config: configWith(CLOSED_PORT_URL) });

    expect(code).toBe(3);
    expect(err).toContain(CLOSED_PORT_URL);
    expect(err).not.toBe('');
    expect(out).toBe('');
  });

  it('never returns 1 from a run that did not start', async () => {
    // 1 belongs to a completed run with findings. Sweeping the refusal paths is what
    // stops one of them drifting onto it later.
    writeFileSync(join(dir, 'spec', 'app.spec.yaml'), SPEC, 'utf8');

    const codes = [
      (await check()).code,
      (await check({ config: configWith() })).code,
      (await check({ config: configWith(CLOSED_PORT_URL) })).code,
    ];

    expect(codes).toStrictEqual([2, 2, 3]);
  });

  it('writes nothing to stdout when the run refuses to start', async () => {
    // Stdout carries the report. A refusal has no report, so a pipeline reading stdout
    // gets an empty document rather than a half of one.
    writeFileSync(join(dir, 'spec', 'app.spec.yaml'), SPEC, 'utf8');

    expect((await check({ config: configWith(CLOSED_PORT_URL) })).out).toBe('');
  });
});
