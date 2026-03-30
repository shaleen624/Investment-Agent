'use strict';

/**
 * News aggregator — combines RSS + NewsAPI.
 * Stores results in news_cache table to avoid re-fetching.
 */

const logger   = require('../../config/logger');
const { run, all: dbAll, get: dbGet } = require('../../db');
const { config } = require('../../config');
const rss      = require('./rss');
const newsApi  = require('./newsapi');

/**
 * Fetch fresh news from all available sources and cache in DB.
 * @param {string[]} symbols - optional list of holding symbols to enrich search
 * @returns {Array} all fresh articles
 */
async function fetchAndCache(symbols = []) {
  const articles = [];

  // ── RSS (always available) ──────────────────────────────────────────────
  if (config.news.rss.enabled) {
    try {
      const rssArticles = await rss.fetchAllFeeds(24);
      articles.push(...rssArticles);
    } catch (err) {
      logger.error(`[News] RSS fetch error: ${err.message}`);
    }
  }

  // ── NewsAPI (if key configured) ─────────────────────────────────────────
  if (config.news.newsApi.enabled) {
    try {
      const [indian, global] = await Promise.allSettled([
        newsApi.getIndianMarketNews(20),
        newsApi.getGlobalFinanceNews(15),
      ]);
      if (indian.status === 'fulfilled')  articles.push(...indian.value);
      if (global.status === 'fulfilled')  articles.push(...global.value);
    } catch (err) {
      logger.error(`[News] NewsAPI fetch error: ${err.message}`);
    }
  }

  // ── Deduplicate and store ──────────────────────────────────────────────
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const insertStmt = run.bind(null); // using module-level run

  let saved = 0;
  for (const a of articles) {
    // Skip if already cached (same title)
    const existing = dbGet(
      `SELECT id FROM news_cache WHERE title = ? LIMIT 1`,
      [a.title.slice(0, 200)]
    );
    if (existing) continue;

    // Determine which symbols this article might relate to
    const relatedSymbols = [];
    if (symbols.length) {
      for (const sym of symbols) {
        if (a.title.toLowerCase().includes(sym.toLowerCase()) ||
            (a.summary || '').toLowerCase().includes(sym.toLowerCase())) {
          relatedSymbols.push(sym);
        }
      }
    }

    run(
      `INSERT INTO news_cache (source, title, url, summary, related_symbols, published_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        a.source,
        a.title.slice(0, 500),
        a.url?.slice(0, 1000) || '',
        (a.summary || '').slice(0, 1000),
        JSON.stringify(relatedSymbols),
        a.publishedAt,
      ]
    );
    saved++;
  }

  logger.info(`[News] ${articles.length} articles fetched, ${saved} new saved`);
  return articles;
}

/**
 * Get cached news from DB (last N hours).
 * @param {number} hours
 * @param {string|null} symbol - optional filter by related symbol
 */
function getCachedNews(hours = 24, symbol = null) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  if (symbol) {
    return dbAll(
      `SELECT * FROM news_cache
       WHERE published_at >= ? AND related_symbols LIKE ?
       ORDER BY published_at DESC`,
      [cutoff, `%${symbol}%`]
    );
  }

  return dbAll(
    `SELECT * FROM news_cache
     WHERE published_at >= ?
     ORDER BY published_at DESC`,
    [cutoff]
  );
}

/**
 * Get top N news articles for the brief.
 * Prefers articles with impact scores.
 */
function getTopNews(n = 20, hoursBack = 24) {
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
  return dbAll(
    `SELECT * FROM news_cache
     WHERE published_at >= ?
     ORDER BY impact_score DESC, published_at DESC
     LIMIT ?`,
    [cutoff, n]
  );
}

module.exports = { fetchAndCache, getCachedNews, getTopNews };
