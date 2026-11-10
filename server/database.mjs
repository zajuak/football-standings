import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const RECORD_COLUMNS = ['revision', 'submission_id', 'base_revision', 'action', 'state', 'applied', 'created_at', 'content_hash'];

export function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const sql = new DatabaseSync(filename);
  sql.exec(`PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS submissions (
      revision INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      submission_id TEXT NOT NULL UNIQUE, base_revision INTEGER NOT NULL,
      action TEXT NOT NULL, state TEXT NOT NULL,
      applied INTEGER NOT NULL CHECK(applied IN (0, 1)), created_at TEXT NOT NULL,
      content_hash TEXT
    );
    CREATE INDEX IF NOT EXISTS submissions_applied_revision ON submissions(applied, revision);`);
  const db = {
    sql,
    prepare(query) {
      const statement = sql.prepare(query);
      const bound = args => ({
        bind: (...values) => bound(values),
        async run() { return statement.run(...args); },
        async first() { return statement.get(...args) ?? null; },
        async all() { return { results: statement.all(...args) }; },
      });
      return bound([]);
    },
    close() { sql.close(); },
  };
  return db;
}

export function databaseSummary(db) {
  const counts = db.sql.prepare('SELECT COUNT(*) AS records, COALESCE(MAX(revision),0) AS lastRecordRevision FROM submissions').get();
  const latest = db.sql.prepare('SELECT COALESCE(MAX(revision),0) AS revision FROM submissions WHERE applied=1').get();
  return { ...counts, revision: latest.revision };
}

// Import immutable original rows, including conflicts and original revision IDs.
// Refuse mismatched IDs/content and roll the entire batch back on any conflict.
export function mergeRecords(db, records) {
  const existing = db.sql.prepare(`SELECT ${RECORD_COLUMNS.join(',')} FROM submissions WHERE revision=? OR submission_id=?`);
  const insert = db.sql.prepare(`INSERT INTO submissions(${RECORD_COLUMNS.join(',')}) VALUES (${RECORD_COLUMNS.map(() => '?').join(',')})`);
  let inserted = 0;
  db.sql.exec('BEGIN IMMEDIATE');
  try {
    for (const record of records) {
      if (!Number.isSafeInteger(record.revision) || record.revision < 1 || typeof record.submission_id !== 'string' || !record.submission_id ||
          !Number.isSafeInteger(record.base_revision) || record.base_revision < 0 || typeof record.action !== 'string' ||
          typeof record.state !== 'string' || ![0,1].includes(record.applied) || typeof record.created_at !== 'string' ||
          !(record.content_hash == null || typeof record.content_hash === 'string')) throw new Error('Invalid original history record');
      JSON.parse(record.state);
      const previous = existing.all(record.revision, record.submission_id);
      if (previous.length) {
        if (previous.length !== 1 || !RECORD_COLUMNS.every(key => (previous[0][key] ?? null) === (record[key] ?? null))) throw new Error(`Immutable record mismatch at revision ${record.revision}`);
        continue;
      }
      insert.run(...RECORD_COLUMNS.map(key => record[key] ?? null));
      inserted++;
    }
    db.sql.exec('COMMIT');
  } catch (error) {
    db.sql.exec('ROLLBACK');
    throw error;
  }
  return { inserted, ...databaseSummary(db) };
}

export function mergeDatabase(db, sourceFilename) {
  const source = new DatabaseSync(sourceFilename, { readOnly: true });
  try {
    if (source.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Source database failed integrity check');
    return mergeRecords(db, source.prepare(`SELECT ${RECORD_COLUMNS.join(',')} FROM submissions ORDER BY revision`).all());
  } finally { source.close(); }
}
