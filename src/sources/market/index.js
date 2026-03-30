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
const { isLikelyIsin, resolveTickerFromHolding } = require('./symbol-resolver');
const RESOLVE_CONCURRENCY = 16;
const QUOTE_BATCH_SIZE = 20;
const REFRESH_DEADLINE_BUFFER_MS = 5000;

function getIstDateTimeParts(now = new Date()) {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);

  return { date, time };
}

function getCurrentIstDate() {
  return getIstDateTimeParts().date;
}

async function mapInBatches(items, worker, concurrency = 5) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runner() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await worker(items[current], current);
    }
  }

  const size = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: size }, () => runner()));
  return results;
}

function createRefreshDebugMeta(totalHoldings = 0) {
  return {
    totalHoldings,
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
    apply: {
      processed: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      durationMs: 0,
      lastSymbol: null,
    },
    elapsedMs: 0,
  };
}

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
  if (isLikelyIsin(symbol)) {
    logger.debug(`[Market] Skipping quote lookup for ISIN-like symbol: ${symbol}`);
    return null;
  }

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
async function updateAllPrices(userId = null, options = {}) {
  const startedAt = Date.now();
  const deadline = options.deadlineMs
    ? startedAt + Math.max(1000, options.deadlineMs - REFRESH_DEADLINE_BUFFER_MS)
    : null;

  const params = [];
  let sql =
    `SELECT id, user_id, symbol, isin, asset_type, exchange, name, quantity
     FROM holdings
     WHERE asset_type NOT IN ('mutual_fund','fd','nps','bond')
       AND symbol IS NOT NULL`;

  if (userId) {
    sql += ' AND user_id = ?';
    params.push(userId);
  }

  sql += ' ORDER BY asset_type, symbol';

  const holdings = all(sql, params);
  const debug = options.progress || createRefreshDebugMeta(holdings.length);
  debug.totalHoldings = holdings.length;

  const results = {
    updated: 0,
    failed: 0,
    skipped: 0,
    partial: false,
    remaining: 0,
    unresolvedHoldings: [],
    debug,
  };

  const resolveStartedAt = Date.now();
  debug.resolve.started = holdings.filter((holding) => isLikelyIsin(holding.symbol)).length;
  const prepared = await mapInBatches(holdings, async (holding) => {
    let effectiveSymbol = holding.symbol;
    let effectiveExchange = holding.exchange || 'NSE';

    if (isLikelyIsin(effectiveSymbol)) {
      const resolved = await resolveTickerFromHolding(holding);
      if (resolved.resolved && resolved.symbol) {
        effectiveSymbol = resolved.symbol;
        effectiveExchange = resolved.exchange || effectiveExchange;
        run(
          `UPDATE holdings
           SET symbol = ?, isin = COALESCE(isin, ?), exchange = ?, last_updated = datetime('now')
           WHERE id = ? AND user_id = ?`,
          [effectiveSymbol, resolved.isin || holding.symbol, effectiveExchange, holding.id, holding.user_id]
        );
        logger.info(`[Market] Resolved ${holding.name} from ISIN ${holding.symbol} to ${effectiveSymbol}`);
        debug.resolve.resolved++;
      } else {
        debug.resolve.unresolvedIsins++;
        const unresolved = {
          id: holding.id,
          name: holding.name,
          symbol: holding.symbol,
          isin: holding.isin || holding.symbol,
          exchange: holding.exchange || 'NSE',
        };
        if (debug.resolve.unresolvedHoldings.length < 10) {
          debug.resolve.unresolvedHoldings.push(unresolved);
        }
        if (results.unresolvedHoldings.length < 10) {
          results.unresolvedHoldings.push(unresolved);
        }
      }
    }

    debug.resolve.completed++;
    debug.elapsedMs = Date.now() - startedAt;

    return { ...holding, effectiveSymbol, effectiveExchange };
  }, RESOLVE_CONCURRENCY);
  debug.resolve.durationMs = Date.now() - resolveStartedAt;

  const quoteMap = new Map();
  const batchable = prepared.filter((holding) =>
    holding.effectiveSymbol &&
    !isLikelyIsin(holding.effectiveSymbol) &&
    !['mutual_fund', 'fd', 'nps', 'bond'].includes(holding.asset_type) &&
    holding.effectiveExchange === 'NSE'
  );

  const batchStartedAt = Date.now();
  for (let i = 0; i < batchable.length; i += QUOTE_BATCH_SIZE) {
    if (deadline && Date.now() >= deadline) {
      results.partial = true;
      break;
    }
    const chunk = batchable.slice(i, i + QUOTE_BATCH_SIZE);
    const symbols = chunk.map((holding) => holding.effectiveSymbol);
    debug.batches.attempted++;
    debug.batches.symbolsRequested += symbols.length;
    debug.batches.lastBatchSymbols = symbols.slice(0, 5);
    try {
      const quotes = await yahoo.getQuotes(symbols, 'NSE');
      for (const holding of chunk) {
        const quote = quotes[holding.effectiveSymbol];
        if (quote?.price) {
          quoteMap.set(`${holding.effectiveExchange}:${holding.effectiveSymbol}`, quote);
          debug.batches.quotesReturned++;
        }
      }
      debug.batches.completed++;
    } catch (err) {
      logger.warn(`[Market] Batch Yahoo fetch failed for ${symbols.join(', ')}: ${err.message}`);
      if (debug.batches.errors.length < 3) {
        debug.batches.errors.push(err.message);
      }
    }
    debug.elapsedMs = Date.now() - startedAt;
  }
  debug.batches.durationMs = Date.now() - batchStartedAt;

  const fallbackCandidates = prepared.filter((holding) => {
    if (!holding.effectiveSymbol) return false;
    if (isLikelyIsin(holding.effectiveSymbol)) return false;
    if (['mutual_fund', 'fd', 'nps', 'bond'].includes(holding.asset_type)) return false;
    const key = `${holding.effectiveExchange}:${holding.effectiveSymbol}`;
    return !quoteMap.has(key);
  });

  const fallbackStartedAt = Date.now();
  await mapInBatches(fallbackCandidates, async (holding) => {
    if (deadline && Date.now() >= deadline) return null;

    debug.fallback.attempted++;
    if (debug.fallback.lastSymbols.length < 5) {
      debug.fallback.lastSymbols.push(holding.effectiveSymbol);
    }

    try {
      let quote = null;
      if (holding.effectiveExchange === 'NSE') {
        quote = await nse.getQuote(holding.effectiveSymbol);
      }
      if ((!quote || !quote.price) && holding.effectiveExchange === 'NSE') {
        quote = await yahoo.getQuote(holding.effectiveSymbol, 'NSE');
      }
      if (quote?.price) {
        quoteMap.set(`${holding.effectiveExchange}:${holding.effectiveSymbol}`, quote);
        debug.fallback.quotesReturned++;
      }
    } catch (err) {
      logger.debug(`[Market] Fallback quote failed for ${holding.effectiveSymbol}: ${err.message}`);
    }

    debug.fallback.completed++;
    debug.elapsedMs = Date.now() - startedAt;
    return null;
  }, 8);
  debug.fallback.durationMs = Date.now() - fallbackStartedAt;

  let processed = 0;
  const applyStartedAt = Date.now();
  for (const holding of prepared) {
    if (deadline && Date.now() >= deadline) {
      results.partial = true;
      break;
    }

    try {
      const key = `${holding.effectiveExchange}:${holding.effectiveSymbol}`;
      const quote = quoteMap.get(key);
      debug.apply.lastSymbol = holding.effectiveSymbol || holding.symbol || holding.name;

      if (!quote || !quote.price) {
        results.skipped++;
        debug.apply.skipped++;
        processed++;
        debug.apply.processed = processed;
        continue;
      }

      const currentValue = holding.quantity ? holding.quantity * quote.price : quote.price;
      const investedAmt  = dbGet(
        'SELECT invested_amount, avg_buy_price, quantity FROM holdings WHERE id = ? AND user_id = ?',
        [holding.id, holding.user_id]
      );
      const invested = investedAmt?.invested_amount || 0;
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
        [quote.price, currentValue, unrealizedPnl, pnlPct, holding.id]
      );

      results.updated++;
      debug.apply.updated++;
    } catch (err) {
      logger.warn(`[Market] Price update failed for ${holding.name || holding.effectiveSymbol}: ${err.message}`);
      results.failed++;
      debug.apply.failed++;
    }
    processed++;
    debug.apply.processed = processed;
    debug.elapsedMs = Date.now() - startedAt;
  }
  debug.apply.durationMs = Date.now() - applyStartedAt;

  results.remaining = Math.max(0, prepared.length - processed);
  debug.elapsedMs = Date.now() - startedAt;

  logger.info(
    `[Market] Price update: ${results.updated} updated, ${results.failed} failed, ${results.skipped} skipped`
    + (results.partial ? `, ${results.remaining} remaining` : '')
  );
  return results;
}

/**
 * Fetch and store a market snapshot (indices).
 */
async function captureMarketSnapshot() {
  try {
    const indices = await yahoo.getMarketIndices();
    const { date: today, time } = getIstDateTimeParts();
    const firstUser = dbGet(`SELECT id FROM users ORDER BY id ASC LIMIT 1`);

    run(
      `INSERT INTO market_snapshots
         (user_id, date, time, nifty50, sensex, nifty_bank, nifty_mid,
          dow_jones, nasdaq, sp500, gold_mcx, crude_mcx, usd_inr, vix, raw_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        firstUser?.id || null,
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
  getCurrentIstDate,
  // Re-export raw sources for direct use
  yahoo,
  nse,
  alphaVantage,
};
