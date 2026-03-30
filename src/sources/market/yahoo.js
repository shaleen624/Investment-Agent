'use strict';

/**
 * Yahoo Finance market data source.
 * Uses the yahoo-finance2 npm package — no API key needed for basic use.
 *
 * Covers: NSE/BSE equities, US stocks, ETFs, indices
 */

const logger = require('../../config/logger');

let yf = null;
let _yfReady = false;

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

/**
 * Fetch current quote for a single symbol.
 * @param {string} symbol  - e.g. "RELIANCE", "TCS", "AAPL"
 * @param {string} exchange - "NSE" | "BSE" | "NYSE" | "NASDAQ" | ""
 */
async function getQuote(symbol, exchange = 'NSE') {
  const yf = await getYF();
  if (!yf) throw new Error('yahoo-finance2 not available');

  const ticker = toYahooTicker(symbol, exchange);
  try {
    const q = await yf.quote(ticker);
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
  const yf = await getYF();
  if (!yf) throw new Error('yahoo-finance2 not available');

  const tickers = symbols.map(s => toYahooTicker(s, exchange));
  try {
    const results = await yf.quote(tickers);
    const arr = Array.isArray(results) ? results : [results];
    const map = {};
    arr.forEach((q, i) => {
      const sym = symbols[i] || q.symbol;
      map[sym] = {
        symbol:        sym,
        ticker:        tickers[i],
        exchange,
        name:          q.shortName || q.longName || sym,
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
        fetchedAt:     new Date().toISOString(),
      };
    });
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
  const yf = await getYF();
  if (!yf) throw new Error('yahoo-finance2 not available');

  const ticker = toYahooTicker(symbol, exchange);
  try {
    const data = await yf.historical(ticker, { period1, period2, interval });
    return data.map(d => ({
      date:   d.date,
      open:   d.open,
      high:   d.high,
      low:    d.low,
      close:  d.close,
      volume: d.volume,
      adjClose: d.adjClose,
    }));
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
  const yf = await getYF();
  if (!yf) throw new Error('yahoo-finance2 not available');

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
    const quotes = await yf.quote(tickers);  // yf is from getYF() above
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
    // Return partial data if some failed
    return snapshot;
  }
}

/**
 * Search for a stock symbol by company name.
 */
async function searchSymbol(query) {
  const yf = await getYF();
  if (!yf) throw new Error('yahoo-finance2 not available');
  try {
    const results = await yf.search(query);
    return (results.quotes || []).slice(0, 10).map(r => ({
      symbol:   r.symbol,
      name:     r.shortname || r.longname,
      exchange: r.exchange,
      type:     r.quoteType,
    }));
  } catch (err) {
    logger.error(`[Yahoo] searchSymbol failed: ${err.message}`);
    return [];
  }
}

module.exports = { getQuote, getQuotes, getHistory, getMarketIndices, searchSymbol, toYahooTicker };
