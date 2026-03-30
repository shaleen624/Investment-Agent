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

let pdfParse, Papa, XLSX;
try { pdfParse = require('pdf-parse'); } catch { logger.warn('[Parser] pdf-parse not installed'); }
try { Papa     = require('papaparse'); } catch { logger.warn('[Parser] papaparse not installed'); }
try { XLSX     = require('xlsx'); } catch { logger.warn('[Parser] xlsx not installed'); }

function toNumber(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const cleaned = String(v).replace(/[₹,\s]/g, '').replace(/[^\d.-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function pick(obj, keys = []) {
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== '') return obj[k];
  }
  return null;
}

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

// ── Excel Parser ──────────────────────────────────────────────────────────────

/**
 * Parse an Excel file (.xlsx) - converts to CSV-like format and uses generic parser.
 */
function parseExcel(filePath) {
  if (!XLSX) throw new Error('xlsx not installed');

  const workbook = XLSX.readFile(filePath);
  let bestRows = [];

  // Some broker exports include metadata rows before actual headers.
  // Parse all sheets and select the first table-like one with a detectable header row.
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });
    if (!rows.length) continue;

    let headerIndex = -1;
    for (let i = 0; i < Math.min(rows.length, 60); i++) {
      const row = rows[i] || [];
      const normalized = row
        .map((c) => String(c || '').trim().toLowerCase())
        .filter(Boolean);
      if (!normalized.length) continue;

      const hasNameLike = normalized.some((c) =>
        c.includes('name') || c.includes('company') || c.includes('stock') ||
        c.includes('symbol') || c.includes('ticker') || c.includes('isin')
      );
      const hasQtyLike = normalized.some((c) =>
        c.includes('quantity') || c.includes('qty') || c.includes('units') || c.includes('shares')
      );
      const hasPriceLike = normalized.some((c) =>
        c.includes('price') || c.includes('avg') || c.includes('nav') || c.includes('cost') ||
        c.includes('invested') || c.includes('value') || c.includes('returns') || c.includes('p&l')
      );

      if (hasNameLike && hasQtyLike && hasPriceLike) {
        headerIndex = i;
        break;
      }
    }

    if (headerIndex === -1) continue;

    const headers = (rows[headerIndex] || []).map((h) => String(h || '').trim());
    const dataRows = rows.slice(headerIndex + 1).filter((r) =>
      Array.isArray(r) && r.some((c) => String(c || '').trim() !== '')
    );
    if (!dataRows.length) continue;

    const data = dataRows.map((row) => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index]?.toString() || '';
      });
      return obj;
    });

    if (data.length > bestRows.length) {
      bestRows = data;
      const mockPapaResult = {
        data,
        meta: { fields: headers },
      };
      const parsed = parseGenericCSVFromData(mockPapaResult);
      if (parsed.length) return parsed;
    }
  }

  if (!bestRows.length) {
    throw new Error('Could not detect holdings table in spreadsheet');
  }

  throw new Error('Spreadsheet parsed, but no valid holdings rows were found');
}

/**
 * Modified generic CSV parser that works with pre-parsed data.
 */
function parseGenericCSVFromData({ data, meta }) {
  if (!data.length) return [];

  const col = name => meta.fields?.find(h => h.toLowerCase().includes(name)) || null;

  const symbolCol   = col('symbol') || col('ticker') || col('scrip') || col('isin');
  const nameCol     = col('name') || col('company') || col('instrument') || col('scheme');
  const qtyCol      = col('quantity') || col('units') || col('shares') || col('qty');
  const priceCol    = col('price') || col('avg') || col('nav') || col('cost');
  const amtCol      = col('amount') || col('investment') || col('invested') || col('value');
  const exchangeCol = col('exchange');
  const typeCol     = col('type') || col('asset');
  const folioCol    = col('folio');
  const isLikelyMutualFundSheet = !!(col('scheme') || col('folio') || col('amc')) && !!col('units');

  return data.map(row => {
    const rawType = typeCol ? (row[typeCol] || '').toLowerCase() : '';
    let asset_type = isLikelyMutualFundSheet ? 'mutual_fund' : 'equity';
    if (rawType.includes('equity') || rawType.includes('stock')) asset_type = 'equity';
    else if (rawType.includes('mutual') || rawType.includes('mf') || rawType.includes('fund')) asset_type = 'mutual_fund';
    else if (rawType.includes('etf')) asset_type = 'etf';
    else if (rawType.includes('bond')) asset_type = 'bond';
    else if (rawType.includes('fd') || rawType.includes('fixed')) asset_type = 'fd';
    else if (rawType.includes('nps')) asset_type = 'nps';
    else if (rawType.includes('crypto')) asset_type = 'crypto';

    const quantity = qtyCol ? toNumber(row[qtyCol]) : 0;
    const invested_amount = amtCol ? toNumber(row[amtCol]) : 0;
    let avg_buy_price = priceCol ? toNumber(row[priceCol]) : 0;
    if (!avg_buy_price && quantity > 0 && invested_amount > 0) {
      avg_buy_price = invested_amount / quantity;
    }

    return {
      asset_type,
      symbol:        symbolCol ? row[symbolCol]?.trim() : null,
      name:          nameCol ? row[nameCol]?.trim() : (symbolCol ? row[symbolCol]?.trim() : 'Unknown'),
      exchange:      exchangeCol ? row[exchangeCol]?.trim() : 'NSE',
      quantity,
      avg_buy_price,
      invested_amount,
      folio_number:  folioCol ? (row[folioCol] || null) : null,
      units:         isLikelyMutualFundSheet ? quantity : null,
      nav:           isLikelyMutualFundSheet ? avg_buy_price : null,
      broker:        'excel',
    };
  }).filter(h => h.quantity > 0 || h.invested_amount > 0);
}

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
    quantity:       toNumber(row['Quantity']),
    avg_buy_price:  toNumber(row['Average price'] || row['Avg. price'] || '0'),
    invested_amount:toNumber(row['P&L']),
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
      quantity:       toNumber(row['Shares'] || row['Units'] || '0'),
      avg_buy_price:  toNumber(row['Avg. Buy Price'] || row['Buy NAV'] || '0'),
      invested_amount:toNumber(row['Total Investment'] || row['Invested Amount'] || '0'),
      units:          toNumber(row['Units'] || '0') || null,
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
      quantity:        qtyCol  ? toNumber(row[qtyCol])   : 0,
      avg_buy_price:   priceCol? toNumber(row[priceCol]) : 0,
      invested_amount: amtCol  ? toNumber(row[amtCol])   : 0,
      broker:          'manual',
    };
  }).filter(h => h.name && h.quantity > 0);
}

function parseDelimitedText(text) {
  if (!Papa) throw new Error('papaparse not installed');

  const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
  const delimiters = [',', '\t', ';', '|'];
  let delimiter = ',';
  let best = -1;
  for (const d of delimiters) {
    const score = sample.split('\n').reduce((s, line) => s + Math.max(0, line.split(d).length - 1), 0);
    if (score > best) {
      best = score;
      delimiter = d;
    }
  }

  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    delimiter: best > 0 ? delimiter : '',
  });
  if (!parsed.data?.length || !(parsed.meta?.fields || []).length) return [];
  return parseGenericCSVFromData(parsed);
}

function parseJSONPortfolio(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  const rows = Array.isArray(parsed)
    ? parsed
    : (parsed?.holdings || parsed?.portfolio || parsed?.assets || []);
  if (!Array.isArray(rows) || !rows.length) return [];

  return rows.map((row) => {
    const rawType = String(pick(row, ['asset_type', 'assetType', 'type']) || '').toLowerCase();
    let asset_type = 'equity';
    if (rawType.includes('mutual')) asset_type = 'mutual_fund';
    else if (rawType.includes('etf')) asset_type = 'etf';
    else if (rawType.includes('bond')) asset_type = 'bond';
    else if (rawType.includes('fd') || rawType.includes('fixed')) asset_type = 'fd';
    else if (rawType.includes('nps')) asset_type = 'nps';
    else if (rawType.includes('crypto')) asset_type = 'crypto';
    else if (rawType.includes('us')) asset_type = 'us_stock';

    const quantity = toNumber(pick(row, ['quantity', 'qty', 'shares', 'units']));
    const avg_buy_price = toNumber(pick(row, ['avg_buy_price', 'avgPrice', 'buy_price', 'price', 'nav']));
    const invested_amount = toNumber(pick(row, ['invested_amount', 'invested', 'amount', 'investment'])) || (quantity * avg_buy_price);
    const symbol = pick(row, ['symbol', 'ticker', 'isin', 'code']);
    const name = pick(row, ['name', 'company', 'companyName', 'instrument', 'scheme']) || symbol || 'Unknown';

    return {
      asset_type,
      symbol: symbol ? String(symbol).trim() : null,
      name: String(name).trim(),
      exchange: String(pick(row, ['exchange', 'market']) || 'NSE').trim(),
      quantity,
      avg_buy_price,
      invested_amount,
      broker: 'manual',
    };
  }).filter(h => h.name && (h.quantity > 0 || h.invested_amount > 0));
}

function sanitizeText(buffer) {
  return buffer
    .toString('utf8')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function detectType(buffer, filePath, originalName = '', mimeType = '') {
  const byName = path.extname(originalName || filePath).toLowerCase();
  const byPath = path.extname(filePath).toLowerCase();
  const ext = byName || byPath;

  const head = buffer.subarray(0, 12).toString('ascii');
  if (head.startsWith('%PDF')) return { ext: '.pdf', kind: 'pdf' };

  if (ext === '.pdf') return { ext, kind: 'pdf' };
  if (['.xlsx', '.xls', '.xlsm', '.xlsb', '.ods'].includes(ext)) return { ext, kind: 'excel' };
  if (['.csv', '.tsv'].includes(ext)) return { ext, kind: 'delimited' };
  if (ext === '.json') return { ext, kind: 'json' };
  if (ext === '.txt' || ext === '.text' || ext === '.md' || ext === '.log') return { ext, kind: 'text' };

  if ((mimeType || '').includes('sheet') || (mimeType || '').includes('excel')) return { ext, kind: 'excel' };
  if ((mimeType || '').includes('csv')) return { ext, kind: 'delimited' };
  if ((mimeType || '').includes('json')) return { ext, kind: 'json' };
  if ((mimeType || '').includes('text')) return { ext, kind: 'text' };

  return { ext, kind: 'unknown' };
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
 * @param {string} filePath - uploaded file path
 * @param {{ originalName?: string, mimeType?: string }} options
 * @returns {Promise<Array>} normalized holdings
 */
async function parseFile(filePath, options = {}) {
  const { originalName = '', mimeType = '' } = options;
  const buffer = fs.readFileSync(filePath);
  const detected = detectType(buffer, filePath, originalName, mimeType);

  const tried = [];
  const tryParser = async (name, fn) => {
    tried.push(name);
    try {
      const holdings = await fn();
      if (Array.isArray(holdings) && holdings.length) return holdings;
    } catch (err) {
      logger.debug(`[Parser] ${name} failed: ${err.message}`);
    }
    return null;
  };

  if (detected.kind === 'pdf') {
    const pdfHoldings = await tryParser('pdf', () => parsePDF(filePath));
    if (pdfHoldings) return pdfHoldings;
  }

  if (detected.kind === 'excel' || detected.kind === 'unknown') {
    const excelHoldings = await tryParser('excel', () => parseExcel(filePath));
    if (excelHoldings) return excelHoldings;
  }

  const text = sanitizeText(buffer);
  if (text) {
    if (detected.kind === 'json' || detected.kind === 'unknown') {
      const jsonHoldings = await tryParser('json', () => parseJSONPortfolio(text));
      if (jsonHoldings) return jsonHoldings;
    }

    if (detected.kind === 'delimited' || detected.kind === 'text' || detected.kind === 'unknown') {
      const kite = await tryParser('kite_csv', () =>
        (text.includes('Tradingsymbol') || text.includes('Average price')) ? parseKiteCSV(text) : []
      );
      if (kite) return kite;

      const groww = await tryParser('groww_csv', () =>
        (text.includes('Scheme Name') || text.includes('Folio No')) ? parseGrowwCSV(text) : []
      );
      if (groww) return groww;

      const delimited = await tryParser('delimited', () => parseDelimitedText(text));
      if (delimited) return delimited;

      const plainText = await tryParser('plain_text', () => parseText(text));
      if (plainText) return plainText;
    }
  }

  throw new Error(
    `Unsupported or unreadable file format${detected.ext ? ` (${detected.ext})` : ''}. `
    + `Tried: ${tried.join(', ')}`
  );
}

module.exports = { parseFile, parseText, parseKiteCSV, parseGrowwCSV, parseGenericCSV, parseExcel, parsePDF };
