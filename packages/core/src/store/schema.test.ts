import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CURRENT_SCHEMA_VERSION,
  DATABASE_FILE,
  EVIDENCE_DIRECTORY,
  MIGRATIONS,
  STATE_DIRECTORY,
  migrate,
  openDatabase,
  type StoreDatabase,
} from './schema.ts';

/**
 * The schema is tested against a real SQLite file in a temp directory rather than an in
 * memory database, because half of what `openDatabase` does is create directories and
 * decide what an existing file means. An in memory database has no existing file.
 */
let dir: string;
const opened: StoreDatabase[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qai-store-'));
});

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  rmSync(dir, { recursive: true, force: true });
});

function open(at = dir) {
  const result = openDatabase(at);
  opened.push(result.db);
  return result;
}

function tableNames(db: StoreDatabase): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((row) => row.name);
}

describe('the migration list itself', () => {
  it('is numbered from one, contiguously, with no repeats', () => {
    // A gap or a repeat means a database can be at a version no migration produces, and
    // the store would then either skip a step or apply one twice.
    expect(MIGRATIONS.map((migration) => migration.version)).toStrictEqual(
      MIGRATIONS.map((_, index) => index + 1),
    );
  });

  it('reports the highest version as the current one', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(MIGRATIONS.length);
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThan(0);
  });

  it('describes every migration, for the message when one fails', () => {
    for (const migration of MIGRATIONS) {
      expect(migration.description.length).toBeGreaterThan(0);
      expect(migration.sql.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('opening a store', () => {
  it('creates the state directory, the evidence directory, and the database', () => {
    const { stateDir, evidenceDir } = open();

    expect(existsSync(stateDir)).toBe(true);
    expect(existsSync(evidenceDir)).toBe(true);
    expect(existsSync(join(dir, STATE_DIRECTORY, DATABASE_FILE))).toBe(true);
    expect(evidenceDir.endsWith(EVIDENCE_DIRECTORY)).toBe(true);
  });

  it('creates a missing parent directory rather than failing', () => {
    const nested = join(dir, 'a', 'b', 'c');

    expect(() => open(nested)).not.toThrow();
    expect(existsSync(join(nested, STATE_DIRECTORY, DATABASE_FILE))).toBe(true);
  });

  it('applies every migration to a fresh database', () => {
    const { migrated } = open();

    expect(migrated.from).toBe(0);
    expect(migrated.to).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.applied).toStrictEqual(MIGRATIONS.map((migration) => migration.version));
  });

  it('creates the tables the store needs and nothing else', () => {
    const { db } = open();

    expect(tableNames(db)).toStrictEqual(['evidence', 'runs', 'schema_version']);
  });

  it('applies nothing the second time, and does not fail', () => {
    // Every command that touches the store opens it. Opening has to be cheap and safe to
    // repeat, not a migration each time.
    open().db.close();
    const again = open();

    expect(again.migrated.from).toBe(CURRENT_SCHEMA_VERSION);
    expect(again.migrated.applied).toStrictEqual([]);
  });

  it('enforces foreign keys, so the cascade on evidence is real', () => {
    const { db } = open();

    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(() =>
      db
        .prepare(
          'INSERT INTO evidence (evidence_id, run_id, kind, captured_at, record_json) VALUES (?, ?, ?, ?, ?)',
        )
        .run('EV-1', 'RUN-nothing', 'http', '2026-01-01T00:00:00Z', '{}'),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('cascades evidence away with the run it belonged to', () => {
    const { db } = open();

    db.prepare(
      'INSERT INTO runs (run_id, started_at, finished_at, tool_version, spec_hash, spec_version, target, result_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      'RUN-1',
      '2026-01-01T00:00:00Z',
      '2026-01-01T00:00:01Z',
      '0.1.0',
      'sha256:a',
      '0.1',
      'http://x',
      '{}',
    );
    db.prepare(
      'INSERT INTO evidence (evidence_id, run_id, kind, captured_at, record_json) VALUES (?, ?, ?, ?, ?)',
    ).run('EV-1', 'RUN-1', 'http', '2026-01-01T00:00:00Z', '{}');

    db.prepare('DELETE FROM runs WHERE run_id = ?').run('RUN-1');

    expect(db.prepare('SELECT COUNT(*) AS n FROM evidence').get()).toStrictEqual({ n: 0 });
  });

  it('refuses a database written by a newer qai rather than downgrading it', () => {
    // An older build cannot know what a later one added, and writing to it would corrupt
    // history already on disk. The message names both versions.
    open().db.close();

    const raw = new Database(join(dir, STATE_DIRECTORY, DATABASE_FILE));
    raw.prepare('DELETE FROM schema_version').run();
    raw.prepare('INSERT INTO schema_version (version) VALUES (?)').run(CURRENT_SCHEMA_VERSION + 5);
    raw.close();

    expect(() => open()).toThrow(
      new RegExp(`${CURRENT_SCHEMA_VERSION + 5}.*newer qai.*${CURRENT_SCHEMA_VERSION}`, 's'),
    );
  });

  it('leaves the version untouched when a migration fails partway', () => {
    // A failure has to leave the database at the last version it fully reached, not at
    // one it only partly is.
    const db = new Database(':memory:');
    opened.push(db);

    // A table the first migration also creates, so its DDL collides. The column is named
    // `placeholder` rather than `nothing`, which SQLite reserves for ON CONFLICT DO
    // NOTHING and refuses as an identifier.
    db.exec('CREATE TABLE runs (placeholder TEXT)');

    expect(() => migrate(db)).toThrow(/could not be migrated to version 1/);
    const row = db.prepare('SELECT version FROM schema_version').get() as
      { version: number } | undefined;
    expect(row?.version ?? 0).toBe(0);
  });

  it('stores no evidence body, only a path to one', () => {
    // The module's Do Not: blobs make the database unwieldy and the directory
    // ungreppable. The column names say what is in them.
    const { db } = open();
    const columns = (
      db.prepare('SELECT name FROM pragma_table_info(?)').all('evidence') as { name: string }[]
    ).map((row) => row.name);

    expect(columns).toContain('body_path');
    expect(columns).not.toContain('body');
    expect(columns).not.toContain('body_blob');
  });
});
