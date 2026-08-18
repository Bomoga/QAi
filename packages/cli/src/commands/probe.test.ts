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
import { runProbe } from './probe.ts';

/**
 * The paths through `probe` that need no target, plus the one rule that separates it
 * from `check`: a probe produces no findings, so it can never exit 1.
 *
 * The unreachable case points at a closed loopback port, which is a refused local
 * connection rather than network access, so rule R9 holds.
 */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qai-probe-'));
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

function settings(format: Settings['format']['value'] = BUILT_IN_DEFAULTS.format): Settings {
  return {
    format: { value: format, source: 'default' },
    out: { value: undefined, source: 'default' },
    failOn: { value: BUILT_IN_DEFAULTS.failOn, source: 'default' },
    failOnUnverified: { value: false, source: 'default' },
    concurrency: { value: 1, source: 'default' },
  } as Settings;
}

async function runIt(
  options: { config?: TargetConfig; format?: Settings['format']['value'] } = {},
) {
  const out = capture();
  const err = capture();
  const code = await runProbe({
    cwd: dir,
    env: {},
    paths: [],
    config: options.config,
    configPath: 'qai.config.yaml',
    settings: settings(options.format),
    stdout: out.stream,
    stderr: err.stream,
    reporter: silentReporter,
    deps: fixedDeps('2026-08-18T12:00:00.000Z'),
  });
  return { code, out: out.text(), err: err.text() };
}

describe('qai probe', () => {
  it('exits 2 with no configuration, naming the command that writes one', async () => {
    const { code, err } = await runIt();

    expect(code).toBe(2);
    expect(err).toContain('qai init');
  });

  it('exits 2 when the target has no baseUrl', async () => {
    const { code, err } = await runIt({ config: configWith() });

    expect(code).toBe(2);
    expect(err).toContain('target.baseUrl');
  });

  it('exits 3 naming the url when the target cannot be reached', async () => {
    const { code, err, out } = await runIt({ config: configWith(CLOSED_PORT_URL) });

    expect(code).toBe(3);
    expect(err).toContain(CLOSED_PORT_URL);
    expect(out).toBe('');
  });

  it('never exits 1, since a probe produces no findings', async () => {
    // The failure threshold has nothing to act on here. 1 would tell CI the application
    // has findings, from a command that never judged anything.
    const codes = [
      (await runIt()).code,
      (await runIt({ config: configWith() })).code,
      (await runIt({ config: configWith(CLOSED_PORT_URL) })).code,
    ];

    expect(codes).not.toContain(1);
  });

  it('says a findings format does not apply rather than emitting an empty one', async () => {
    // SARIF and JUnit both describe findings. A probe has none, so producing an empty
    // document would report a clean application rather than an unjudged one.
    const { err } = await runIt({ config: configWith(CLOSED_PORT_URL), format: 'sarif' });

    expect(err).toContain('a probe produces none');
  });

  it('warns when no spec was found, since redaction then covers less', async () => {
    // Rule R8 reads the spec's sensitive field list before anything is written. Probing
    // without a spec is allowed; quietly redacting less than usual is not.
    const warnings: string[] = [];
    await runProbe({
      cwd: dir,
      env: {},
      paths: [],
      config: configWith(CLOSED_PORT_URL),
      configPath: 'qai.config.yaml',
      settings: settings(),
      stdout: capture().stream,
      stderr: capture().stream,
      reporter: { ...silentReporter, warn: (message) => void warnings.push(message) },
      deps: fixedDeps('2026-08-18T12:00:00.000Z'),
    });

    expect(warnings.join(' ')).toContain('sensitive');
  });

  it('does not warn about the spec when one loaded', async () => {
    // The negative half, so the warning cannot pass by always firing.
    writeFileSync(
      join(dir, 'spec', 'app.spec.yaml'),
      ["specVersion: '0.1'", "name: 'Small app'", ''].join('\n'),
      'utf8',
    );

    const warnings: string[] = [];
    await runProbe({
      cwd: dir,
      env: {},
      paths: [],
      config: configWith(CLOSED_PORT_URL),
      configPath: 'qai.config.yaml',
      settings: settings(),
      stdout: capture().stream,
      stderr: capture().stream,
      reporter: { ...silentReporter, warn: (message) => void warnings.push(message) },
      deps: fixedDeps('2026-08-18T12:00:00.000Z'),
    });

    expect(warnings.join(' ')).not.toContain('sensitive');
  });
});
