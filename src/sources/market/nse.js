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
const SESSION_RETRY_COOLDOWN = 60 * 1000; // 1 minute after hard block

let _session = { cookies: '', expiresAt: 0, blockedUntil: 0, lastWarnAt: 0 };

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
};

const API_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': `${BASE}/`,
  'Origin': BASE,
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'X-Requested-With': 'XMLHttpRequest',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

function logSessionWarning(message) {
  const now = Date.now();
  if (now - _session.lastWarnAt >= 15000) {
    logger.warn(message);
    _session.lastWarnAt = now;
  } else {
    logger.debug(message);
  }
}

async function tryBootstrap(url) {
  const res = await axios.get(url, {
    headers: BROWSER_HEADERS,
    timeout: 10000,
    maxRedirects: 5,
    validateStatus: (status) => status >= 200 && status < 400,
  });
  const setCookie = res.headers['set-cookie'] || [];
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

async function getSession() {
  if (_session.cookies && Date.now() < _session.expiresAt) {
    return _session.cookies;
  }
  if (_session.blockedUntil && Date.now() < _session.blockedUntil) {
    return _session.cookies || '';
  }

  try {
    const bootstrapUrls = [
      `${BASE}/`,
      `${BASE}/market-data/live-equity-market`,
      `${BASE}/option-chain`,
    ];

    let cookies = '';
    for (const url of bootstrapUrls) {
      try {
        cookies = await tryBootstrap(url);
        if (cookies) break;
      } catch (err) {
        if (err.response?.status === 403) continue;
        throw err;
      }
    }

    _session.cookies = cookies;
    _session.expiresAt = Date.now() + SESSION_TIMEOUT;
    _session.blockedUntil = 0;
    return _session.cookies;
  } catch (err) {
    if (err.response?.status === 403) {
      _session.blockedUntil = Date.now() + SESSION_RETRY_COOLDOWN;
    }
    logSessionWarning(`[NSE] Session refresh failed: ${err.message}`);
    return '';
  }
}

async function nseGet(endpoint) {
  const cookies = await getSession();
  try {
    const res = await axios.get(`${BASE}/api/${endpoint}`, {
      headers: { ...API_HEADERS, Cookie: cookies },
      timeout: 7000,
    });
    return res.data;
  } catch (err) {
    // Retry once with fresh session on 401/403
    if (err.response && [401, 403].includes(err.response.status)) {
      _session.expiresAt = 0; // force refresh
      _session.cookies = '';
      const freshCookies = await getSession();
      const retry = await axios.get(`${BASE}/api/${endpoint}`, {
        headers: { ...API_HEADERS, Cookie: freshCookies },
        timeout: 7000,
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
