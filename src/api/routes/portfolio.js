'use strict';
const { Router } = require('express');
const pm     = require('../../portfolio/manager');
const market = require('../../sources/market');
const parser = require('../../portfolio/parser');
const path   = require('path');
const fs     = require('fs');
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth');

const r = Router();

// File upload (portfolio imports)
const uploadDir = path.resolve(process.env.UPLOADS_PATH || './uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ext && ext.length <= 10 ? ext : '';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
});

// GET /api/portfolio/summary
r.get('/summary', authenticateToken, (req, res) => {
  const summary = pm.getPortfolioSummary(req.user.id) || {
    totalInvested: 0,
    totalCurrent: 0,
    unrealizedPnl: 0,
    pnlPercent: 0,
    holdingsCount: 0,
    byType: {},
    bySector: {},
    holdings: [],
  };
  const xirr = pm.calculateXIRR(req.user.id);
  res.json({ ...summary, xirr });
});

// GET /api/portfolio/holdings
r.get('/holdings', authenticateToken, (req, res) => {
  const { type } = req.query;
  const holdings = type ? pm.getHoldingsByType(type, req.user.id) : pm.getAllHoldings(req.user.id);
  res.json(holdings);
});

// GET /api/portfolio/holdings/:id
r.get('/holdings/:id', authenticateToken, (req, res) => {
  const h = pm.getHolding(parseInt(req.params.id), req.user.id);
  if (!h) return res.status(404).json({ error: 'Not found' });
  const txns = pm.getTransactions(h.id, req.user.id);
  res.json({ ...h, transactions: txns });
});

// POST /api/portfolio/holdings
r.post('/holdings', authenticateToken, async (req, res) => {
  try {
    const id = await pm.upsertHoldingResolved({ ...req.body, user_id: req.user.id });
    res.status(201).json({ id, ...req.body });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/portfolio/holdings/:id
r.put('/holdings/:id', authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id);
  const existing = pm.getHolding(id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  await pm.upsertHoldingResolved({ ...existing, ...req.body, id, user_id: req.user.id });
  res.json({ id, ...req.body });
});

// DELETE /api/portfolio/holdings/:id
r.delete('/holdings/:id', authenticateToken, (req, res) => {
  const id = parseInt(req.params.id);
  const existing = pm.getHolding(id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  pm.deleteHolding(id, req.user.id);
  res.json({ deleted: true });
});

// POST /api/portfolio/import  (text)
r.post('/import/text', authenticateToken, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });
  const holdings = parser.parseText(text).map(h => ({ ...h, user_id: req.user.id }));
  const result   = await pm.upsertHoldingsResolved(holdings);
  res.json({ parsed: holdings.length, ...result, holdings });
});

// POST /api/portfolio/import/file  (PDF/CSV upload)
r.post('/import/file', authenticateToken, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (!req.file.size) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({
      error: 'Uploaded file is empty. Please attach a valid statement/export file.',
    });
  }
  try {
    const holdings = await parser.parseFile(req.file.path, {
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
    });
    if (!holdings.length) {
      fs.unlink(req.file.path, () => {});
      return res.status(422).json({
        error: 'Could not detect holdings in this file. Use a statement/export with symbol/name, quantity/units, and buy price/NAV.',
      });
    }
    const userHoldings = holdings.map(h => ({ ...h, user_id: req.user.id }));
    const result   = await pm.upsertHoldingsResolved(userHoldings);
    fs.unlink(req.file.path, () => {});
    res.json({ parsed: holdings.length, ...result, holdings: userHoldings });
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    res.status(422).json({ error: err.message });
  }
});

// POST /api/portfolio/prices/refresh
r.post('/prices/refresh', authenticateToken, async (req, res) => {
  try {
    const timeoutMs = 60000;
    const progress = {
      totalHoldings: 0,
      resolve: {
        started: 0,
        completed: 0,
        resolved: 0,
        unresolvedIsins: 0,
        durationMs: 0,
        unresolvedHoldings: [],
      },
      batches: {
        attempted: 0,
        completed: 0,
        symbolsRequested: 0,
        quotesReturned: 0,
        durationMs: 0,
        lastBatchSymbols: [],
        errors: [],
      },
      fallback: {
        attempted: 0,
        completed: 0,
        quotesReturned: 0,
        durationMs: 0,
        lastSymbols: [],
      },
      apply: { processed: 0, updated: 0, skipped: 0, failed: 0, durationMs: 0, lastSymbol: null },
      elapsedMs: 0,
    };
    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve({
        timedOut: true,
        error: 'Price refresh timed out after 60s',
        updated: progress.apply.updated,
        failed: progress.apply.failed,
        skipped: progress.apply.skipped,
        partial: true,
        remaining: Math.max(0, progress.totalHoldings - progress.apply.processed),
        unresolvedHoldings: progress.resolve.unresolvedHoldings || [],
        debug: progress,
      }), timeoutMs));
    const result = await Promise.race([
      market.updateAllPrices(req.user.id, { deadlineMs: timeoutMs, progress }),
      timeout,
    ]);
    if (result?.timedOut) {
      return res.status(504).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/portfolio/sync/:broker
r.post('/sync/:broker', authenticateToken, async (req, res) => {
  const broker = req.params.broker;
  try {
    let holdings = [];
    if (broker === 'kite') {
      const kite = require('../../sources/brokers/kite');
      const [eq, mf] = await Promise.allSettled([kite.getHoldings(), kite.getMFHoldings()]);
      holdings = [...(eq.value||[]), ...(mf.value||[])];
    } else if (broker === 'groww') {
      const groww = require('../../sources/brokers/groww');
      holdings = await groww.getHoldings();
    } else {
      return res.status(400).json({ error: `Unknown broker: ${broker}` });
    }
    const userHoldings = holdings.map(h => ({ ...h, user_id: req.user.id }));
    const result = await pm.upsertHoldingsResolved(userHoldings);
    res.json({ synced: holdings.length, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = r;
