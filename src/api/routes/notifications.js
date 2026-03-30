'use strict';
const { Router } = require('express');
const { all }    = require('../../db');
const notify     = require('../../notifications');
const pm         = require('../../portfolio/manager');

const r = Router();

// POST /api/notifications/test
r.post('/test', async (_req, res) => {
  try {
    const timeout = new Promise((_, rej) =>
      setTimeout(() => rej(new Error('Notification test timed out after 15s')), 15000));
    const results = await Promise.race([notify.testChannels(), timeout]);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/alert  { message: string }
r.post('/alert', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  try {
    const timeout = new Promise((_, rej) =>
      setTimeout(() => rej(new Error('Alert send timed out after 15s')), 15000));
    const results = await Promise.race([notify.sendAlert(message), timeout]);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/notifications/log?limit=50
r.get('/log', (req, res) => {
  const limit = parseInt(req.query.limit || '50');
  const rows  = all(
    `SELECT * FROM notification_log ORDER BY sent_at DESC LIMIT ?`,
    [limit]
  );
  res.json(rows);
});

// GET /api/notifications/profile
r.get('/profile', (_req, res) => {
  res.json(pm.getProfile() || {});
});

// PUT /api/notifications/profile
r.put('/profile', (req, res) => {
  pm.upsertProfile(req.body);
  // Restart scheduler if times changed
  if (req.body.morning_time || req.body.evening_time) {
    try { require('../../scheduler').restart(); } catch {}
  }
  res.json({ updated: true });
});

module.exports = r;
