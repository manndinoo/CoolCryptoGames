// SQLite storage. One file holds every record; photos live on disk beside it.
// Migrations are append-only: never edit a shipped step, add a new one.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = [
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE COLLATE NOCASE,
     name TEXT NOT NULL,
     role TEXT NOT NULL CHECK (role IN ('admin','reviewer','inspector')),
     pass_hash TEXT NOT NULL,
     active INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id),
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL
   );
   CREATE TABLE lines (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     kind TEXT NOT NULL DEFAULT 'distribution',
     voltage TEXT NOT NULL DEFAULT '',
     color TEXT NOT NULL DEFAULT '#2f6fde',
     tag_prefix TEXT NOT NULL DEFAULT '',
     notes TEXT NOT NULL DEFAULT '',
     created_by TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE poles (
     id TEXT PRIMARY KEY,
     tag TEXT NOT NULL,
     line_id TEXT REFERENCES lines(id),
     lat REAL NOT NULL,
     lng REAL NOT NULL,
     accuracy_m REAL,
     gps_samples INTEGER NOT NULL DEFAULT 0,
     location_source TEXT NOT NULL DEFAULT 'gps',
     structure TEXT NOT NULL DEFAULT 'tangent',
     material TEXT NOT NULL DEFAULT 'wood',
     equipment TEXT NOT NULL DEFAULT '{}',
     notes TEXT NOT NULL DEFAULT '',
     grade TEXT NOT NULL DEFAULT 'unreviewed',
     grade_source TEXT NOT NULL DEFAULT '',
     graded_at TEXT,
     open_critical INTEGER NOT NULL DEFAULT 0,
     created_by TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     deleted INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX poles_line ON poles(line_id);
   CREATE INDEX poles_updated ON poles(updated_at);
   CREATE TABLE spans (
     id TEXT PRIMARY KEY,
     from_pole TEXT NOT NULL REFERENCES poles(id),
     to_pole TEXT NOT NULL REFERENCES poles(id),
     line_id TEXT REFERENCES lines(id),
     conductor TEXT NOT NULL DEFAULT 'primary',
     length_m REAL,
     created_by TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     deleted INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX spans_updated ON spans(updated_at);
   CREATE TABLE inspections (
     id TEXT PRIMARY KEY,
     pole_id TEXT NOT NULL REFERENCES poles(id),
     inspector_id TEXT,
     notes TEXT NOT NULL DEFAULT '',
     checklist TEXT NOT NULL DEFAULT '{}',
     status TEXT NOT NULL DEFAULT 'draft',
     ai_status TEXT NOT NULL DEFAULT 'none',
     ai_error TEXT NOT NULL DEFAULT '',
     ai_grade TEXT,
     ai_confidence REAL,
     ai_report TEXT,
     ai_model TEXT,
     ai_prompt_version TEXT,
     autonomy TEXT,
     final_grade TEXT,
     final_source TEXT,
     reviewer_id TEXT,
     review TEXT,
     reviewed_at TEXT,
     submitted_at TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX inspections_pole ON inspections(pole_id);
   CREATE INDEX inspections_status ON inspections(status);
   CREATE INDEX inspections_updated ON inspections(updated_at);
   CREATE TABLE photos (
     id TEXT PRIMARY KEY,
     inspection_id TEXT REFERENCES inspections(id),
     pole_id TEXT REFERENCES poles(id),
     file TEXT NOT NULL,
     mime TEXT NOT NULL,
     bytes INTEGER NOT NULL,
     view TEXT NOT NULL DEFAULT '',
     lat REAL, lng REAL, accuracy_m REAL, heading REAL,
     taken_at TEXT,
     uploaded_by TEXT,
     created_at TEXT NOT NULL
   );
   CREATE INDEX photos_inspection ON photos(inspection_id);
   CREATE TABLE work_orders (
     id TEXT PRIMARY KEY,
     pole_id TEXT NOT NULL REFERENCES poles(id),
     inspection_id TEXT REFERENCES inspections(id),
     title TEXT NOT NULL,
     priority TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'open',
     assignee TEXT NOT NULL DEFAULT '',
     due TEXT NOT NULL DEFAULT '',
     notes TEXT NOT NULL DEFAULT '',
     created_by TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX work_orders_updated ON work_orders(updated_at);
   CREATE TABLE lessons (
     id TEXT PRIMARY KEY,
     text TEXT NOT NULL,
     source_inspection TEXT,
     active INTEGER NOT NULL DEFAULT 1,
     created_by TEXT,
     created_at TEXT NOT NULL
   );
   CREATE TABLE audit (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at TEXT NOT NULL,
     user_id TEXT,
     entity TEXT NOT NULL,
     entity_id TEXT NOT NULL,
     action TEXT NOT NULL,
     detail TEXT NOT NULL DEFAULT '{}'
   );
   CREATE INDEX audit_entity ON audit(entity, entity_id);
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
];

export function openDb(dataDir) {
  fs.mkdirSync(path.join(dataDir, 'photos'), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'linewatch.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get();
  let version = row ? row.version : 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  for (; version < MIGRATIONS.length; version++) {
    tx(db, () => {
      db.exec(MIGRATIONS[version]);
      db.prepare('UPDATE schema_version SET version = ?').run(version + 1);
    });
  }
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const now = () => new Date().toISOString();

export function audit(db, userId, entity, entityId, action, detail = {}) {
  db.prepare('INSERT INTO audit (at, user_id, entity, entity_id, action, detail) VALUES (?,?,?,?,?,?)')
    .run(now(), userId ?? null, entity, entityId, action, JSON.stringify(detail));
}

export function getSetting(db, key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}
