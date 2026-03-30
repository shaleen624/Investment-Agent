'use strict';

/**
 * NewsAPI.org news source.
 * Free tier: 100 requests/day, news up to 1 month old.
 * Get your key: https://newsapi.org/register
 */

const axios  = require('axios');
const logger = require('../../config/logger');
const { config } = require('../../config');

const BASE = 'https://newsapi.org/v2';

async function newsApiGet(endpoint, params = {}) {
  const apiKey = config.news.newsApi.apiKey;
  if (!apiKey) throw new Error('NEWS_API_KEY not configured');

  try {
    const res = await axios.get(`${BASE}/${endpoint}`, {
      params:  { ...params, apiKey },
      timeout: 10000,
    });
    return res.data;
  } catch (err) {
    if (err.response) {
      throw new Error(`NewsAPI ${err.response.status}: ${err.response.data?.message}`);
    }
    throw err;
  }
}

/**
 * Fetch top Indian market + business news.
 * @param {number} pageSize - max 100 for free tier
 */
async function getIndianMarketNews(pageSize = 20) {
  try {
    const data = await newsApiGet('top-headlines', {
      country:  'in',
      category: 'business',
      pageSize,
    });
    return (data.articles || []).map(a => ({
      source:      a.source?.name || 'NewsAPI',
      title:       a.title || '',
      url:         a.url   || '',
      summary:     a.description || '',
      publishedAt: a.publishedAt || new Date().toISOString(),
    }));
  } catch (err) {
    logger.warn(`[NewsAPI] getIndianMarketNews failed: ${err.message}`);
    return [];
  }
}

/**
 * Search for news related to a specific company or topic.
 * @param {string} query  - e.g. "Reliance Industries earnings"
 * @param {number} pageSize
 */
async function searchNews(query, pageSize = 10) {
  try {
    const data = await newsApiGet('everything', {
      q:          query,
      language:   'en',
      sortBy:     'publishedAt',
      pageSize,
      from:       new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    });
    return (data.articles || []).map(a => ({
      source:      a.source?.name || 'NewsAPI',
      title:       a.title || '',
      url:         a.url   || '',
      summary:     a.description || '',
      publishedAt: a.publishedAt || new Date().toISOString(),
    }));
  } catch (err) {
    logger.warn(`[NewsAPI] searchNews failed for "${query}": ${err.message}`);
    return [];
  }
}

/**
 * Fetch global financial / world news (for macro context).
 */
async function getGlobalFinanceNews(pageSize = 15) {
  try {
    const data = await newsApiGet('everything', {
      q:        'stock market OR economy OR recession OR RBI OR Fed OR inflation',
      language: 'en',
      sortBy:   'publishedAt',
      pageSize,
      from:     new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    });
    return (data.articles || []).map(a => ({
      source:      a.source?.name || 'NewsAPI',
      title:       a.title || '',
      url:         a.url   || '',
      summary:     a.description || '',
      publishedAt: a.publishedAt || new Date().toISOString(),
    }));
  } catch (err) {
    logger.warn(`[NewsAPI] getGlobalFinanceNews failed: ${err.message}`);
    return [];
  }
}

module.exports = { getIndianMarketNews, searchNews, getGlobalFinanceNews };
