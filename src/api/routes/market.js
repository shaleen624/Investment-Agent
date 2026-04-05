'use strict';
const { Router }          = require('express');
const { all }             = require('../../db');
const market              = require('../../sources/market');
const { authenticateToken } = require('../middleware/auth');

const r = Router();
r.use(authenticateToken);

// Helper: does a snapshot have at least one real price?
function isSnapshotValid(snap) {
  if (!snap) return false;
  return [snap.nifty50, snap.sensex, snap.dow_jones, snap.nasdaq, snap.usd_inr]
    .some(v => v != null);
}

// GET /api/market/snapshot  — latest stored snapshot (lazy fetch if missing/stale/empty)
r.get('/snapshot', async (_req, res) => {
  try {
    const today = market.getCurrentIstDate();
    let snap = market.getLatestSnapshot();

    // Refresh if: no snapshot, or it's from a previous day, or it has no valid prices.
    if (!isSnapshotValid(snap) || snap.date !== today) {
      const timeout = new Promise((_, rej) =>
        setTimeout(() => rej(new Error('Snapshot fetch timed out')), 20000));
      await Promise.race([market.captureMarketSnapshot(), timeout]).catch(() => {});
      snap = market.getLatestSnapshot();
    }

    if (!snap) return res.status(404).json({ error: 'No market data available yet. Try POST /api/market/refresh.' });

    const result = { ...snap };

    // Annotate when data is stale (couldn't get today's data)
    if (!isSnapshotValid(snap)) {
      result._warning = 'Market data sources unavailable. Prices may be stale or missing.';
    } else if (snap.date !== today) {
      result._warning = `Live data unavailable. Showing last available data from ${snap.date}.`;
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/market/snapshot/previous
r.get('/snapshot/previous', (_req, res) => {
  const snap = market.getPreviousDaySnapshot();
  res.json(snap || null);
});

// GET /api/market/snapshots?days=7  — history for sparklines
r.get('/snapshots', (req, res) => {
  const days = parseInt(req.query.days || '7');
  const rows = all(
    `SELECT * FROM market_snapshots
     WHERE date >= date('now', '-' || ? || ' days')
     ORDER BY date ASC, time ASC`,
    [days]
  );
  res.json(rows.map(r => ({
    ...r,
    raw_data: JSON.parse(r.raw_data || '{}'),
  })));
});

// POST /api/market/refresh  — live fetch + store snapshot
r.post('/refresh', async (_req, res) => {
  try {
    const timeout = new Promise((_, rej) =>
      setTimeout(() => rej(new Error('Market refresh timed out after 30s')), 30000));
    const snap = await Promise.race([market.captureMarketSnapshot(), timeout]);
    res.json(snap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/market/recommendations?limit=10
r.get('/recommendations', (req, res) => {
  const limit  = parseInt(req.query.limit || '10');
  const userId = req.user.id;
  const rows   = all(
    `SELECT r.*, h.name as holding_name FROM recommendations r
     LEFT JOIN holdings h ON r.holding_id = h.id
     WHERE r.user_id = ?
     ORDER BY r.created_at DESC LIMIT ?`,
    [userId, limit]
  );
  res.json(rows);
});

module.exports = r;
