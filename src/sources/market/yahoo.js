'use strict';

/**
 * Yahoo Finance market data source.
 * Uses the yahoo-finance2 npm package — no API key needed for basic use.
 *
 * Covers: NSE/BSE equities, US stocks, ETFs, indices
 */

const logger = require('../../config/logger');
const axios = require('axios');

let yf = null;
let _yfReady = false;
const YAHOO_HOSTS = process.env.YAHOO_QUERY_HOST
  ? [process.env.YAHOO_QUERY_HOST, 'query1.finance.yahoo.com', 'query2.finance.yahoo.com']
  : ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const DEFAULT_TIMEOUT_MS = 12000;

// yahoo-finance2 v2.14+ is ESM-only and exports a class; instantiate it
async function getYF() {
  if (yf) return yf;
  try {
    const mod = await import('yahoo-finance2');
    const YahooFinance = mod.default;
    // v2.14+ exports a class — instantiate it
    yf = typeof YahooFinance === 'function' && YahooFinance.prototype?.quote
      ? new YahooFinance()
      : YahooFinance;
    _yfReady = true;
    return yf;
  } catch (err) {
    logger.warn(`[Yahoo] yahoo-finance2 not available: ${err.message}`);
    return null;
  }
}

// NSE symbol → Yahoo Finance ticker suffix is ".NS"
// BSE symbol → ".BO"
function toYahooTicker(symbol, exchange = 'NSE') {
  if (symbol.includes('.')) return symbol; // already formatted
  if (exchange === 'BSE') return `${symbol}.BO`;
  if (exchange === 'NSE') return `${symbol}.NS`;
  return symbol; // US stocks need no suffix
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function yahooGet(path, params = {}, attempt = 1, hostIdx = 0) {
  const host = YAHOO_HOSTS[hostIdx] || YAHOO_HOSTS[0];
  try {
    const { data } = await axios.get(`https://${host}${path}`, {
      params,
      timeout: DEFAULT_TIMEOUT_MS,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 Investment-Agent/0.1',
      },
    });
    return data;
  } catch (err) {
    const status = err?.response?.status;
    const retriable = status === 429 || status === 503 || status === 504;
    const dnsOrNetwork = !status;
    if ((retriable || dnsOrNetwork) && hostIdx < YAHOO_HOSTS.length - 1) {
      return yahooGet(path, params, attempt, hostIdx + 1);
    }
    if (retriable && attempt < 3) {
      await sleep(400 * attempt);
      return yahooGet(path, params, attempt + 1, hostIdx);
    }
    throw err;
  }
}

async function fetchQuotesNoCrumb(tickers = []) {
  if (!tickers.length) return [];
  const data = await yahooGet('/v7/finance/quote', { symbols: tickers.join(',') });
  return data?.quoteResponse?.result || [];
}

function mapQuoteShape(symbol, exchange, ticker, q = {}) {
  return {
    symbol,
    ticker,
    exchange,
    name:          q.shortName || q.longName || symbol,
    price:         q.regularMarketPrice,
    change:        q.regularMarketChange,
    changePercent: q.regularMarketChangePercent,
    open:          q.regularMarketOpen,
    high:          q.regularMarketDayHigh,
    low:           q.regularMarketDayLow,
    prevClose:     q.regularMarketPreviousClose,
    volume:        q.regularMarketVolume,
    marketCap:     q.marketCap,
    pe:            q.trailingPE,
    week52High:    q.fiftyTwoWeekHigh,
    week52Low:     q.fiftyTwoWeekLow,
    currency:      q.currency,
    sector:        q.sector,
    industry:      q.industry,
    fetchedAt:     new Date().toISOString(),
  };
}

/**
 * Fetch current quote for a single symbol.
 * @param {string} symbol  - e.g. "RELIANCE", "TCS", "AAPL"
 * @param {string} exchange - "NSE" | "BSE" | "NYSE" | "NASDAQ" | ""
 */
async function getQuote(symbol, exchange = 'NSE') {
  const ticker = toYahooTicker(symbol, exchange);
  try {
    const [q] = await fetchQuotesNoCrumb([ticker]);
    if (q) return mapQuoteShape(symbol, exchange, ticker, q);
  } catch (err) {
    logger.warn(`[Yahoo] no-crumb quote fetch failed for ${ticker}: ${err.message}`);
  }

  // Fallback to yahoo-finance2 quote (may need crumb/cookie).
  const yf = await getYF();
  if (!yf || typeof yf.quote !== 'function') throw new Error('yahoo-finance2 quote not available');
  try {
    const q = await yf.quote(ticker);
    return mapQuoteShape(symbol, exchange, ticker, q);
  } catch (err) {
    logger.error(`[Yahoo] getQuote failed for ${ticker}: ${err.message}`);
    throw err;
  }
}

/**
 * Bulk fetch quotes for an array of symbols.
 * Returns an object keyed by original symbol.
 */
async function getQuotes(symbols, exchange = 'NSE') {
  const tickers = symbols.map(s => toYahooTicker(s, exchange));
  const map = {};

  try {
    const byTicker = new Map();
    for (let i = 0; i < tickers.length; i += 20) {
      const batch = tickers.slice(i, i + 20);
      const rows = await fetchQuotesNoCrumb(batch);
      for (const row of rows) byTicker.set(row.symbol, row);
    }

    symbols.forEach((sym, i) => {
      const ticker = tickers[i];
      const row = byTicker.get(ticker);
      if (row) map[sym] = mapQuoteShape(sym, exchange, ticker, row);
    });
    return map;
  } catch (err) {
    logger.warn(`[Yahoo] no-crumb getQuotes failed, falling back: ${err.message}`);
  }

  // Fallback path
  const yf = await getYF();
  if (!yf || typeof yf.quote !== 'function') throw new Error('yahoo-finance2 quote not available');
  try {
    for (let i = 0; i < tickers.length; i += 20) {
      const batch = tickers.slice(i, i + 20);
      const results = await yf.quote(batch);
      const arr = Array.isArray(results) ? results : [results];
      arr.forEach((q, idx) => {
        const globalIdx = i + idx;
        const sym = symbols[globalIdx] || q.symbol;
        const ticker = tickers[globalIdx];
        map[sym] = mapQuoteShape(sym, exchange, ticker, q);
      });
    }
    return map;
  } catch (err) {
    logger.error(`[Yahoo] getQuotes failed: ${err.message}`);
    throw err;
  }
}

/**
 * Historical OHLCV data.
 * @param {string} symbol
 * @param {string} exchange
 * @param {string} period1  - start date "YYYY-MM-DD" or "6mo", "1y" etc.
 * @param {string} period2  - end date or "now"
 * @param {string} interval - "1d" | "1wk" | "1mo"
 */
async function getHistory(symbol, exchange = 'NSE', period1 = '6mo', period2 = 'now', interval = '1d') {
  const ticker = toYahooTicker(symbol, exchange);
  try {
    const periodLike = /^[0-9]+[dwmy]$/i.test(period1);
    const params = { interval };
    if (periodLike) {
      params.range = period1;
    } else {
      const p1 = Math.floor(new Date(period1).getTime() / 1000);
      const p2 = period2 === 'now' ? Math.floor(Date.now() / 1000) : Math.floor(new Date(period2).getTime() / 1000);
      params.period1 = p1;
      params.period2 = p2;
    }

    const data = await yahooGet(`/v8/finance/chart/${encodeURIComponent(ticker)}`, params);
    const result = data?.chart?.result?.[0];
    const ts = result?.timestamp || [];
    const q = result?.indicators?.quote?.[0] || {};
    const ac = result?.indicators?.adjclose?.[0]?.adjclose || [];
    return ts.map((t, i) => ({
      date: new Date(t * 1000),
      open: q.open?.[i],
      high: q.high?.[i],
      low: q.low?.[i],
      close: q.close?.[i],
      volume: q.volume?.[i],
      adjClose: ac[i],
    })).filter((row) => row.close != null);
  } catch (err) {
    logger.error(`[Yahoo] getHistory failed for ${ticker}: ${err.message}`);
    throw err;
  }
}

/**
 * Fetch key market indices snapshot.
 * Returns Nifty50, Sensex, Dow Jones, NASDAQ, S&P500, Gold, Crude, USD/INR
 */
async function getMarketIndices() {
  const indices = [
    { key: 'nifty50',   ticker: '^NSEI',   name: 'Nifty 50' },
    { key: 'sensex',    ticker: '^BSESN',  name: 'Sensex' },
    { key: 'niftyBank', ticker: '^NSEBANK',name: 'Nifty Bank' },
    { key: 'niftyMid',  ticker: '^CNXMIDCAP', name: 'Nifty Midcap 100' },
    { key: 'dowJones',  ticker: '^DJI',    name: 'Dow Jones' },
    { key: 'nasdaq',    ticker: '^IXIC',   name: 'NASDAQ' },
    { key: 'sp500',     ticker: '^GSPC',   name: 'S&P 500' },
    { key: 'vix',       ticker: '^NIFVIX', name: 'India VIX' },
    { key: 'usdInr',    ticker: 'USDINR=X',name: 'USD/INR' },
    { key: 'goldMcx',   ticker: 'GC=F',    name: 'Gold Futures' },
    { key: 'crudeMcx',  ticker: 'CL=F',    name: 'Crude Oil' },
  ];

  const tickers = indices.map(i => i.ticker);
  const snapshot = {};

  try {
    const arr = await fetchQuotesNoCrumb(tickers);
    const byTicker = new Map(arr.map((q) => [q.symbol, q]));

    indices.forEach((idx, i) => {
      const q = byTicker.get(idx.ticker) || arr[i] || {};
      snapshot[idx.key] = {
        name:          idx.name,
        ticker:        idx.ticker,
        price:         q.regularMarketPrice,
        change:        q.regularMarketChange,
        changePercent: q.regularMarketChangePercent,
        prevClose:     q.regularMarketPreviousClose,
      };
    });

    snapshot.fetchedAt = new Date().toISOString();
    return snapshot;
  } catch (err) {
    logger.warn(`[Yahoo] no-crumb getMarketIndices failed, falling back: ${err.message}`);
  }

  const yf = await getYF();
  if (!yf || typeof yf.quote !== 'function') throw new Error('yahoo-finance2 quote not available');
  try {
    const quotes = await yf.quote(tickers);
    const arr = Array.isArray(quotes) ? quotes : [quotes];
    indices.forEach((idx, i) => {
      const q = arr[i] || {};
      snapshot[idx.key] = {
        name:          idx.name,
        ticker:        idx.ticker,
        price:         q.regularMarketPrice,
        change:        q.regularMarketChange,
        changePercent: q.regularMarketChangePercent,
        prevClose:     q.regularMarketPreviousClose,
      };
    });
    snapshot.fetchedAt = new Date().toISOString();
    return snapshot;
  } catch (err) {
    logger.error(`[Yahoo] getMarketIndices failed: ${err.message}`);
    return snapshot;
  }
}

/**
 * Search for a stock symbol by company name.
 */
async function searchSymbol(query) {
  try {
    const data = await yahooGet('/v1/finance/search', {
      q: query,
      quotesCount: 10,
      newsCount: 0,
    });
    return (data?.quotes || []).slice(0, 10).map(r => ({
      symbol:   r.symbol,
      name:     r.shortname || r.longname || r.symbol,
      exchange: r.exchange,
      type:     r.quoteType,
    }));
  } catch (err) {
    logger.error(`[Yahoo] searchSymbol failed: ${err.message}`);
    return [];
  }
}

module.exports = { getQuote, getQuotes, getHistory, getMarketIndices, searchSymbol, toYahooTicker };
