'use strict';
const { Router } = require('express');
const { all, get: dbGet } = require('../../db');
const analysis   = require('../../analysis/engine');
const notify     = require('../../notifications');

const r = Router();

// GET /api/briefs?type=morning|evening&limit=10
r.get('/', (req, res) => {
  const { type, limit = 10 } = req.query;
  const sql = type
    ? `SELECT id,type,date,summary,sent_channels,market_snapshot,created_at FROM briefs WHERE type=? ORDER BY date DESC,created_at DESC LIMIT ?`
    : `SELECT id,type,date,summary,sent_channels,market_snapshot,created_at FROM briefs ORDER BY date DESC,created_at DESC LIMIT ?`;
  const rows = type ? all(sql, [type, parseInt(limit)]) : all(sql, [parseInt(limit)]);
  res.json(rows.map(r => ({
    ...r,
    sent_channels:   JSON.parse(r.sent_channels   || '[]'),
    market_snapshot: JSON.parse(r.market_snapshot || '{}'),
  })));
});

// GET /api/briefs/latest?type=morning
r.get('/latest', (req, res) => {
  const type = req.query.type || 'morning';
  const brief = analysis.getLatestBrief(type);
  if (!brief) return res.status(404).json({ error: 'No brief yet' });
  res.json({
    ...brief,
    sent_channels:   JSON.parse(brief.sent_channels   || '[]'),
    market_snapshot: JSON.parse(brief.market_snapshot || '{}'),
  });
});

// GET /api/briefs/:id  (full content)
r.get('/:id', (req, res) => {
  const brief = dbGet('SELECT * FROM briefs WHERE id=?', [parseInt(req.params.id)]);
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
    const { content, briefId } = type === 'morning'
      ? await analysis.generateMorningBrief()
      : await analysis.generateEveningBrief();

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
  const rows = all(
    `SELECT * FROM recommendations WHERE brief_id=? ORDER BY confidence DESC`,
    [parseInt(req.params.id)]
  );
  res.json(rows);
});

module.exports = r;
