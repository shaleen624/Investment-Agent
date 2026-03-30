'use strict';
const { Router } = require('express');
const { all, get: dbGet } = require('../../db');
const analysis   = require('../../analysis/engine');
const notify     = require('../../notifications');
const { authenticateToken } = require('../middleware/auth');

const r = Router();

r.use(authenticateToken);

// GET /api/briefs?type=morning|evening&limit=10
r.get('/', (req, res) => {
  const { type, limit = 10 } = req.query;
  const userId = req.user.id;
  const sql = type
    ? `SELECT id,type,date,summary,sent_channels,market_snapshot,created_at FROM briefs WHERE user_id = ? AND type = ? ORDER BY date DESC,created_at DESC LIMIT ?`
    : `SELECT id,type,date,summary,sent_channels,market_snapshot,created_at FROM briefs WHERE user_id = ? ORDER BY date DESC,created_at DESC LIMIT ?`;
  const rows = type ? all(sql, [userId, type, parseInt(limit)]) : all(sql, [userId, parseInt(limit)]);
  res.json(rows.map(r => ({
    ...r,
    sent_channels:   JSON.parse(r.sent_channels   || '[]'),
    market_snapshot: JSON.parse(r.market_snapshot || '{}'),
  })));
});

// GET /api/briefs/latest?type=morning
r.get('/latest', (req, res) => {
  const type = req.query.type || 'morning';
  const userId = req.user.id;
  const brief = dbGet(
    `SELECT * FROM briefs
     WHERE user_id = ? AND type = ?
     ORDER BY date DESC, created_at DESC
     LIMIT 1`,
    [userId, type]
  );
  if (!brief) return res.status(404).json({ error: 'No brief yet' });
  res.json({
    ...brief,
    sent_channels:   JSON.parse(brief.sent_channels   || '[]'),
    market_snapshot: JSON.parse(brief.market_snapshot || '{}'),
  });
});

// GET /api/briefs/:id  (full content)
r.get('/:id', (req, res) => {
  const userId = req.user.id;
  const brief = dbGet('SELECT * FROM briefs WHERE id=? AND user_id=?', [parseInt(req.params.id), userId]);
  if (!brief) return res.status(404).json({ error: 'Not found' });
  res.json({
    ...brief,
    sent_channels:   JSON.parse(brief.sent_channels   || '[]'),
    market_snapshot: JSON.parse(brief.market_snapshot || '{}'),
  });
});

// POST /api/briefs/generate  { type: "morning"|"evening", send: true|false }
r.post('/generate', async (req, res) => {
  const type   = req.body.type || 'morning';
  const send   = req.body.send !== false;
  try {
    const userId = req.user.id;
    const { content, briefId } = type === 'morning'
      ? await analysis.generateMorningBrief(userId)
      : await analysis.generateEveningBrief(userId);

    let sent = [];
    if (send) {
      sent = await notify.sendBriefToAll(content, type, briefId);
      analysis.markBriefSent(briefId, sent);
    }
    res.json({ briefId, type, sent, preview: content.slice(0, 500) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/briefs/:id/recommendations
r.get('/:id/recommendations', (req, res) => {
  const userId = req.user.id;
  const briefId = parseInt(req.params.id);
  const rows = all(
    `SELECT r.* FROM recommendations r
     JOIN briefs b ON b.id = r.brief_id
     WHERE r.brief_id = ? AND b.user_id = ?
     ORDER BY r.confidence DESC`,
    [briefId, userId]
  );
  res.json(rows);
});

module.exports = r;
