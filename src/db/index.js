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
