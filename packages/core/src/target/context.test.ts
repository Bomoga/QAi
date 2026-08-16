import { describe, expect, it } from 'vitest';

import { SpecSchema } from '../contracts/index.ts';
import type { CapturedEvidence } from '../evidence/capture.ts';
import { TargetConfigSchema, type TargetConfig } from './config.ts';
import { createTargetContext, describeCapabilities } from './context.ts';
import { fixedDeps } from './deps.ts';

const SPEC = SpecSchema.parse({
  specVersion: '0.1',
  name: 'Ledger',
  entities: [{ name: 'Invoice', fields: [{ name: 'notes', type: 'string', sensitive: true }] }],
  requirements: [],
});

function config(overrides: Record<string, unknown> = {}): TargetConfig {
  return TargetConfigSchema.parse({
    target: {
      baseUrl: 'http://localhost:3000',
      disposable: true,
      resetCommand: 'true',
      seedCommand: 'true',
      ...((overrides['target'] as Record<string, unknown>) ?? {}),
    },
    actors: overrides['actors'] ?? [
      { id: 'owner', auth: { kind: 'bearer', tokenEnv: 'OWNER_TOKEN' } },
      { id: 'outsider', auth: { kind: 'bearer', tokenEnv: 'OUTSIDER_TOKEN' } },
    ],
    ...(overrides['redaction'] === undefined ? {} : { redaction: overrides['redaction'] }),
  });
}

const BOTH_TOKENS = { OWNER_TOKEN: 'a', OUTSIDER_TOKEN: 'b' };

function build(cfg: TargetConfig, env: Record<string, string | undefined>) {
  return createTargetContext(cfg, SPEC, { env, deps: fixedDeps() });
}

describe('a fully configured target', () => {
  it('resolves both actors', () => {
    const { capabilities } = build(config(), BOTH_TOKENS);
    expect(capabilities.actorIds).toEqual(['owner', 'outsider']);
  });

  it('reports access checks as available', () => {
    const { capabilities } = build(config(), BOTH_TOKENS);
    expect(capabilities.accessChecksPossible).toBe(true);
  });

  it('reports fixtures as available', () => {
    const { capabilities } = build(config(), BOTH_TOKENS);
    expect(capabilities.fixturesAvailable).toBe(true);
  });

  it('warns about nothing', () => {
    const { capabilities } = build(config(), BOTH_TOKENS);
    expect(capabilities.warnings).toEqual([]);
  });

  it('builds a session per actor', () => {
    const { sessions } = build(config(), BOTH_TOKENS);
    expect([...sessions.keys()]).toEqual(['owner', 'outsider']);
  });

  it('carries redaction rules taken from the spec', () => {
    const { rules } = build(config(), BOTH_TOKENS);
    expect(rules.sensitiveFields.has('notes')).toBe(true);
  });
});

describe('one actor is not enough', () => {
  const oneActor = build(config(), { OWNER_TOKEN: 'a' });

  it('reports access checks as unavailable', () => {
    expect(oneActor.capabilities.accessChecksPossible).toBe(false);
  });

  it('says which requirements will be unverified and why', () => {
    const warning = oneActor.capabilities.warnings.find((line) => line.includes('access checking'));

    expect(warning).toContain('actor-unavailable');
    expect(warning).toContain('unverified');
  });

  it('names the credential variable that was missing', () => {
    const warning = oneActor.capabilities.warnings.find((line) => line.includes('OUTSIDER_TOKEN'));
    expect(warning).toBeDefined();
  });

  it('does not pretend the run is complete', () => {
    expect(oneActor.capabilities.warnings.length).toBeGreaterThan(0);
  });
});

describe('gaps are stated rather than assumed away', () => {
  it('warns when no baseUrl is configured', () => {
    const cfg = TargetConfigSchema.parse({ target: { disposable: false }, actors: [] });
    const { capabilities } = build(cfg, {});

    expect(capabilities.warnings.some((line) => line.includes('baseUrl'))).toBe(true);
  });

  it('warns when the configured source root does not exist', () => {
    const cfg = config({ target: { sourceRoot: 'does/not/exist' } });
    const { capabilities } = build(cfg, BOTH_TOKENS);

    expect(capabilities.sourcePresent).toBe(false);
    expect(capabilities.warnings.some((line) => line.includes('file reference'))).toBe(true);
  });

  it('reports the source root as present when it exists', () => {
    const cfg = config({ target: { sourceRoot: '.' } });
    const { capabilities } = build(cfg, BOTH_TOKENS);
    expect(capabilities.sourcePresent).toBe(true);
  });

  it('warns when fixtures are refused, carrying the refusal message', () => {
    const cfg = TargetConfigSchema.parse({
      target: { baseUrl: 'http://localhost:3000', disposable: false },
      actors: [
        { id: 'owner', auth: { kind: 'bearer', tokenEnv: 'OWNER_TOKEN' } },
        { id: 'outsider', auth: { kind: 'bearer', tokenEnv: 'OUTSIDER_TOKEN' } },
      ],
    });
    const { capabilities } = build(cfg, BOTH_TOKENS);

    expect(capabilities.fixturesAvailable).toBe(false);
    expect(capabilities.warnings.some((line) => line.includes('target.disposable'))).toBe(true);
  });

  it('warns that an invalid redaction pattern is hiding nothing', () => {
    const cfg = config({ redaction: { extraPatterns: ['([unclosed'] } });
    const { capabilities } = build(cfg, BOTH_TOKENS);

    expect(capabilities.invalidRedactionPatterns).toEqual(['([unclosed']);
    expect(capabilities.warnings.some((line) => line.includes('is not being hidden'))).toBe(true);
  });
});

describe('sessions built by the context write evidence', () => {
  it('passes the writer through, so a recorded id corresponds to a real file', async () => {
    const written: CapturedEvidence[] = [];
    const context = createTargetContext(config(), SPEC, {
      env: BOTH_TOKENS,
      deps: fixedDeps(),
      client: {
        send: () =>
          Promise.resolve({
            kind: 'response' as const,
            response: {
              status: 200,
              headers: {},
              body: '{"id":"INV-1001","notes":"private"}',
              truncated: false,
              durationMs: 1,
            },
          }),
      },
      writer: { write: (capture) => void written.push(capture) },
    });

    const result = await context.sessions.get('owner')?.request({ method: 'GET', path: '/x' });

    expect(written).toHaveLength(1);
    expect(written[0]?.evidence.id).toBe(result?.evidenceId);
  });
});

describe('the printed report', () => {
  it('states every capability, including the ones that are fine', () => {
    const lines = describeCapabilities(build(config(), BOTH_TOKENS).capabilities);

    expect(lines.some((line) => line.startsWith('target'))).toBe(true);
    expect(lines.some((line) => line.startsWith('actors'))).toBe(true);
    expect(lines.some((line) => line.includes('access checks available'))).toBe(true);
    expect(lines.some((line) => line.includes('fixtures      available'))).toBe(true);
  });

  it('marks an unavailable capability rather than omitting it', () => {
    const lines = describeCapabilities(build(config(), { OWNER_TOKEN: 'a' }).capabilities);
    expect(lines.some((line) => line.includes('access checks unavailable'))).toBe(true);
  });

  it('lists warnings after the capabilities', () => {
    const lines = describeCapabilities(build(config(), {}).capabilities);
    expect(lines.filter((line) => line.startsWith('warning:')).length).toBeGreaterThan(0);
  });

  it('says none resolved rather than showing an empty actor list', () => {
    const lines = describeCapabilities(build(config(), {}).capabilities);
    expect(lines.some((line) => line.includes('none resolved'))).toBe(true);
  });
});
