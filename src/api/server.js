'use strict';

/**
 * Express REST API server.
 * Provides all data endpoints consumed by the Angular PWA.
 *
 * Default port: 3000 (override with API_PORT env var).
 * CORS is open in development; restrict ALLOWED_ORIGIN in production.
 */

const express    = require('express');
const path       = require('path');
const logger     = require('../config/logger');
const { config } = require('../config');

// ── Route modules ─────────────────────────────────────────────────────────────
const portfolioRoutes     = require('./routes/portfolio');
const goalsRoutes         = require('./routes/goals');
const briefsRoutes        = require('./routes/briefs');
const marketRoutes        = require('./routes/market');
const newsRoutes          = require('./routes/news');
const notificationsRoutes = require('./routes/notifications');
const statusRoutes        = require('./routes/status');

const app  = express();
const PORT = parseInt(process.env.API_PORT || '3000', 10);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

// ── Middleware ─────────────────────────────────────────────────────────────────

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin',  ALLOWED_ORIGIN);
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Request logger
app.use((req, _res, next) => {
  logger.debug(`[API] ${req.method} ${req.path}`);
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/api/status',        statusRoutes);
app.use('/api/portfolio',     portfolioRoutes);
app.use('/api/goals',         goalsRoutes);
app.use('/api/briefs',        briefsRoutes);
app.use('/api/market',        marketRoutes);
app.use('/api/news',          newsRoutes);
app.use('/api/notifications', notificationsRoutes);

// ── Serve Angular PWA (production) ────────────────────────────────────────────
const pwaDistPath = path.resolve(__dirname, '../../pwa/dist/investment-pwa/browser');
const { existsSync } = require('fs');

if (existsSync(pwaDistPath)) {
  app.use(express.static(pwaDistPath));
  // All non-API routes return index.html (Angular routing)
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(pwaDistPath, 'index.html'));
  });
  logger.info(`[API] Serving Angular PWA from ${pwaDistPath}`);
}

// ── Error handler ─────────────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  logger.error(`[API] Unhandled error: ${err.message}`);
  res.status(500).json({ error: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────

function start() {
  return new Promise((resolve) => {
    const server = app.listen(PORT, () => {
      logger.info(`[API] Server running on http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

module.exports = { app, start };
