'use strict';
const { Router } = require('express');
const pm     = require('../../portfolio/manager');
const market = require('../../sources/market');
const parser = require('../../portfolio/parser');
const path   = require('path');
const fs     = require('fs');
const multer = require('multer');

const { casParserBroker } = require('../../sources/brokers/casparser');

const r = Router();

// File upload (PDF/CSV imports)
const upload = multer({
  dest: path.resolve(process.env.UPLOADS_PATH || './uploads'),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['.pdf', '.csv', '.txt'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Only PDF, CSV, TXT files allowed'), ok);
  },
});

// GET /api/portfolio/summary
r.get('/summary', (_req, res) => {
  const summary = pm.getPortfolioSummary();
  const xirr    = pm.calculateXIRR();
  res.json({ ...summary, xirr });
});

// GET /api/portfolio/holdings
r.get('/holdings', (_req, res) => {
  const { type } = _req.query;
  const holdings = type ? pm.getHoldingsByType(type) : pm.getAllHoldings();
  res.json(holdings);
});

// GET /api/portfolio/holdings/:id
r.get('/holdings/:id', (req, res) => {
  const h = pm.getHolding(parseInt(req.params.id));
  if (!h) return res.status(404).json({ error: 'Not found' });
  const txns = pm.getTransactions(h.id);
  res.json({ ...h, transactions: txns });
});

// POST /api/portfolio/holdings
r.post('/holdings', (req, res) => {
  try {
    const id = pm.upsertHolding(req.body);
    res.status(201).json({ id, ...req.body });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/portfolio/holdings/:id
r.put('/holdings/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = pm.getHolding(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  pm.upsertHolding({ ...existing, ...req.body, id });
  res.json({ id, ...req.body });
});

// DELETE /api/portfolio/holdings/:id
r.delete('/holdings/:id', (req, res) => {
  pm.deleteHolding(parseInt(req.params.id));
  res.json({ deleted: true });
});

// POST /api/portfolio/import  (text)
r.post('/import/text', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });
  const holdings = parser.parseText(text);
  const result   = pm.upsertHoldings(holdings);
  res.json({ parsed: holdings.length, ...result, holdings });
});

// POST /api/portfolio/import/file  (PDF/CSV upload)
r.post('/import/file', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const holdings = await parser.parseFile(req.file.path);
    const result   = pm.upsertHoldings(holdings);
    fs.unlink(req.file.path, () => {});
    res.json({ parsed: holdings.length, ...result, holdings });
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    res.status(422).json({ error: err.message });
  }
});

// POST /api/portfolio/prices/refresh
r.post('/prices/refresh', async (_req, res) => {
  const result = await market.updateAllPrices();
  res.json(result);
});

// POST /api/portfolio/sync/cdsl/start
// body: { boId: string, pan?: string }
r.post('/sync/cdsl/start', async (req, res) => {
  try {
    if (!casParserBroker.isConfigured()) {
      return res.status(400).json({
        error: 'CDSL direct sync is not configured. Set CAS_PARSER_API_KEY to enable API-based sync.',
      });
    }

    const payload = await casParserBroker.startCdslFetch({
      boId: req.body?.boId,
      pan: req.body?.pan,
    });

    res.json(payload);
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

// POST /api/portfolio/sync/cdsl/verify
// body: { sessionId: string, otp: string }
r.post('/sync/cdsl/verify', async (req, res) => {
  try {
    if (!casParserBroker.isConfigured()) {
      return res.status(400).json({
        error: 'CDSL direct sync is not configured. Set CAS_PARSER_API_KEY to enable API-based sync.',
      });
    }

    const { data, holdings } = await casParserBroker.verifyCdslFetch({
      sessionId: req.body?.sessionId,
      otp: req.body?.otp,
    });

    const result = pm.upsertHoldings(holdings);
    res.json({ synced: holdings.length, ...result, providerResponse: data });
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

// POST /api/portfolio/sync/:broker
r.post('/sync/:broker', async (req, res) => {
  const broker = req.params.broker;
  try {
    let holdings = [];
    if (broker === 'kite') {
      const kite = require('../../sources/brokers/kite');
      const [eq, mf] = await Promise.allSettled([kite.getHoldings(), kite.getMFHoldings()]);
      holdings = [...(eq.value || []), ...(mf.value || [])];
    } else if (broker === 'groww') {
      const groww = require('../../sources/brokers/groww');
      holdings = await groww.getHoldings();
    } else if (broker === 'cdsl' || broker === 'nsdl') {
      return res.status(400).json({
        error: `${broker.toUpperCase()} direct sync requires OTP flow endpoints: /api/portfolio/sync/cdsl/start and /api/portfolio/sync/cdsl/verify. For NSDL, upload CAS PDF via /api/portfolio/import/file.`,
      });
    } else {
      return res.status(400).json({ error: `Unknown broker: ${broker}` });
    }
    const result = pm.upsertHoldings(holdings);
    res.json({ synced: holdings.length, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = r;
