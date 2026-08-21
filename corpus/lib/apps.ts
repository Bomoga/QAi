import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What a corpus application is, and how the runner finds one.
 *
 * **A corpus application is an ordinary qai project.** It holds a `qai.config.yaml` and a
 * `spec/` directory exactly where the CLI looks for them by default, so running the tool
 * against one is `qai check` in that directory and nothing else. A corpus that needed its
 * own invocation would be measuring a harness rather than the product.
 *
 * **An incomplete application is reported, never skipped.** A corpus run that quietly
 * dropped the three applications it could not read would overstate its coverage, and the
 * number this stage exists to produce is a fraction whose denominator has to be honest.
 * That is the same rule invariant I4 applies to a requirement nobody could check.
 */

/** The port every corpus application is started on, one at a time. */
export const CORPUS_PORT = 47810;

export const CORPUS_BASE_URL = `http://127.0.0.1:${CORPUS_PORT}`;

/** Where the runner expects each part of an application to be. */
export const APP_LAYOUT = {
  /** Started with `PORT` in the environment, and expected to listen on it. */
  entry: join('app', 'index.ts'),
  config: 'qai.config.yaml',
  specDir: 'spec',
  /**
   * Optional. Fixture credentials the application's config names by variable.
   *
   * Fixture data, never a real secret, for the same reason the ledger's tokens are
   * written into a workflow file: a corpus that needed real credentials would be a corpus
   * nobody else could run.
   */
  env: 'env.json',
  /** Optional. Where the application came from, which prompt produced it, what it is. */
  notes: 'NOTES.md',
} as const;

export interface CorpusApp {
  readonly slug: string;
  readonly dir: string;
  readonly entry: string;
  readonly config: string;
  readonly specDir: string;
  /** Fixture credentials for the run, empty when the application needs none. */
  readonly env: Readonly<Record<string, string>>;
  readonly notes?: string;
}

export interface CorpusAppProblem {
  readonly slug: string;
  readonly dir: string;
  /** Everything the layout requires and this directory does not have. */
  readonly missing: readonly string[];
}

export interface CorpusInventory {
  readonly apps: readonly CorpusApp[];
  readonly problems: readonly CorpusAppProblem[];
}

function readEnv(path: string, slug: string): Record<string, string> {
  if (!existsSync(path)) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new Error(`${slug} has an ${APP_LAYOUT.env} that is not valid JSON`, { cause });
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${slug} has an ${APP_LAYOUT.env} that is not an object of strings`);
  }

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new Error(`${slug} sets ${key} in ${APP_LAYOUT.env} to something other than a string`);
    }
    out[key] = value;
  }
  return out;
}

/** True when the directory holds at least one file the spec loader would match. */
function hasSpec(specDir: string): boolean {
  if (!existsSync(specDir)) return false;
  return readdirSync(specDir).some((name) => name.endsWith('.spec.yaml'));
}

/**
 * Every application under `root`, and every directory that tried to be one and failed.
 *
 * Sorted by slug, so two runs of the corpus list their applications in the same order and
 * a results table can be diffed against the one before it.
 */
export function discoverCorpusApps(root: string): CorpusInventory {
  if (!existsSync(root)) return { apps: [], problems: [] };

  const apps: CorpusApp[] = [];
  const problems: CorpusAppProblem[] = [];

  const slugs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  for (const slug of slugs) {
    const dir = join(root, slug);
    const entry = join(dir, APP_LAYOUT.entry);
    const config = join(dir, APP_LAYOUT.config);
    const specDir = join(dir, APP_LAYOUT.specDir);

    const missing: string[] = [];
    if (!existsSync(entry)) missing.push(APP_LAYOUT.entry);
    if (!existsSync(config)) missing.push(APP_LAYOUT.config);
    if (!hasSpec(specDir)) missing.push(`${APP_LAYOUT.specDir}/*.spec.yaml`);

    if (missing.length > 0) {
      problems.push({ slug, dir, missing });
      continue;
    }

    const notes = join(dir, APP_LAYOUT.notes);

    apps.push({
      slug,
      dir,
      entry,
      config,
      specDir,
      env: readEnv(join(dir, APP_LAYOUT.env), slug),
      ...(existsSync(notes) ? { notes } : {}),
    });
  }

  return { apps, problems };
}
