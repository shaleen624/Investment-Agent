'use strict';

const path = require('path');
const fs   = require('fs');

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  console.error('[DB] better-sqlite3 not installed. Run: npm install');
  process.exit(1);
}

const { SCHEMA } = require('./schema');

let _db = null;

/**
 * Returns a singleton SQLite database connection.
 * Creates the database file and applies the schema on first call.
 */
function getDb() {
  if (_db) return _db;

  const dbPath = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.resolve(__dirname, '../../data/portfolio.db');

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new Database(dbPath);

  // Enable WAL mode for better concurrency
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  // Apply schema
  _db.exec(SCHEMA);

  // ── Migrations ──────────────────────────────────────────────────────────────
  // market_snapshots.user_id was NOT NULL but snapshots are global; make nullable
  try {
    const colInfo = _db.pragma('table_info(market_snapshots)');
    const uidCol = colInfo.find(c => c.name === 'user_id');
    if (uidCol && uidCol.notnull === 1) {
      _db.exec(`
        CREATE TABLE IF NOT EXISTS _ms_tmp AS SELECT * FROM market_snapshots;
        DROP TABLE IF EXISTS market_snapshots;
        CREATE TABLE market_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          date TEXT NOT NULL, time TEXT NOT NULL,
          nifty50 REAL, sensex REAL, nifty_bank REAL, nifty_mid REAL,
          dow_jones REAL, nasdaq REAL, sp500 REAL, gold_mcx REAL,
          crude_mcx REAL, usd_inr REAL, vix REAL,
          raw_data TEXT DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO market_snapshots SELECT * FROM _ms_tmp;
        DROP TABLE _ms_tmp;
      `);
    }
  } catch {}

  try {
    const holdingsInfo = _db.pragma('table_info(holdings)');
    const hasIsin = holdingsInfo.some((col) => col.name === 'isin');
    if (!hasIsin) {
      _db.exec('ALTER TABLE holdings ADD COLUMN isin TEXT');
    }
    _db.exec('CREATE INDEX IF NOT EXISTS idx_holdings_isin ON holdings(isin)');
  } catch {}

  // Add default_llm_provider / default_llm_model to user_profile if missing
  try {
    const profileInfo = _db.pragma('table_info(user_profile)');
    if (!profileInfo.some((c) => c.name === 'default_llm_provider')) {
      _db.exec('ALTER TABLE user_profile ADD COLUMN default_llm_provider TEXT');
    }
    if (!profileInfo.some((c) => c.name === 'default_llm_model')) {
      _db.exec('ALTER TABLE user_profile ADD COLUMN default_llm_model TEXT');
    }
  } catch {}

  return _db;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function run(sql, params = []) {
  return getDb().prepare(sql).run(...(Array.isArray(params) ? params : [params]));
}

function get(sql, params = []) {
  return getDb().prepare(sql).get(...(Array.isArray(params) ? params : [params]));
}

function all(sql, params = []) {
  return getDb().prepare(sql).all(...(Array.isArray(params) ? params : [params]));
}

function close() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

module.exports = { getDb, run, get, all, close };
