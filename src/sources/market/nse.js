'use strict';

/**
 * NSE India market data source.
 * Uses the unofficial NSE India public API endpoints.
 * No API key required — uses session cookies.
 */

const axios  = require('axios');
const logger = require('../../config/logger');

const BASE = 'https://www.nseindia.com';

// NSE requires a session cookie obtained from the homepage first
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

let _session = { cookies: '', expiresAt: 0 };

async function getSession() {
  if (_session.cookies && Date.now() < _session.expiresAt) {
    return _session.cookies;
  }

  try {
    const res = await axios.get(BASE, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 10000,
    });
    const setCookie = res.headers['set-cookie'] || [];
    _session.cookies = setCookie.map(c => c.split(';')[0]).join('; ');
    _session.expiresAt = Date.now() + SESSION_TIMEOUT;
    return _session.cookies;
  } catch (err) {
    logger.warn(`[NSE] Session refresh failed: ${err.message}`);
    return '';
  }
}

async function nseGet(endpoint) {
  const cookies = await getSession();
  try {
    const res = await axios.get(`${BASE}/api/${endpoint}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':           'application/json, text/plain, */*',
        'Accept-Language':  'en-US,en;q=0.9',
        'Referer':          `${BASE}/`,
        'Cookie':           cookies,
      },
      timeout: 15000,
    });
    return res.data;
  } catch (err) {
    // Retry once with fresh session on 401/403
    if (err.response && [401, 403].includes(err.response.status)) {
      _session.expiresAt = 0; // force refresh
      const freshCookies = await getSession();
      const retry = await axios.get(`${BASE}/api/${endpoint}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept':     'application/json',
          'Referer':    `${BASE}/`,
          'Cookie':     freshCookies,
        },
        timeout: 15000,
      });
      return retry.data;
    }
    throw err;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get current quote for an NSE symbol.
 */
async function getQuote(symbol) {
  try {
    const data = await nseGet(`quote-equity?symbol=${encodeURIComponent(symbol)}`);
    const pd   = data.priceInfo || {};
    const info = data.info      || {};
    return {
      symbol,
      name:          info.companyName || symbol,
      sector:        info.industry,
      isin:          info.isin,
      price:         pd.lastPrice,
      change:        pd.change,
      changePercent: pd.pChange,
      open:          pd.open,
      high:          pd.intraDayHighLow?.max,
      low:           pd.intraDayHighLow?.min,
      prevClose:     pd.previousClose,
      volume:        data.marketDeptOrderBook?.totalTradedVolume,
      week52High:    pd.weekHighLow?.max,
      week52Low:     pd.weekHighLow?.min,
      exchange:      'NSE',
      fetchedAt:     new Date().toISOString(),
    };
  } catch (err) {
    logger.error(`[NSE] getQuote failed for ${symbol}: ${err.message}`);
    throw err;
  }
}

/**
 * Get Nifty 50 index data.
 */
async function getNifty50() {
  try {
    const data = await nseGet('equity-stockIndices?index=NIFTY%2050');
    const adv  = data.advance || {};
    return {
      name:          'Nifty 50',
      price:         data.metadata?.indexSymbol === 'NIFTY 50' ? data.data?.[0]?.lastPrice : undefined,
      change:        data.metadata?.change,
      changePercent: data.metadata?.percentChange,
      advances:      adv.advances,
      declines:      adv.declines,
      unchanged:     adv.unchanged,
      topGainers:    (data.data || []).sort((a, b) => b.pChange - a.pChange).slice(0, 5).map(s => ({
        symbol: s.symbol,
        change: s.pChange,
        price:  s.lastPrice,
      })),
      topLosers:     (data.data || []).sort((a, b) => a.pChange - b.pChange).slice(0, 5).map(s => ({
        symbol: s.symbol,
        change: s.pChange,
        price:  s.lastPrice,
      })),
      fetchedAt:     new Date().toISOString(),
    };
  } catch (err) {
    logger.error(`[NSE] getNifty50 failed: ${err.message}`);
    throw err;
  }
}

/**
 * Get list of all Nifty 50 constituent stocks with prices.
 */
async function getNifty50Stocks() {
  try {
    const data = await nseGet('equity-stockIndices?index=NIFTY%2050');
    return (data.data || []).map(s => ({
      symbol:        s.symbol,
      name:          s.meta?.companyName || s.symbol,
      price:         s.lastPrice,
      change:        s.change,
      changePercent: s.pChange,
      open:          s.open,
      high:          s.dayHigh,
      low:           s.dayLow,
      prevClose:     s.previousClose,
      volume:        s.totalTradedVolume,
    }));
  } catch (err) {
    logger.error(`[NSE] getNifty50Stocks failed: ${err.message}`);
    return [];
  }
}

/**
 * Get sectoral index performance.
 */
async function getSectoralIndices() {
  const sectorIndices = [
    'NIFTY%20AUTO',
    'NIFTY%20BANK',
    'NIFTY%20ENERGY',
    'NIFTY%20FMCG',
    'NIFTY%20IT',
    'NIFTY%20MEDIA',
    'NIFTY%20METAL',
    'NIFTY%20PHARMA',
    'NIFTY%20REALTY',
    'NIFTY%20FINANCIAL%20SERVICES',
  ];

  const results = [];
  for (const idx of sectorIndices) {
    try {
      const data = await nseGet(`equity-stockIndices?index=${idx}`);
      const meta = data.metadata || {};
      results.push({
        name:          meta.indexName || decodeURIComponent(idx),
        change:        meta.change,
        changePercent: meta.percentChange,
        open:          meta.open,
        high:          meta.high,
        low:           meta.low,
        prevClose:     meta.previousClose,
      });
    } catch {
      // Skip failed sector
    }
  }
  return results;
}

module.exports = { getQuote, getNifty50, getNifty50Stocks, getSectoralIndices };
