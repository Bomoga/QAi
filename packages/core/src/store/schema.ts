import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import Database from 'better-sqlite3';

/**
 * The run store's schema, and the migrations that get a database to it.
 *
 * **Forward only, and versioned in the database itself.** A `schema_version` row says
 * where a file is, and `migrate` applies whatever is missing. There is no down migration:
 * the store holds run history, and a downgrade that dropped a column would destroy the
 * thing the delta exists to compare against.
 *
 * **A database from a newer qai is refused, never opened.** An older build has no way to
 * know what a later one added, and writing to it would corrupt history that is already
 * on disk. The refusal names both versions so the fix is obvious.
 *
 * **Evidence bodies are files, not rows.** `03-CONTRACTS.md` puts them under
 * `.qai/evidence/` and the module says so outright: blobs make the database unwieldy and
 * the directory ungreppable. The `evidence` table holds the record and a path.
 *
 * **The whole RunResult is one JSON column.** `diffRuns` takes two RunResults and
 * `getRun` returns one, so nothing needs the fields split into columns. The module's Do
 * Not is explicit that this is not an analytics store, and the few columns beside the
 * JSON are exactly what `listRuns` sorts and filters on.
 */

/** Where the store lives inside the state directory named in 00-INDEX.md. */
export const STATE_DIRECTORY = '.qai';
export const DATABASE_FILE = 'runs.db';
export const EVIDENCE_DIRECTORY = 'evidence';

export interface Migration {
  readonly version: number;
  /** What it does, for the error message when it fails. */
  readonly description: string;
  readonly sql: string;
}

/**
 * Every migration, in order. Append only.
 *
 * Editing one that has already shipped changes what an existing database claims to be
 * without changing what it is, which is worse than a schema nobody likes.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: 'runs and evidence',
    sql: `
      CREATE TABLE runs (
        run_id        TEXT PRIMARY KEY,
        started_at    TEXT NOT NULL,
        finished_at   TEXT NOT NULL,
        tool_version  TEXT NOT NULL,
        spec_hash     TEXT NOT NULL,
        spec_version  TEXT NOT NULL,
        target        TEXT,
        result_json   TEXT NOT NULL
      ) STRICT;

      -- listRuns orders by when a run started and filters by target. Nothing else is
      -- queried, so nothing else is indexed.
      CREATE INDEX runs_started_at ON runs (started_at DESC);
      CREATE INDEX runs_target ON runs (target);

      CREATE TABLE evidence (
        evidence_id   TEXT NOT NULL,
        run_id        TEXT NOT NULL REFERENCES runs (run_id) ON DELETE CASCADE,
        kind          TEXT NOT NULL,
        captured_at   TEXT NOT NULL,
        actor_id      TEXT,
        -- Relative to the state directory. The body itself is a file, never a row.
        body_path     TEXT,
        record_json   TEXT NOT NULL,
        PRIMARY KEY (run_id, evidence_id)
      ) STRICT;

      CREATE INDEX evidence_run ON evidence (run_id);
    `,
  },
];

/** The version a database has to be at for this build to use it. */
export const CURRENT_SCHEMA_VERSION = MIGRATIONS.reduce(
  (highest, migration) => Math.max(highest, migration.version),
  0,
);

export type StoreDatabase = Database.Database;

function readVersion(db: StoreDatabase): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL) STRICT');

  const row = db.prepare('SELECT version FROM schema_version').get() as
    { version: number } | undefined;

  return row?.version ?? 0;
}

function writeVersion(db: StoreDatabase, version: number): void {
  db.prepare('DELETE FROM schema_version').run();
  db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version);
}

/**
 * Brings a database up to `CURRENT_SCHEMA_VERSION`, and returns what it did.
 *
 * Each migration runs inside its own transaction with the version bump, so a failure
 * halfway leaves the database at the last version it fully reached rather than at a
 * version it only partly is.
 */
export function migrate(db: StoreDatabase): { from: number; to: number; applied: number[] } {
  const from = readVersion(db);

  if (from > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `the run store at schema version ${from} was written by a newer qai, and this build understands version ${CURRENT_SCHEMA_VERSION}. Upgrade qai, or point --config at a different state directory.`,
    );
  }

  const applied: number[] = [];

  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue;

    const step = db.transaction(() => {
      db.exec(migration.sql);
      writeVersion(db, migration.version);
    });

    try {
      step();
    } catch (cause) {
      throw new Error(
        `the run store could not be migrated to version ${migration.version} (${migration.description})`,
        { cause },
      );
    }

    applied.push(migration.version);
  }

  return { from, to: CURRENT_SCHEMA_VERSION, applied };
}

export interface OpenDatabaseResult {
  readonly db: StoreDatabase;
  /** Absolute path to the state directory, for whoever writes evidence beside it. */
  readonly stateDir: string;
  readonly evidenceDir: string;
  readonly migrated: { from: number; to: number; applied: number[] };
}

/**
 * Opens `.qai/runs.db` under `dir`, creating and migrating as needed.
 *
 * Throws rather than returning a failure. Rule R4 makes errors values at the check level,
 * and this is not a check: a store that will not open has no partial answer to offer, and
 * the CLI already turns an unexpected throw into exit 3.
 */
export function openDatabase(dir: string): OpenDatabaseResult {
  const stateDir = resolve(dir, STATE_DIRECTORY);
  const evidenceDir = join(stateDir, EVIDENCE_DIRECTORY);

  mkdirSync(evidenceDir, { recursive: true });

  const db = new Database(join(stateDir, DATABASE_FILE));

  // Referential integrity is off by default in SQLite, so the cascade on evidence would
  // be decoration without this.
  db.pragma('foreign_keys = ON');

  let migrated;
  try {
    migrated = migrate(db);
  } catch (cause) {
    // The handle is closed before the error escapes. A caller that cannot open the store
    // has no use for it, and on Windows an open handle keeps a lock on the file, so
    // leaving it open turns a clear refusal into a file nothing else can touch either.
    db.close();
    throw cause;
  }

  return { db, stateDir, evidenceDir, migrated };
}
