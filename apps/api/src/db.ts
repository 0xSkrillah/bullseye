import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS snapshots (
  key TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  body TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  detected_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS investigations (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL REFERENCES signals(id),
  status TEXT NOT NULL,
  stop_reason TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  budget_json TEXT NOT NULL,
  synthesis_json TEXT NOT NULL,
  draft_json TEXT,
  checks_json TEXT,
  gate_json TEXT,
  brief_id TEXT
);

CREATE TABLE IF NOT EXISTS timeline (
  investigation_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (investigation_id, seq)
);

CREATE TABLE IF NOT EXISTS evidence (
  investigation_id TEXT NOT NULL,
  id TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (investigation_id, id)
);

CREATE TABLE IF NOT EXISTS usage (
  investigation_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (investigation_id, seq)
);

CREATE TABLE IF NOT EXISTS briefs (
  id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  published_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  brief_id TEXT NOT NULL,
  terms_json TEXT NOT NULL,
  terms_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS quotes_immutable_update BEFORE UPDATE ON quotes
BEGIN SELECT RAISE(ABORT, 'quotes are immutable'); END;
CREATE TRIGGER IF NOT EXISTS quotes_immutable_delete BEFORE DELETE ON quotes
BEGIN SELECT RAISE(ABORT, 'quotes are immutable'); END;

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  terms_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  payment_key TEXT UNIQUE,
  payment_payload_json TEXT,
  payment_json TEXT,
  delivery_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS orders_terms_frozen BEFORE UPDATE OF quote_id, terms_hash ON orders
BEGIN SELECT RAISE(ABORT, 'order terms are frozen'); END;

CREATE TABLE IF NOT EXISTS server_secrets (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_events (
  order_id TEXT NOT NULL REFERENCES orders(id),
  seq INTEGER NOT NULL,
  at TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY (order_id, seq)
);
CREATE TRIGGER IF NOT EXISTS order_events_append_only_update BEFORE UPDATE ON order_events
BEGIN SELECT RAISE(ABORT, 'order_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS order_events_append_only_delete BEFORE DELETE ON order_events
BEGIN SELECT RAISE(ABORT, 'order_events is append-only'); END;
`;

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  const signalColumns = (db.prepare("PRAGMA table_info(signals)").all() as { name: string }[]).map((c) => c.name);
  if (!signalColumns.includes("superseded_json")) db.exec("ALTER TABLE signals ADD COLUMN superseded_json TEXT");
  const orderColumns = (db.prepare("PRAGMA table_info(orders)").all() as { name: string }[]).map((c) => c.name);
  if (!orderColumns.includes("claim_hash")) db.exec("ALTER TABLE orders ADD COLUMN claim_hash TEXT");
  return db;
}

/** Run fn inside BEGIN IMMEDIATE so concurrent writers serialise instead of interleaving. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
