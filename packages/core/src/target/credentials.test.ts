import { describe, expect, it } from 'vitest';

import type { ActorConfig } from './config.ts';
import { describeMissing, requiredVariable, resolveCredentials } from './credentials.ts';

const OWNER: ActorConfig = {
  id: 'owner',
  auth: { kind: 'bearer', tokenEnv: 'LEDGER_OWNER_TOKEN' },
  attributes: { org_id: 'org-1' },
};

const OUTSIDER: ActorConfig = {
  id: 'outsider',
  auth: { kind: 'bearer', tokenEnv: 'LEDGER_OUTSIDER_TOKEN' },
  attributes: { org_id: 'org-2' },
};

const ANONYMOUS: ActorConfig = {
  id: 'anonymous',
  auth: { kind: 'none' },
  attributes: {},
};

describe('resolving credentials', () => {
  it('resolves a bearer token from the named variable', () => {
    const { actors, missing } = resolveCredentials([OWNER], {
      LEDGER_OWNER_TOKEN: 'ledger-owner-token',
    });

    expect(missing).toEqual([]);
    expect(actors[0]?.credential).toEqual({ kind: 'bearer', token: 'ledger-owner-token' });
  });

  it('carries actor attributes through, since conditions compare against them', () => {
    const { actors } = resolveCredentials([OWNER], { LEDGER_OWNER_TOKEN: 't' });
    expect(actors[0]?.attributes).toEqual({ org_id: 'org-1' });
  });

  it('resolves a cookie credential', () => {
    const actor: ActorConfig = {
      id: 'owner',
      auth: { kind: 'cookie', name: 'session', valueEnv: 'LEDGER_SESSION' },
      attributes: {},
    };
    const { actors } = resolveCredentials([actor], { LEDGER_SESSION: 'abc' });
    expect(actors[0]?.credential).toEqual({ kind: 'cookie', name: 'session', value: 'abc' });
  });

  it('resolves a header credential', () => {
    const actor: ActorConfig = {
      id: 'owner',
      auth: { kind: 'header', name: 'X-Api-Key', valueEnv: 'LEDGER_KEY' },
      attributes: {},
    };
    const { actors } = resolveCredentials([actor], { LEDGER_KEY: 'k' });
    expect(actors[0]?.credential).toEqual({ kind: 'header', name: 'X-Api-Key', value: 'k' });
  });

  it('resolves an actor with no credentials without consulting the environment', () => {
    const { actors, missing } = resolveCredentials([ANONYMOUS], {});
    expect(missing).toEqual([]);
    expect(actors[0]?.credential).toEqual({ kind: 'none' });
  });

  it('reads the environment passed in, never process.env', () => {
    const { actors, missing } = resolveCredentials([OWNER], {});
    expect(actors).toEqual([]);
    expect(missing).toEqual([{ actorId: 'owner', variable: 'LEDGER_OWNER_TOKEN' }]);
  });
});

describe('missing variables', () => {
  it('names every one at once rather than the first', () => {
    const { missing } = resolveCredentials([OWNER, OUTSIDER], {});

    expect(missing).toEqual([
      { actorId: 'owner', variable: 'LEDGER_OWNER_TOKEN' },
      { actorId: 'outsider', variable: 'LEDGER_OUTSIDER_TOKEN' },
    ]);
  });

  it('keeps the actors that did resolve', () => {
    const { actors, missing } = resolveCredentials([OWNER, OUTSIDER], {
      LEDGER_OWNER_TOKEN: 't',
    });

    expect(actors.map((actor) => actor.id)).toEqual(['owner']);
    expect(missing.map((entry) => entry.actorId)).toEqual(['outsider']);
  });

  it('drops an actor rather than giving it a blank credential', () => {
    const { actors, missing } = resolveCredentials([OWNER], { LEDGER_OWNER_TOKEN: '' });

    expect(actors).toEqual([]);
    expect(missing).toHaveLength(1);
  });

  it('treats a whitespace only variable as absent', () => {
    const { missing } = resolveCredentials([OWNER], { LEDGER_OWNER_TOKEN: '   ' });
    expect(missing).toHaveLength(1);
  });

  it('describes them in one line a reader can act on', () => {
    const { missing } = resolveCredentials([OWNER, OUTSIDER], {});
    const description = describeMissing(missing);

    expect(description).toContain('LEDGER_OWNER_TOKEN');
    expect(description).toContain('LEDGER_OUTSIDER_TOKEN');
    expect(description).toContain('2 credential variable');
  });

  it('says nothing when nothing is missing', () => {
    expect(describeMissing([])).toBe('');
  });

  it('never includes a resolved value in the description', () => {
    const { missing } = resolveCredentials([OWNER, OUTSIDER], { LEDGER_OWNER_TOKEN: 'secret-tok' });
    expect(describeMissing(missing)).not.toContain('secret-tok');
  });
});

describe('requiredVariable', () => {
  it.each([
    [{ kind: 'bearer', tokenEnv: 'A' } as const, 'A'],
    [{ kind: 'cookie', name: 'c', valueEnv: 'B' } as const, 'B'],
    [{ kind: 'header', name: 'h', valueEnv: 'C' } as const, 'C'],
  ])('names the variable for %o', (auth, expected) => {
    expect(requiredVariable(auth)).toBe(expected);
  });

  it('names none for an actor that carries no credentials', () => {
    expect(requiredVariable({ kind: 'none' })).toBeUndefined();
  });
});
