'use strict';

/**
 * Market data aggregator.
 * Tries multiple sources in priority order and returns the first success.
 * Caches results in the database to avoid redundant API calls.
 */

const logger       = require('../../config/logger');
const { run, get: dbGet, all } = require('../../db');
const yahoo        = require('./yahoo');
const nse          = require('./nse');
const alphaVantage = require('./alpha-vantage');

// ── Price fetching with fallback ───────────────────────────────────────────

/**
 * Get current price for a holding.
 * Priority: Yahoo Finance → NSE (for Indian stocks) → Alpha Vantage
 *
 * @param {string} symbol
 * @param {string} assetType  - from holdings.asset_type
 * @param {string} exchange
 * @returns {{ price, change, changePercent, name, ... }}
 */
async function getPrice(symbol, assetType = 'equity', exchange = 'NSE') {
  // MFs, FDs, bonds are not directly fetchable from market APIs
  if (['mutual_fund', 'fd', 'nps', 'bond'].includes(assetType)) {
    return null;
  }

  // Try Yahoo first (works for everything)
  try {
    return await yahoo.getQuote(symbol, exchange);
  } catch (e1) {
    logger.debug(`[Market] Yahoo failed for ${symbol}: ${e1.message}`);
  }

  // Try NSE for Indian equities
  if (exchange === 'NSE') {
    try {
      return await nse.getQuote(symbol);
    } catch (e2) {
      logger.debug(`[Market] NSE failed for ${symbol}: ${e2.message}`);
    }
  }

  // Try Alpha Vantage as last resort (rate limited)
  try {
    return await alphaVantage.getGlobalQuote(symbol);
  } catch (e3) {
    logger.warn(`[Market] All sources failed for ${symbol}: ${e3.message}`);
    return null;
  }
}

/**
 * Update prices for all holdings in the database.
 * Returns a summary of updated/failed holdings.
 */
async function updateAllPrices() {
  const holdings = all(
    `SELECT id, symbol, asset_type, exchange, name
     FROM holdings
     WHERE asset_type NOT IN ('mutual_fund','fd','nps','bond')
       AND symbol IS NOT NULL
     ORDER BY asset_type, symbol`
  );

  const results = { updated: 0, failed: 0, skipped: 0 };

  for (const h of holdings) {
    try {
      const quote = await getPrice(h.symbol, h.asset_type, h.exchange || 'NSE');
      if (!quote || !quote.price) {
        results.skipped++;
        continue;
      }

      const currentValue = h.quantity ? h.quantity * quote.price : quote.price;
      const investedAmt  = dbGet('SELECT invested_amount, avg_buy_price, quantity FROM holdings WHERE id = ?', [h.id]);
      const invested     = investedAmt?.invested_amount || 0;
      const unrealizedPnl = currentValue - invested;
      const pnlPct = invested > 0 ? (unrealizedPnl / invested) * 100 : 0;

      run(
        `UPDATE holdings
         SET current_price   = ?,
             current_value   = ?,
             unrealized_pnl  = ?,
             pnl_percent     = ?,
             last_updated    = datetime('now')
         WHERE id = ?`,
        [quote.price, currentValue, unrealizedPnl, pnlPct, h.id]
      );

      results.updated++;
    } catch {
      results.failed++;
    }

    // Small delay to avoid hammering APIs
    await new Promise(r => setTimeout(r, 300));
  }

  logger.info(`[Market] Price update: ${results.updated} updated, ${results.failed} failed, ${results.skipped} skipped`);
  return results;
}

/**
 * Fetch and store a market snapshot (indices).
 */
async function captureMarketSnapshot() {
  try {
    const indices = await yahoo.getMarketIndices();
    const today   = new Date().toISOString().slice(0, 10);
    const time    = new Date().toTimeString().slice(0, 5);

    run(
      `INSERT INTO market_snapshots
         (date, time, nifty50, sensex, nifty_bank, nifty_mid,
          dow_jones, nasdaq, sp500, gold_mcx, crude_mcx, usd_inr, vix, raw_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        today, time,
        indices.nifty50?.price,
        indices.sensex?.price,
        indices.niftyBank?.price,
        indices.niftyMid?.price,
        indices.dowJones?.price,
        indices.nasdaq?.price,
        indices.sp500?.price,
        indices.goldMcx?.price,
        indices.crudeMcx?.price,
        indices.usdInr?.price,
        indices.vix?.price,
        JSON.stringify(indices),
      ]
    );

    logger.info(`[Market] Snapshot captured for ${today} ${time}`);
    return indices;
  } catch (err) {
    logger.error(`[Market] captureMarketSnapshot failed: ${err.message}`);
    return {};
  }
}

/**
 * Get the latest stored market snapshot.
 */
function getLatestSnapshot() {
  const row = dbGet(
    `SELECT * FROM market_snapshots ORDER BY date DESC, time DESC LIMIT 1`
  );
  if (!row) return null;
  try {
    row.raw_data = JSON.parse(row.raw_data || '{}');
  } catch {
    row.raw_data = {};
  }
  return row;
}

/**
 * Get yesterday's snapshot for comparison.
 */
function getPreviousDaySnapshot() {
  const row = dbGet(
    `SELECT * FROM market_snapshots
     WHERE date < date('now')
     ORDER BY date DESC, time DESC LIMIT 1`
  );
  if (!row) return null;
  try {
    row.raw_data = JSON.parse(row.raw_data || '{}');
  } catch {
    row.raw_data = {};
  }
  return row;
}

module.exports = {
  getPrice,
  updateAllPrices,
  captureMarketSnapshot,
  getLatestSnapshot,
  getPreviousDaySnapshot,
  // Re-export raw sources for direct use
  yahoo,
  nse,
  alphaVantage,
};
