'use strict';

const axios = require('axios');
const logger = require('../../config/logger');

const NAV_URL = 'https://www.amfiindia.com/spages/NAVAll.txt';
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

let cache = {
  entries: [],
  expiresAt: 0,
};

const STOPWORDS = new Set([
  'fund', 'plan', 'option', 'regular', 'direct', 'growth', 'dividend',
  'payout', 'reinvestment', 'idcw', 'the', 'and',
]);

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !STOPWORDS.has(token))
    .join(' ')
    .trim();
}

function scoreMatch(target, candidate) {
  const targetNorm = normalizeName(target);
  const candidateNorm = normalizeName(candidate);
  if (!targetNorm || !candidateNorm) return 0;
  if (targetNorm === candidateNorm) return 1000;

  const targetTokens = new Set(targetNorm.split(' '));
  const candidateTokens = new Set(candidateNorm.split(' '));
  let overlap = 0;

  targetTokens.forEach((token) => {
    if (candidateTokens.has(token)) overlap++;
  });

  let score = overlap * 10;
  if (candidateNorm.includes(targetNorm) || targetNorm.includes(candidateNorm)) score += 25;
  if (String(candidate || '').toLowerCase().includes('direct')) score += 5;
  if (String(candidate || '').toLowerCase().includes('growth')) score += 5;
  return score;
}

function parseNavFile(text) {
  const entries = [];
  const lines = String(text || '').split(/\r?\n/);

  for (const line of lines) {
    const parts = line.split(';');
    if (parts.length < 6) continue;

    const schemeCode = String(parts[0] || '').trim();
    const schemeName = String(parts[3] || '').trim();
    const nav = parseFloat(String(parts[4] || '').trim());
    const date = String(parts[5] || '').trim();

    if (!schemeCode || !schemeName || !Number.isFinite(nav)) continue;
    entries.push({ schemeCode, schemeName, nav, date });
  }

  return entries;
}

async function getNavEntries() {
  if (cache.entries.length && Date.now() < cache.expiresAt) {
    return cache.entries;
  }

  const res = await axios.get(NAV_URL, {
    timeout: 12000,
    headers: {
      'User-Agent': 'Mozilla/5.0 Investment-Agent/0.1',
      'Accept': 'text/plain,*/*',
    },
  });

  const entries = parseNavFile(res.data);
  cache = {
    entries,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  return entries;
}

async function getNavByName(name) {
  try {
    const entries = await getNavEntries();
    const scored = entries
      .map((entry) => ({ ...entry, score: scoreMatch(name, entry.schemeName) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best || best.score < 20) return null;

    return {
      schemeCode: best.schemeCode,
      schemeName: best.schemeName,
      nav: best.nav,
      date: best.date,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.warn(`[AMFI] NAV lookup failed for ${name}: ${err.message}`);
    return null;
  }
}

module.exports = { getNavByName };
