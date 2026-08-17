import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isConfigFailure, loadConfig, type ConfigError, type TargetConfig } from './config.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qai-config-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(contents: string, name = 'qai.config.yaml'): void {
  writeFileSync(join(dir, name), contents, 'utf8');
}

function load(name?: string): TargetConfig {
  const result = loadConfig(name, dir);
  if (isConfigFailure(result)) {
    throw new Error(`expected a successful load, got: ${result.error.message}`);
  }
  return result.config;
}

function loadFailing(name?: string): ConfigError {
  const result = loadConfig(name, dir);
  if (!isConfigFailure(result)) {
    throw new Error('expected the load to fail, but it succeeded');
  }
  return result.error;
}

const LEDGER = `
target:
  baseUrl: http://localhost:3000
  sourceRoot: .
  disposable: true
  resetCommand: "pnpm --filter ledger db:reset"
  seedCommand: "pnpm --filter ledger db:seed"
actors:
  - id: owner
    auth:
      kind: bearer
      tokenEnv: LEDGER_OWNER_TOKEN
    attributes:
      org_id: org-1
  - id: outsider
    auth:
      kind: bearer
      tokenEnv: LEDGER_OUTSIDER_TOKEN
    attributes:
      org_id: org-2
redaction:
  extraPatterns: ["(?i)api[_-]?key"]
`;

describe('loading the proposed config shape', () => {
  it('accepts the example from modules/M2-target.md', () => {
    write(LEDGER);
    const config = load();

    expect(config.target.baseUrl).toBe('http://localhost:3000');
    expect(config.target.disposable).toBe(true);
    expect(config.actors.map((actor) => actor.id)).toEqual(['owner', 'outsider']);
  });

  it('reads the default path when none is given', () => {
    write(LEDGER);
    expect(load().actors).toHaveLength(2);
  });

  it('reads an explicit path', () => {
    write(LEDGER, 'other.yaml');
    expect(load('other.yaml').actors).toHaveLength(2);
  });

  it('carries actor attributes, which conditions compare against', () => {
    write(LEDGER);
    expect(load().actors[0]?.attributes).toEqual({ org_id: 'org-1' });
  });
});

describe('the state actor', () => {
  it('is absent unless configured, since neither available default is safe', () => {
    write(LEDGER);

    // The acting actor is frequently one that cannot read the record at all, and a
    // scoped actor counts only what it can see. Absent leaves state assertions
    // unevaluable, which is the honest answer.
    expect(load().stateActor).toBeUndefined();
  });

  it('names a configured actor', () => {
    write(`${LEDGER}stateActor: owner\n`);
    expect(load().stateActor).toBe('owner');
  });

  it('fails the load when it names nobody, rather than leaving a quiet coverage gap', () => {
    write(`${LEDGER}stateActor: admin\n`);
    const failure = loadFailing();

    expect(failure.message).toContain('state actor');
    expect(failure.diagnostics[0]?.path).toBe('stateActor');
    expect(failure.diagnostics[0]?.message).toContain('admin');
  });

  it('names the actors that are configured, so the fix is in the message', () => {
    write(`${LEDGER}stateActor: admin\n`);
    expect(loadFailing().diagnostics[0]?.message).toContain('owner, outsider');
  });

  it('says so plainly when no actor is configured at all', () => {
    write(`
target:
  baseUrl: http://localhost:3000
actors: []
stateActor: owner
`);
    expect(loadFailing().diagnostics[0]?.message).toContain('No actors are configured');
  });
});

describe('the disposability default', () => {
  it('is false when unstated, so a target is not disposable until someone says so', () => {
    write(`
target:
  baseUrl: http://localhost:3000
actors: []
`);
    expect(load().target.disposable).toBe(false);
  });
});

describe('credentials are never values', () => {
  it('rejects a literal token and names the environment variable to use', () => {
    write(`
target:
  baseUrl: http://localhost:3000
actors:
  - id: owner
    auth:
      kind: bearer
      token: ledger-owner-token
`);
    const failure = loadFailing();
    const diagnostic = failure.diagnostics[0];

    expect(diagnostic?.path).toBe('actors[0].auth.token');
    expect(diagnostic?.message).toContain('tokenEnv: OWNER_TOKEN');
    expect(diagnostic?.message).toContain('environment');
  });

  it.each(['password', 'secret', 'apiKey', 'value'])('rejects a literal %s', (key) => {
    write(`
target:
  baseUrl: http://localhost:3000
actors:
  - id: owner
    auth:
      kind: header
      name: X-Api-Key
      ${key}: a-real-secret
`);
    expect(loadFailing().diagnostics.length).toBeGreaterThan(0);
  });

  it('never echoes the secret it rejected', () => {
    write(`
target:
  baseUrl: http://localhost:3000
actors:
  - id: owner
    auth:
      kind: bearer
      token: super-secret-value
`);
    const failure = loadFailing();
    const rendered = JSON.stringify(failure);
    expect(rendered).not.toContain('super-secret-value');
  });

  it('rejects an env var name that looks like a value', () => {
    write(`
target:
  baseUrl: http://localhost:3000
actors:
  - id: owner
    auth:
      kind: bearer
      tokenEnv: ledger-owner-token
`);
    expect(loadFailing().diagnostics[0]?.message).toContain('environment variable name');
  });
});

describe('auth kinds', () => {
  function withAuth(auth: string): string {
    return `
target:
  baseUrl: http://localhost:3000
actors:
  - id: a
    auth:
${auth}
`;
  }

  it('accepts bearer', () => {
    write(withAuth('      kind: bearer\n      tokenEnv: A_TOKEN'));
    expect(load().actors[0]?.auth).toEqual({ kind: 'bearer', tokenEnv: 'A_TOKEN' });
  });

  it('accepts cookie', () => {
    write(withAuth('      kind: cookie\n      name: session\n      valueEnv: A_SESSION'));
    expect(load().actors[0]?.auth).toEqual({
      kind: 'cookie',
      name: 'session',
      valueEnv: 'A_SESSION',
    });
  });

  it('accepts header', () => {
    write(withAuth('      kind: header\n      name: X-Api-Key\n      valueEnv: A_KEY'));
    expect(load().actors[0]?.auth).toEqual({
      kind: 'header',
      name: 'X-Api-Key',
      valueEnv: 'A_KEY',
    });
  });

  it('accepts none, which is how an unauthenticated actor is expressed', () => {
    write(withAuth('      kind: none'));
    expect(load().actors[0]?.auth).toEqual({ kind: 'none' });
  });

  it('rejects an unknown kind', () => {
    write(withAuth('      kind: oauth\n      tokenEnv: A_TOKEN'));
    expect(loadFailing().diagnostics.length).toBeGreaterThan(0);
  });

  it('rejects bearer with no tokenEnv', () => {
    write(withAuth('      kind: bearer'));
    expect(loadFailing().diagnostics[0]?.path).toContain('actors[0].auth');
  });
});

describe('errors name the YAML path', () => {
  it('reports a missing file without pretending it loaded', () => {
    expect(loadFailing().message).toContain('could not read');
  });

  it('reports malformed YAML', () => {
    write('target:\n  baseUrl: http://x\n    bad: indent\n');
    expect(loadFailing().diagnostics[0]?.message).toContain('YAML');
  });

  it('reports an empty file', () => {
    write('');
    expect(loadFailing().message).toContain('empty');
  });

  it('reports a key it does not know rather than dropping it', () => {
    write(`
target:
  baseUrl: http://localhost:3000
  dispoable: true
`);
    expect(loadFailing().diagnostics.length).toBeGreaterThan(0);
  });

  it('reports a baseUrl that is not a URL', () => {
    write('target:\n  baseUrl: not a url\n');
    expect(loadFailing().diagnostics[0]?.path).toBe('target.baseUrl');
  });

  it('reports a duplicate actor id', () => {
    write(`
target:
  baseUrl: http://localhost:3000
actors:
  - id: owner
    auth:
      kind: none
  - id: owner
    auth:
      kind: none
`);
    expect(loadFailing().message).toContain('more than once');
  });
});
