'use strict';

const logger = require('../../config/logger');
const yahoo = require('./yahoo');

const cache = new Map();
const COMMON_SUFFIXES = [
  'LIMITED',
  'LTD',
  'LTD.',
  'INDIA',
  'INDUSTRIES',
  'SERVICES',
  'SERVICE',
  'COMPANY',
  'CO',
  'CO.',
  'CORPORATION',
  'CORP',
  'CORP.',
  'INC',
  'INC.',
  'PLC',
  'PVT',
  'PVT.',
];

function isLikelyIsin(value) {
  return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(String(value || '').trim().toUpperCase());
}

function normalizeName(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !COMMON_SUFFIXES.includes(token))
    .join(' ')
    .trim();
}

function normalizeTicker(symbol, exchange = 'NSE') {
  const raw = String(symbol || '').trim().toUpperCase();
  if (!raw) return null;
  if (exchange === 'NSE' && raw.endsWith('.NS')) return raw.slice(0, -3);
  if (exchange === 'BSE' && raw.endsWith('.BO')) return raw.slice(0, -3);
  return raw;
}

function isNseCandidate(candidate) {
  const symbol = String(candidate?.symbol || '').toUpperCase();
  const exchange = String(candidate?.exchange || '').toUpperCase();
  return symbol.endsWith('.NS') || exchange === 'NSI' || exchange === 'NSE';
}

function isEquityCandidate(candidate) {
  const type = String(candidate?.type || '').toUpperCase();
  return !type || type === 'EQUITY' || type === 'ETF';
}

function scoreCandidate(targetName, candidate) {
  const candidateName = normalizeName(candidate?.name || candidate?.symbol || '');
  if (!candidateName) return 0;

  const targetTokens = new Set(normalizeName(targetName).split(' ').filter(Boolean));
  const candidateTokens = new Set(candidateName.split(' ').filter(Boolean));
  let overlap = 0;

  targetTokens.forEach((token) => {
    if (candidateTokens.has(token)) overlap++;
  });

  let score = overlap * 10;
  if (targetTokens.size && candidateTokens.size) {
    score += overlap / Math.max(targetTokens.size, candidateTokens.size);
  }
  if (candidateName === normalizeName(targetName)) score += 100;
  if (normalizeName(targetName).includes(candidateName) || candidateName.includes(normalizeName(targetName))) {
    score += 25;
  }
  if (isNseCandidate(candidate)) score += 20;
  if (isEquityCandidate(candidate)) score += 5;

  return score;
}

async function resolveTickerFromHolding(holding) {
  const symbol = String(holding?.symbol || '').trim();
  const name = String(holding?.name || '').trim();
  const assetType = String(holding?.asset_type || '').trim().toLowerCase();
  const exchange = String(holding?.exchange || 'NSE').trim().toUpperCase();

  if (!isLikelyIsin(symbol)) {
    return {
      symbol: normalizeTicker(symbol, exchange),
      isin: holding?.isin || null,
      exchange,
      resolved: false,
    };
  }

  if (!['equity', 'etf'].includes(assetType) || !name) {
    return { symbol, isin: symbol, exchange, resolved: false };
  }

  const cacheKey = `${exchange}|${symbol}|${name}`.toUpperCase();
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  try {
    const candidates = await yahoo.searchSymbol(name);
    const filtered = candidates
      .filter((candidate) => isNseCandidate(candidate) && isEquityCandidate(candidate))
      .map((candidate) => ({ ...candidate, score: scoreCandidate(name, candidate) }))
      .sort((a, b) => b.score - a.score);

    const best = filtered[0];
    if (best && best.score >= 20) {
      const resolved = {
        symbol: normalizeTicker(best.symbol, 'NSE'),
        isin: symbol,
        exchange: 'NSE',
        resolved: true,
      };
      cache.set(cacheKey, resolved);
      return resolved;
    }
  } catch (err) {
    logger.warn(`[Resolver] ISIN lookup failed for ${symbol}: ${err.message}`);
  }

  const fallback = { symbol, isin: symbol, exchange, resolved: false };
  cache.set(cacheKey, fallback);
  return fallback;
}

module.exports = { isLikelyIsin, normalizeTicker, resolveTickerFromHolding };
