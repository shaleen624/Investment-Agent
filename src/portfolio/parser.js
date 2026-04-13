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

function parseNumeric(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const text = String(value).trim();
  if (!text) return 0;

  const negative = /^\(.*\)$/.test(text);
  const cleaned = text
    .replace(/\((.*)\)/, '$1')
    .replace(/[₹,\s]/g, '')
    .replace(/--+/g, '');

  const parsed = parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return 0;
  return negative ? -parsed : parsed;
}

function normalizeRowKeys(row = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    const cleanKey = key.replace(/\uFEFF/g, '').trim();
    normalized[cleanKey] = value;
  }
  return normalized;
}

function validateHolding(holding, rowIndex, source) {
  const errors = [];

  if (!holding.name && !holding.symbol) {
    errors.push('missing symbol/name');
  }
  if (!(holding.quantity > 0)) {
    errors.push('quantity must be > 0');
  }
  if (holding.avg_buy_price < 0) {
    errors.push('avg_buy_price cannot be negative');
  }
  if (holding.invested_amount < 0) {
    errors.push('invested_amount cannot be negative');
  }

  return {
    ok: errors.length === 0,
    errors,
    rowIndex,
    source,
  };
}

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

  const valid = [];
  const warnings = [];

  data.forEach((rawRow, index) => {
    const row = normalizeRowKeys(rawRow);
    const quantity = parseNumeric(row['Quantity']);
    const avgBuyPrice = parseNumeric(row['Average price'] || row['Avg. price']);
    const investedAmount = quantity * avgBuyPrice;

    const holding = {
      asset_type: 'equity',
      symbol: row['Tradingsymbol']?.trim() || row['Symbol']?.trim() || null,
      name: row['Instrument']?.trim() || row['Tradingsymbol']?.trim() || row['Symbol']?.trim() || null,
      exchange: row['Exchange']?.trim() || 'NSE',
      quantity,
      avg_buy_price: avgBuyPrice,
      invested_amount: investedAmount,
      broker: 'kite',
    };

    const check = validateHolding(holding, index + 2, 'kite-csv');
    if (check.ok) valid.push(holding);
    else warnings.push(`Row ${check.rowIndex}: ${check.errors.join(', ')}`);
  });

  if (warnings.length) {
    logger.warn(`[Parser] Kite CSV skipped ${warnings.length} invalid row(s): ${warnings.slice(0, 5).join(' | ')}${warnings.length > 5 ? ' | ...' : ''}`);
  }

  return valid;
}

/**
 * Parse a CSV from Groww (Portfolio export).
 */
function parseGrowwCSV(text) {
  if (!Papa) throw new Error('papaparse not installed');
  const { data } = Papa.parse(text, { header: true, skipEmptyLines: true });

  const valid = [];
  const warnings = [];

  data.forEach((rawRow, index) => {
    const row = normalizeRowKeys(rawRow);
    const typeText = (row['Type'] || row['Asset Type'] || '').toLowerCase();
    const assetType = typeText.includes('mutual') ? 'mutual_fund' : 'equity';

    const quantity = parseNumeric(row['Shares'] || row['Units']);
    const avgBuyPrice = parseNumeric(row['Avg. Buy Price'] || row['Buy NAV']);
    const investedFromFile = parseNumeric(row['Total Investment'] || row['Invested Amount']);
    const investedAmount = investedFromFile > 0 ? investedFromFile : quantity * avgBuyPrice;

    const holding = {
      asset_type: assetType,
      symbol: (row['Symbol'] || row['ISIN'] || row['Scheme Code'] || '').trim() || null,
      name: (row['Company Name'] || row['Scheme Name'] || row['Name'] || '').trim() || null,
      exchange: (row['Exchange'] || '').trim() || (assetType === 'mutual_fund' ? '' : 'NSE'),
      quantity,
      avg_buy_price: avgBuyPrice,
      invested_amount: investedAmount,
      units: assetType === 'mutual_fund' ? quantity : null,
      folio_number: (row['Folio No'] || row['Folio Number'] || '').trim() || null,
      broker: 'groww',
    };

    const check = validateHolding(holding, index + 2, 'groww-csv');
    if (check.ok) valid.push(holding);
    else warnings.push(`Row ${check.rowIndex}: ${check.errors.join(', ')}`);
  });

  if (warnings.length) {
    logger.warn(`[Parser] Groww CSV skipped ${warnings.length} invalid row(s): ${warnings.slice(0, 5).join(' | ')}${warnings.length > 5 ? ' | ...' : ''}`);
  }

  return valid;
}

/**
 * Generic CSV parser — tries to detect format by column headers.
 */
function parseGenericCSV(text) {
  if (!Papa) throw new Error('papaparse not installed');
  const { data, meta } = Papa.parse(text, { header: true, skipEmptyLines: true });
  if (!data.length) return [];

  const fields = (meta.fields || []).map(f => f.replace(/\uFEFF/g, '').trim());
  const col = name => fields.find(h => h.toLowerCase().includes(name)) || null;

  const symbolCol   = col('symbol') || col('ticker') || col('scrip') || col('isin');
  const nameCol     = col('name') || col('company') || col('instrument') || col('scheme');
  const qtyCol      = col('quantity') || col('units') || col('shares') || col('qty');
  const priceCol    = col('price') || col('avg') || col('nav') || col('cost');
  const amtCol      = col('amount') || col('investment') || col('invested') || col('value');
  const exchangeCol = col('exchange');
  const typeCol     = col('type') || col('asset');
  const folioCol    = col('folio');

  if (!qtyCol || (!symbolCol && !nameCol)) {
    throw new Error('CSV missing required columns. Expected at least quantity and symbol/name columns.');
  }

  const valid = [];
  const warnings = [];

  data.forEach((rawRow, index) => {
    const row = normalizeRowKeys(rawRow);
    const rawType = typeCol ? (row[typeCol] || '').toLowerCase() : '';
    let asset_type = 'equity';
    if (rawType.includes('mutual') || rawType.includes('mf') || rawType.includes('fund')) asset_type = 'mutual_fund';
    else if (rawType.includes('etf')) asset_type = 'etf';
    else if (rawType.includes('bond')) asset_type = 'bond';
    else if (rawType.includes('crypto')) asset_type = 'crypto';
    else if (rawType.includes('fd') || rawType.includes('deposit')) asset_type = 'fd';

    const quantity = parseNumeric(qtyCol ? row[qtyCol] : 0);
    const avgBuyPrice = parseNumeric(priceCol ? row[priceCol] : 0);
    const amountFromCsv = parseNumeric(amtCol ? row[amtCol] : 0);
    const investedAmount = amountFromCsv > 0 ? amountFromCsv : quantity * avgBuyPrice;

    const holding = {
      asset_type,
      symbol: symbolCol ? String(row[symbolCol] || '').trim() || null : null,
      name: nameCol
        ? String(row[nameCol] || '').trim() || (symbolCol ? String(row[symbolCol] || '').trim() : null)
        : (symbolCol ? String(row[symbolCol] || '').trim() : null),
      exchange: exchangeCol ? String(row[exchangeCol] || '').trim() || 'NSE' : (asset_type === 'mutual_fund' ? '' : 'NSE'),
      quantity,
      avg_buy_price: avgBuyPrice,
      invested_amount: investedAmount,
      folio_number: folioCol ? String(row[folioCol] || '').trim() || null : null,
      units: asset_type === 'mutual_fund' ? quantity : null,
      broker: 'manual',
    };

    const check = validateHolding(holding, index + 2, 'generic-csv');
    if (check.ok) valid.push(holding);
    else warnings.push(`Row ${check.rowIndex}: ${check.errors.join(', ')}`);
  });

  if (warnings.length) {
    logger.warn(`[Parser] Generic CSV skipped ${warnings.length} invalid row(s): ${warnings.slice(0, 5).join(' | ')}${warnings.length > 5 ? ' | ...' : ''}`);
  }

  return valid;
}

// ── PDF Parser ────────────────────────────────────────────────────────────────

/**
 * Extract text from a PDF and attempt to parse portfolio data.
 * Supports CDSL CAS (Consolidated Account Statement) format.
 */
async function parsePDF(filePath) {
  if (!pdfParse) throw new Error('pdf-parse not installed');

  const buffer = fs.readFileSync(filePath);
  const data   = await pdfParse(buffer);
  const text   = data.text;

  // Try to detect format
  if (text.includes('Consolidated Account Statement') || text.includes('CDSL')) {
    return parseCDSLCAS(text);
  }
  if (text.includes('Zerodha') || text.includes('Kite')) {
    return parsePDFGeneric(text, 'kite');
  }
  if (text.includes('Groww')) {
    return parsePDFGeneric(text, 'groww');
  }

  // Generic extraction
  return parsePDFGeneric(text, 'manual');
}

/**
 * Parse CDSL Consolidated Account Statement text.
 * Extracts equity holdings and mutual fund folios.
 */
function parseCDSLCAS(text) {
  const holdings = [];
  const lines    = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Equity pattern: ISIN, Company Name, Quantity, Rate
  const equityRe = /([A-Z]{2}[A-Z0-9]{10})\s+(.+?)\s+(\d+[\d,]*)\s+([\d.]+)/;
  // MF pattern: Scheme name with folio and units
  const mfRe     = /Folio[:\s]+(\S+).*?Units[:\s]+([\d.]+).*?NAV[:\s]+([\d.]+)/is;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(equityRe);
    if (m) {
      const qty  = parseInt(m[3].replace(/,/g, ''), 10);
      const price= parseFloat(m[4]);
      if (qty > 0 && price > 0) {
        holdings.push({
          asset_type:     m[1].startsWith('IN') ? 'equity' : 'other',
          symbol:         m[1],  // ISIN
          name:           m[2].trim(),
          exchange:       'NSE',
          quantity:       qty,
          avg_buy_price:  price,
          invested_amount:qty * price,
          broker:         'manual',
        });
      }
    }
  }

  return holdings;
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
    const normalized = (content || '').replace(/^\uFEFF/, '');
    if (!normalized.trim()) {
      throw new Error('CSV file is empty.');
    }

    if (normalized.includes('Tradingsymbol') || normalized.includes('Average price')) return parseKiteCSV(normalized);
    if (normalized.includes('Scheme Name') || normalized.includes('Folio No') || normalized.includes('Avg. Buy Price')) return parseGrowwCSV(normalized);

    return parseGenericCSV(normalized);
  }

  if (ext === '.txt' || ext === '.text' || ext === '') {
    return parseText(content);
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

module.exports = { parseFile, parseText, parseKiteCSV, parseGrowwCSV, parseGenericCSV, parsePDF };
