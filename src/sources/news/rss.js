'use strict';

/**
 * RSS feed news aggregator.
 * Fetches from major Indian financial news sources — no API key needed.
 */

const RSSParser = require('rss-parser');
const logger    = require('../../config/logger');
const { config } = require('../../config');

const parser = new RSSParser({
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; InvestmentAgent/1.0)',
    'Accept':     'application/rss+xml, application/xml, text/xml, */*',
  },
});

/**
 * Fetch articles from a single RSS feed URL.
 * @param {{ name: string, url: string }} feed
 * @returns {Array}
 */
async function fetchFeed(feed) {
  try {
    const result = await parser.parseURL(feed.url);
    return (result.items || []).map(item => ({
      source:      feed.name,
      title:       item.title?.trim() || '',
      url:         item.link  || item.guid || '',
      summary:     item.contentSnippet?.slice(0, 500) || item.summary?.slice(0, 500) || '',
      publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
    }));
  } catch (err) {
    logger.warn(`[RSS] Failed to fetch "${feed.name}": ${err.message}`);
    return [];
  }
}

/**
 * Fetch all configured RSS feeds concurrently.
 * Returns deduplicated, sorted articles (newest first).
 * @param {number} maxAgeHours - ignore articles older than this
 */
async function fetchAllFeeds(maxAgeHours = 24) {
  const feeds = config.news.rss.feeds;
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;

  const batches = await Promise.allSettled(feeds.map(f => fetchFeed(f)));

  const all = [];
  const seen = new Set();

  batches.forEach(result => {
    if (result.status === 'fulfilled') {
      result.value.forEach(article => {
        const key = article.title.toLowerCase().slice(0, 80);
        if (seen.has(key)) return; // deduplicate
        if (new Date(article.publishedAt).getTime() < cutoff) return;
        seen.add(key);
        all.push(article);
      });
    }
  });

  // Sort newest first
  all.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  logger.info(`[RSS] Fetched ${all.length} articles from ${feeds.length} feeds`);
  return all;
}

module.exports = { fetchFeed, fetchAllFeeds };
