'use strict';

/**
 * Portfolio parser — handles PDF (CDSL/NSDL CAS, Groww, Kite P&L statements),
 * CSV exports, and structured plain text input.
 *
 * Parsed output is a normalized array of holding objects ready for the portfolio manager.
 */

const fs     = require('fs');
const path   = require('path');
const logger = require('../config/logger');
const { casParserBroker } = require('../sources/brokers/casparser');

let pdfParse, Papa;
try { pdfParse = require('pdf-parse'); } catch { logger.warn('[Parser] pdf-parse not installed'); }
try { Papa     = require('papaparse'); } catch { logger.warn('[Parser] papaparse not installed'); }

// ── Normalized holding schema ─────────────────────────────────────────────────
//
// {
//   asset_type:    'equity'|'mutual_fund'|'etf'|'fd'|'bond'|'nps'|'crypto'|'other'
//   symbol:        'RELIANCE' | 'INF109K01VQ1' (ISIN for MF)
//   name:          'Reliance Industries Ltd'
//   exchange:      'NSE' | 'BSE'
//   quantity:      100
//   avg_buy_price: 2400.50
//   invested_amount: 240050
//   folio_number:  '12345678/01'  (MFs)
//   units:         1250.345        (MFs)
//   nav:           48.23           (MFs, latest)
//   broker:        'kite'|'groww'|'manual'
// }

// ── CSV Parser ────────────────────────────────────────────────────────────────

/**
 * Parse a CSV file exported from Zerodha Kite (Holdings export).
 */
function parseKiteCSV(text) {
  if (!Papa) throw new Error('papaparse not installed');
  const { data } = Papa.parse(text, { header: true, skipEmptyLines: true });
  return data.map(row => ({
    asset_type:     'equity',
    symbol:         row['Tradingsymbol']?.trim() || row['Symbol']?.trim(),
    name:           row['Instrument']?.trim()    || row['Tradingsymbol']?.trim(),
    exchange:       row['Exchange']?.trim()      || 'NSE',
    quantity:       parseFloat(row['Quantity'])  || 0,
    avg_buy_price:  parseFloat(row['Average price'] || row['Avg. price'] || '0') || 0,
    invested_amount:parseFloat(row['P&L'])       || 0,
    broker:         'kite',
  })).filter(h => h.symbol && h.quantity > 0);
}

/**
 * Parse a CSV from Groww (Portfolio export).
 */
function parseGrowwCSV(text) {
  if (!Papa) throw new Error('papaparse not installed');
  const { data } = Papa.parse(text, { header: true, skipEmptyLines: true });
  return data.map(row => {
    const assetType = (row['Type'] || row['Asset Type'] || '').toLowerCase().includes('mutual')
      ? 'mutual_fund'
      : 'equity';

    return {
      asset_type:     assetType,
      symbol:         row['Symbol'] || row['ISIN'] || row['Scheme Code'],
      name:           row['Company Name'] || row['Scheme Name'] || row['Name'],
      exchange:       row['Exchange'] || 'NSE',
      quantity:       parseFloat(row['Shares'] || row['Units'] || '0') || 0,
      avg_buy_price:  parseFloat(row['Avg. Buy Price'] || row['Buy NAV'] || '0') || 0,
      invested_amount:parseFloat(row['Total Investment'] || row['Invested Amount'] || '0') || 0,
      units:          parseFloat(row['Units'] || '0') || null,
      folio_number:   row['Folio No'] || null,
      broker:         'groww',
    };
  }).filter(h => h.name && h.quantity > 0);
}

/**
 * Generic CSV parser — tries to detect format by column headers.
 */
function parseGenericCSV(text) {
  if (!Papa) throw new Error('papaparse not installed');
  const { data, meta } = Papa.parse(text, { header: true, skipEmptyLines: true });
  if (!data.length) return [];

  const headers = (meta.fields || []).map(h => h.toLowerCase());
  const col = name => meta.fields?.find(h => h.toLowerCase().includes(name)) || null;

  const symbolCol   = col('symbol') || col('ticker') || col('scrip') || col('isin');
  const nameCol     = col('name') || col('company') || col('instrument') || col('scheme');
  const qtyCol      = col('quantity') || col('units') || col('shares') || col('qty');
  const priceCol    = col('price') || col('avg') || col('nav') || col('cost');
  const amtCol      = col('amount') || col('investment') || col('invested') || col('value');
  const exchangeCol = col('exchange');
  const typeCol     = col('type') || col('asset');

  return data.map(row => {
    const rawType = typeCol ? (row[typeCol] || '').toLowerCase() : '';
    let asset_type = 'equity';
    if (rawType.includes('mutual') || rawType.includes('mf') || rawType.includes('fund')) asset_type = 'mutual_fund';
    else if (rawType.includes('etf'))    asset_type = 'etf';
    else if (rawType.includes('bond'))   asset_type = 'bond';
    else if (rawType.includes('crypto')) asset_type = 'crypto';
    else if (rawType.includes('fd') || rawType.includes('deposit')) asset_type = 'fd';

    return {
      asset_type,
      symbol:          symbolCol ? row[symbolCol]?.trim()       : null,
      name:            nameCol   ? row[nameCol]?.trim()         : (symbolCol ? row[symbolCol]?.trim() : 'Unknown'),
      exchange:        exchangeCol ? row[exchangeCol]?.trim()   : 'NSE',
      quantity:        qtyCol  ? parseFloat(row[qtyCol])   || 0 : 0,
      avg_buy_price:   priceCol? parseFloat(row[priceCol]) || 0 : 0,
      invested_amount: amtCol  ? parseFloat(row[amtCol])  || 0 : 0,
      broker:          'manual',
    };
  }).filter(h => h.name && h.quantity > 0);
}

// ── PDF Parser ────────────────────────────────────────────────────────────────

/**
 * Extract text from a PDF and attempt to parse portfolio data.
 * Uses optional API parser first when configured, then robust local fallback.
 */
async function parsePDF(filePath) {
  if (!pdfParse) throw new Error('pdf-parse not installed');

  if (casParserBroker.isConfigured()) {
    try {
      const apiHoldings = await casParserBroker.parseCasPdf(filePath);
      if (apiHoldings.length) {
        logger.info(`[Parser] CAS API parse success (${apiHoldings.length} holdings)`);
        return apiHoldings;
      }
    } catch (err) {
      logger.warn(`[Parser] CAS API parse failed, falling back to local parser: ${err.message}`);
    }
  }

  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  const text = data.text || '';

  const upper = text.toUpperCase();
  if (
    upper.includes('CONSOLIDATED ACCOUNT STATEMENT') ||
    upper.includes('CAS ID') ||
    upper.includes('CDSL') ||
    upper.includes('NSDL')
  ) {
    const casHoldings = parseCASStatement(text);
    if (casHoldings.length) return casHoldings;
  }
  if (upper.includes('ZERODHA') || upper.includes('KITE')) {
    return parsePDFGeneric(text, 'kite');
  }
  if (upper.includes('GROWW')) {
    return parsePDFGeneric(text, 'groww');
  }

  return parsePDFGeneric(text, 'manual');
}

function toNumber(raw) {
  if (raw == null || raw === '') return 0;
  const cleaned = String(raw).replace(/[^\d.-]/g, '');
  const val = parseFloat(cleaned);
  return Number.isFinite(val) ? val : 0;
}

function normalizeCasLines(text) {
  return text
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Parse local CAS text from CDSL/NSDL statements.
 * Handles common ISIN-driven equity lines and MF folio blocks.
 */
function parseCASStatement(text) {
  const lines = normalizeCasLines(text);
  const holdings = [];

  const pushEquity = (isin, name, qtyRaw, priceRaw, amountRaw, broker = 'manual') => {
    const quantity = toNumber(qtyRaw);
    const price = toNumber(priceRaw);
    const amount = toNumber(amountRaw) || (quantity > 0 && price > 0 ? quantity * price : 0);
    if (!isin || !name || quantity <= 0) return;

    holdings.push({
      asset_type: 'equity',
      symbol: isin,
      isin,
      name: name.trim(),
      exchange: 'NSE',
      quantity,
      avg_buy_price: price || 0,
      invested_amount: amount,
      broker,
    });
  };

  for (const line of lines) {
    const rich = line.match(/^([A-Z]{2}[A-Z0-9]{10})\s+(.+?)\s+(\d{1,3}(?:,\d{2,3})*(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)$/);
    if (rich) {
      pushEquity(rich[1], rich[2], rich[3], rich[4], rich[5]);
      continue;
    }

    const mid = line.match(/^([A-Z]{2}[A-Z0-9]{10})\s+(.+?)\s+(\d{1,3}(?:,\d{2,3})*(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)$/);
    if (mid) {
      pushEquity(mid[1], mid[2], mid[3], mid[4], null);
      continue;
    }

    const loose = line.match(/([A-Z]{2}[A-Z0-9]{10})\s+(.+?)\s+Qty\s*:?\s*([\d,.]+).*?(?:Rate|Price|NAV)?\s*:?\s*([\d,.]+)?/i);
    if (loose) {
      pushEquity(loose[1], loose[2], loose[3], loose[4], null);
    }
  }

  let currentFolio = null;
  for (const line of lines) {
    const folio = line.match(/folio\s*(?:no\.?|number)?\s*[:#-]?\s*([A-Z0-9\/.-]+)/i);
    if (folio) currentFolio = folio[1];

    const mfLine = line.match(/^(.+?)\s+(?:units?|balance)\s*[:\-]?\s*([\d,.]+).*?(?:nav|rate)\s*[:\-]?\s*([\d,.]+)(?:.*?(?:value|amount)\s*[:\-]?\s*([\d,.]+))?/i);
    if (!mfLine) continue;

    const name = mfLine[1].trim();
    const units = toNumber(mfLine[2]);
    const nav = toNumber(mfLine[3]);
    const amount = toNumber(mfLine[4]) || (units > 0 && nav > 0 ? units * nav : 0);

    if (!name || units <= 0) continue;

    holdings.push({
      asset_type: 'mutual_fund',
      symbol: null,
      name,
      exchange: '',
      quantity: units,
      units,
      nav: nav || null,
      avg_buy_price: nav || 0,
      invested_amount: amount,
      folio_number: currentFolio,
      broker: 'manual',
    });
  }

  const dedup = new Map();
  for (const h of holdings) {
    const key = `${h.asset_type}|${h.symbol || ''}|${h.name}|${h.folio_number || ''}|${h.quantity}`;
    if (!dedup.has(key)) dedup.set(key, h);
  }

  return [...dedup.values()];
}

/**
 * Generic PDF text parser — extracts tabular data using heuristics.
 */
function parsePDFGeneric(text, broker = 'manual') {
  const holdings = [];
  const lines    = text.split('\n').map(l => l.trim()).filter(l => l.length > 5);

  // Look for lines with a ticker-like pattern followed by numbers
  // Pattern: SYMBOLNAME  qty  price  amount
  const lineRe = /^([A-Z][A-Z0-9&\-]{1,20})\s+.*?(\d[\d,]*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)$/;

  for (const line of lines) {
    const m = line.match(lineRe);
    if (!m) continue;
    const qty    = parseInt(m[2].replace(/,/g, ''), 10);
    const price  = parseFloat(m[3].replace(/,/g, ''));
    const amount = parseFloat(m[4].replace(/,/g, ''));
    if (qty > 0 && price > 0 && price < 1000000) {
      holdings.push({
        asset_type:     'equity',
        symbol:         m[1],
        name:           m[1],
        exchange:       'NSE',
        quantity:       qty,
        avg_buy_price:  price,
        invested_amount:amount || qty * price,
        broker,
      });
    }
  }

  return holdings;
}

// ── Text Parser ───────────────────────────────────────────────────────────────

/**
 * Parse plain text portfolio input.
 * Accepts formats like:
 *   RELIANCE 100 @ 2400.50
 *   TCS: 50 shares, avg 3200
 *   HDFC MF - 1250.345 units, NAV 48.23, folio 123456
 */
function parseText(text) {
  const holdings = [];
  const lines    = text.split('\n').map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    if (line.startsWith('#') || line.startsWith('//')) continue; // comments

    // Pattern: SYMBOL qty @ price
    const p1 = line.match(/^([A-Z][A-Z0-9&\-]{1,20})\s+(\d+[\d.]*)\s*(?:@|at|shares?|units?)\s*([\d.]+)/i);
    if (p1) {
      const qty   = parseFloat(p1[2]);
      const price = parseFloat(p1[3]);
      holdings.push({
        asset_type:     'equity',
        symbol:         p1[1].toUpperCase(),
        name:           p1[1].toUpperCase(),
        exchange:       'NSE',
        quantity:       qty,
        avg_buy_price:  price,
        invested_amount:qty * price,
        broker:         'manual',
      });
      continue;
    }

    // Pattern: NAME - units, NAV, folio (mutual fund)
    const p2 = line.match(/(.+?)\s*[-:]\s*([\d.]+)\s*units?.*?(?:nav|price)\s*([\d.]+)/i);
    if (p2) {
      const units = parseFloat(p2[2]);
      const nav   = parseFloat(p2[3]);
      const folioM = line.match(/folio\s*[:#]?\s*(\S+)/i);
      holdings.push({
        asset_type:     'mutual_fund',
        symbol:         null,
        name:           p2[1].trim(),
        exchange:       '',
        quantity:       units,
        avg_buy_price:  nav,
        invested_amount:units * nav,
        units,
        nav,
        folio_number:   folioM ? folioM[1] : null,
        broker:         'manual',
      });
      continue;
    }
  }

  return holdings;
}

// ── Main Entry ────────────────────────────────────────────────────────────────

/**
 * Detect file type and parse accordingly.
 * @param {string} filePath - path to PDF or CSV file
 * @returns {Promise<Array>} normalized holdings
 */
async function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const content = ext !== '.pdf' ? fs.readFileSync(filePath, 'utf8') : null;

  if (ext === '.pdf') {
    return parsePDF(filePath);
  }

  if (ext === '.csv') {
    // Detect format from header
    if (content.includes('Tradingsymbol') || content.includes('Average price')) return parseKiteCSV(content);
    if (content.includes('Scheme Name')   || content.includes('Folio No'))      return parseGrowwCSV(content);
    return parseGenericCSV(content);
  }

  if (ext === '.txt' || ext === '.text' || ext === '') {
    return parseText(content);
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

module.exports = {
  parseFile,
  parseText,
  parseKiteCSV,
  parseGrowwCSV,
  parseGenericCSV,
  parsePDF,
  parseCASStatement,
};
