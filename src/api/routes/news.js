'use strict';
const { Router } = require('express');
const newsAgg    = require('../../sources/news');

const r = Router();

// GET /api/news?limit=20&hours=24&symbol=RELIANCE
r.get('/', (req, res) => {
  const limit  = parseInt(req.query.limit  || '20');
  const hours  = parseInt(req.query.hours  || '24');
  const symbol = req.query.symbol || null;

  const articles = symbol
    ? newsAgg.getCachedNews(hours, symbol)
    : newsAgg.getTopNews(limit, hours);

  res.json(articles.slice(0, limit));
});

// POST /api/news/fetch  — trigger fresh fetch
r.post('/fetch', async (req, res) => {
  const { symbol } = req.body;
  try {
    const pm      = require('../../portfolio/manager');
    const symbols = symbol
      ? [symbol]
      : pm.getAllHoldings().map(h => h.symbol).filter(Boolean);
    const articles = await newsAgg.fetchAndCache(symbols);
    res.json({ fetched: articles.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = r;
