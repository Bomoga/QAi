import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_LAYOUT, discoverCorpusApps } from './apps.ts';

/**
 * Discovery over real directories, because every rule here is about what is on disk.
 *
 * The rule that matters is that an incomplete application is reported rather than
 * skipped. The number this stage produces is a fraction, and a denominator that quietly
 * drops what it could not read is a better number than the corpus earned.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'qai-corpus-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

interface AppParts {
  readonly entry?: boolean;
  readonly config?: boolean;
  readonly spec?: boolean;
  readonly env?: string;
  readonly notes?: boolean;
}

function makeApp(slug: string, parts: AppParts = {}): void {
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });

  if (parts.entry !== false) {
    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(join(dir, APP_LAYOUT.entry), 'export {};\n', 'utf8');
  }
  if (parts.config !== false) {
    writeFileSync(join(dir, APP_LAYOUT.config), 'target:\n  baseUrl: http://127.0.0.1:1\n', 'utf8');
  }
  if (parts.spec !== false) {
    mkdirSync(join(dir, APP_LAYOUT.specDir), { recursive: true });
    writeFileSync(
      join(dir, APP_LAYOUT.specDir, `${slug}.spec.yaml`),
      'specVersion: "0.1"\n',
      'utf8',
    );
  }
  if (parts.env !== undefined) {
    writeFileSync(join(dir, APP_LAYOUT.env), parts.env, 'utf8');
  }
  if (parts.notes === true) {
    writeFileSync(join(dir, APP_LAYOUT.notes), '# where this came from\n', 'utf8');
  }
}

describe('finding the applications in a corpus', () => {
  it('finds a complete application and names every part of it', () => {
    makeApp('invoicing');

    const { apps, problems } = discoverCorpusApps(root);

    expect(problems).toStrictEqual([]);
    expect(apps).toHaveLength(1);
    expect(apps[0]?.slug).toBe('invoicing');
    expect(apps[0]?.entry).toBe(join(root, 'invoicing', APP_LAYOUT.entry));
    expect(apps[0]?.config).toBe(join(root, 'invoicing', APP_LAYOUT.config));
    expect(apps[0]?.env).toStrictEqual({});
    expect(apps[0]?.notes).toBeUndefined();
  });

  it('lists applications in a stable order, so two runs can be diffed', () => {
    makeApp('zebra');
    makeApp('alpha');
    makeApp('middle');

    expect(discoverCorpusApps(root).apps.map((one) => one.slug)).toStrictEqual([
      'alpha',
      'middle',
      'zebra',
    ]);
  });

  it('reports an incomplete application rather than skipping it', () => {
    // The whole point. A run that dropped this silently would report a coverage it does
    // not have, and the denominator of the false positive rate would be wrong.
    makeApp('good');
    makeApp('no-spec', { spec: false });

    const { apps, problems } = discoverCorpusApps(root);

    expect(apps.map((one) => one.slug)).toStrictEqual(['good']);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.slug).toBe('no-spec');
    expect(problems[0]?.missing).toStrictEqual(['spec/*.spec.yaml']);
  });

  it('names every missing part at once, not just the first', () => {
    // Somebody fixing a half built corpus application should learn everything that is
    // wrong with it in one run rather than one thing per run.
    makeApp('empty', { entry: false, config: false, spec: false });

    const [problem] = discoverCorpusApps(root).problems;

    expect(problem?.missing).toStrictEqual([
      APP_LAYOUT.entry,
      APP_LAYOUT.config,
      'spec/*.spec.yaml',
    ]);
  });

  it('does not count a spec directory holding no spec file', () => {
    // An empty spec directory is the shape of an application somebody started and did not
    // finish, and it is exactly what would otherwise pass discovery and fail at the run.
    const dir = join(root, 'started');
    mkdirSync(join(dir, 'app'), { recursive: true });
    mkdirSync(join(dir, APP_LAYOUT.specDir), { recursive: true });
    writeFileSync(join(dir, APP_LAYOUT.entry), 'export {};\n', 'utf8');
    writeFileSync(join(dir, APP_LAYOUT.config), 'target: {}\n', 'utf8');
    writeFileSync(join(dir, APP_LAYOUT.specDir, 'notes.txt'), 'not a spec\n', 'utf8');

    expect(discoverCorpusApps(root).problems[0]?.missing).toStrictEqual(['spec/*.spec.yaml']);
  });

  it('reads fixture credentials when the application declares them', () => {
    makeApp('tokens', { env: '{"APP_OWNER_TOKEN":"owner-token"}' });

    expect(discoverCorpusApps(root).apps[0]?.env).toStrictEqual({
      APP_OWNER_TOKEN: 'owner-token',
    });
  });

  it('refuses an env file that is not an object of strings', () => {
    // A number where a token belongs would reach the child process as something the
    // config cannot resolve, and the failure would surface as an unreachable target.
    makeApp('bad-env', { env: '{"PORT":47810}' });
    expect(() => discoverCorpusApps(root)).toThrow(/other than a string/);

    rmSync(join(root, 'bad-env'), { recursive: true, force: true });
    makeApp('broken-json', { env: '{not json' });
    expect(() => discoverCorpusApps(root)).toThrow(/not valid JSON/);
  });

  it('carries the provenance note when there is one', () => {
    // Which prompt produced an application is what makes a corpus reviewable later.
    makeApp('documented', { notes: true });
    expect(discoverCorpusApps(root).apps[0]?.notes).toBe(
      join(root, 'documented', APP_LAYOUT.notes),
    );
  });

  it('returns nothing for a corpus that does not exist yet', () => {
    expect(discoverCorpusApps(join(root, 'nowhere'))).toStrictEqual({ apps: [], problems: [] });
  });
});
