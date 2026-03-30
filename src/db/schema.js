'use strict';

/**
 * All CREATE TABLE statements for the investment agent database.
 * Uses SQLite. Run via db/index.js on first boot.
 */

const SCHEMA = `
-- ── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  email         TEXT          UNIQUE,
  password_hash TEXT    NOT NULL,
  name          TEXT    NOT NULL DEFAULT 'Investor',
  telegram_id   TEXT,
  whatsapp      TEXT,
  timezone      TEXT    NOT NULL DEFAULT 'Asia/Kolkata',
  morning_time  TEXT    NOT NULL DEFAULT '08:00',
  evening_time  TEXT    NOT NULL DEFAULT '20:00',
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── User Sessions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token         TEXT    NOT NULL UNIQUE,
  expires_at    TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Investment Goals ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS goals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT    NOT NULL CHECK (type IN ('short_term','long_term')),
  title           TEXT    NOT NULL,
  description     TEXT,
  target_amount   REAL,
  target_date     TEXT,   -- ISO date YYYY-MM-DD
  risk_tolerance  TEXT    NOT NULL DEFAULT 'moderate'
                          CHECK (risk_tolerance IN ('conservative','moderate','aggressive')),
  priority        INTEGER NOT NULL DEFAULT 5,   -- 1 (highest) – 10 (lowest)
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Holdings ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS holdings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_type      TEXT    NOT NULL
                    CHECK (asset_type IN (
                      'equity','mutual_fund','etf','bond',
                      'fd','nps','crypto','us_stock','other'
                    )),
  symbol          TEXT,               -- NSE/BSE ticker or ISIN
  name            TEXT    NOT NULL,
  exchange        TEXT    DEFAULT 'NSE',  -- NSE | BSE | NASDAQ | NYSE | etc.
  quantity        REAL    NOT NULL DEFAULT 0,
  avg_buy_price   REAL    NOT NULL DEFAULT 0,
  current_price   REAL    DEFAULT 0,
  current_value   REAL    DEFAULT 0,
  invested_amount REAL    DEFAULT 0,
  unrealized_pnl  REAL    DEFAULT 0,
  pnl_percent     REAL    DEFAULT 0,
  sector          TEXT,
  broker          TEXT    DEFAULT 'manual',  -- kite | groww | manual
  folio_number    TEXT,               -- for MFs
  units           REAL,               -- for MFs
  nav             REAL,               -- for MFs
  maturity_date   TEXT,               -- for FD/bond
  interest_rate   REAL,               -- for FD/bond
  last_updated    TEXT    NOT NULL DEFAULT (datetime('now')),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Transaction History ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  holding_id      INTEGER REFERENCES holdings(id) ON DELETE CASCADE,
  type            TEXT    NOT NULL CHECK (type IN ('buy','sell','dividend','sip','redemption')),
  quantity        REAL    NOT NULL,
  price           REAL    NOT NULL,
  amount          REAL    NOT NULL,
  fees            REAL    DEFAULT 0,
  date            TEXT    NOT NULL,   -- ISO datetime
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Daily Briefs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS briefs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT    NOT NULL CHECK (type IN ('morning','evening')),
  date            TEXT    NOT NULL,   -- YYYY-MM-DD
  content         TEXT    NOT NULL,   -- full brief text (markdown)
  summary         TEXT,               -- short 3-line summary
  sent_channels   TEXT    DEFAULT '[]',  -- JSON array: ["telegram","email"]
  market_snapshot TEXT    DEFAULT '{}',  -- JSON: indices, top movers
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Market Snapshots ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_snapshots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date            TEXT    NOT NULL,
  time            TEXT    NOT NULL,
  nifty50         REAL,
  sensex          REAL,
  nifty_bank      REAL,
  nifty_mid       REAL,
  dow_jones       REAL,
  nasdaq          REAL,
  sp500           REAL,
  gold_mcx        REAL,
  crude_mcx       REAL,
  usd_inr         REAL,
  vix             REAL,
  raw_data        TEXT    DEFAULT '{}',  -- full JSON from APIs
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── News Cache ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS news_cache (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT    NOT NULL,
  title           TEXT    NOT NULL,
  url             TEXT,
  summary         TEXT,
  sentiment       TEXT    CHECK (sentiment IN ('positive','negative','neutral')),
  impact_score    REAL    DEFAULT 0,  -- 0–10, higher = more market impact
  related_symbols TEXT    DEFAULT '[]',  -- JSON array of tickers
  published_at    TEXT    NOT NULL,
  fetched_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Recommendations ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recommendations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  holding_id      INTEGER REFERENCES holdings(id) ON DELETE SET NULL,
  symbol          TEXT,
  name            TEXT,
  action          TEXT    NOT NULL CHECK (action IN ('buy','sell','hold','increase','reduce','watch')),
  rationale       TEXT    NOT NULL,
  confidence      INTEGER DEFAULT 5 CHECK (confidence BETWEEN 1 AND 10),
  time_horizon    TEXT    CHECK (time_horizon IN ('intraday','short_term','long_term')),
  target_price    REAL,
  stop_loss       REAL,
  brief_id        INTEGER REFERENCES briefs(id),
  date            TEXT    NOT NULL DEFAULT (date('now')),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Notification Log ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  channel         TEXT    NOT NULL CHECK (channel IN ('telegram','whatsapp','email')),
  type            TEXT    NOT NULL,   -- brief | alert | test
  status          TEXT    NOT NULL CHECK (status IN ('sent','failed','pending')),
  reference_id    INTEGER,            -- brief_id or recommendation_id
  error           TEXT,
  sent_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_holdings_symbol   ON holdings(symbol);
CREATE INDEX IF NOT EXISTS idx_holdings_type     ON holdings(asset_type);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_briefs_date       ON briefs(date);
CREATE INDEX IF NOT EXISTS idx_news_published    ON news_cache(published_at);
CREATE INDEX IF NOT EXISTS idx_recs_date         ON recommendations(date);
CREATE INDEX IF NOT EXISTS idx_market_date       ON market_snapshots(date);
`;

module.exports = { SCHEMA };
