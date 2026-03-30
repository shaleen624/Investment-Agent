'use strict';

/**
 * Alpha Vantage market data source.
 * Free tier: 25 API calls/day.
 * Used as supplementary data for fundamentals and global price checks.
 */

const axios  = require('axios');
const logger = require('../../config/logger');
const { config } = require('../../config');

const BASE = 'https://www.alphavantage.co/query';

async function avGet(params) {
  const apiKey = config.market.alphaVantage.apiKey;
  if (!apiKey) throw new Error('ALPHA_VANTAGE_API_KEY not configured');

  try {
    const res = await axios.get(BASE, {
      params: { ...params, apikey: apiKey },
      timeout: 15000,
    });

    if (res.data?.Note) {
      // Rate limit hit
      throw new Error('Alpha Vantage rate limit reached (25 calls/day)');
    }
    if (res.data?.Information) {
      throw new Error(`Alpha Vantage: ${res.data.Information}`);
    }
    return res.data;
  } catch (err) {
    logger.error(`[AlphaVantage] Request failed: ${err.message}`);
    throw err;
  }
}

/**
 * Current global quote for a symbol.
 * For Indian stocks use BSE/NSE symbol (e.g. "BSE:RELIANCE" or just "RELIANCE.BSE")
 */
async function getGlobalQuote(symbol) {
  const data = await avGet({ function: 'GLOBAL_QUOTE', symbol });
  const q = data['Global Quote'] || {};
  return {
    symbol:        q['01. symbol'],
    price:         parseFloat(q['05. price']),
    change:        parseFloat(q['09. change']),
    changePercent: parseFloat(q['10. change percent']),
    open:          parseFloat(q['02. open']),
    high:          parseFloat(q['03. high']),
    low:           parseFloat(q['04. low']),
    prevClose:     parseFloat(q['08. previous close']),
    volume:        parseInt(q['06. volume'], 10),
    latestDay:     q['07. latest trading day'],
    fetchedAt:     new Date().toISOString(),
  };
}

/**
 * Company overview / fundamentals.
 * PE, EPS, dividend yield, sector, industry etc.
 */
async function getOverview(symbol) {
  const data = await avGet({ function: 'OVERVIEW', symbol });
  return {
    symbol:          data.Symbol,
    name:            data.Name,
    sector:          data.Sector,
    industry:        data.Industry,
    description:     data.Description,
    marketCap:       parseFloat(data.MarketCapitalization),
    pe:              parseFloat(data.PERatio),
    forwardPe:       parseFloat(data.ForwardPE),
    eps:             parseFloat(data.EPS),
    dividendYield:   parseFloat(data.DividendYield),
    roe:             parseFloat(data.ReturnOnEquityTTM),
    debtToEquity:    parseFloat(data.DebtToEquityRatio || '0'),
    week52High:      parseFloat(data['52WeekHigh']),
    week52Low:       parseFloat(data['52WeekLow']),
    analystTarget:   parseFloat(data.AnalystTargetPrice),
    fetchedAt:       new Date().toISOString(),
  };
}

/**
 * Top gainers and losers (US market).
 * Returns arrays: top_gainers, top_losers, most_actively_traded
 */
async function getTopMovers() {
  const data = await avGet({ function: 'TOP_GAINERS_LOSERS' });
  return {
    topGainers:       (data.top_gainers || []).slice(0, 5),
    topLosers:        (data.top_losers  || []).slice(0, 5),
    mostActive:       (data.most_actively_traded || []).slice(0, 5),
    lastUpdated:      data.last_updated,
  };
}

module.exports = { getGlobalQuote, getOverview, getTopMovers };
