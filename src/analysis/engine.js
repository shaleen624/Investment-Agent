'use strict';

/**
 * Analysis Engine — the brain of the investment agent.
 *
 * Orchestrates:
 *  1. Portfolio loading + price refresh
 *  2. Market snapshot capture
 *  3. News fetch + sentiment scoring
 *  4. LLM brief generation (morning / evening)
 *  5. Recommendation storage
 */

const logger    = require('../config/logger');
const { run, get: dbGet, all: dbAll } = require('../db');
const market    = require('../sources/market');
const news      = require('../sources/news');
const portfolio = require('../portfolio/manager');
const llm       = require('../llm/provider');
const prompts   = require('../llm/prompts');

// ── News Sentiment Scoring ────────────────────────────────────────────────────

/**
 * Score news articles using LLM.
 * Updates impact_score and sentiment in news_cache.
 */
async function scoreNews() {
  if (!llm.isAvailable()) {
    logger.warn('[Analysis] LLM not configured — skipping news sentiment scoring');
    return;
  }

  // Get unscored news from last 24h
  const unscoredArticles = dbAll(
    `SELECT id, title, summary FROM news_cache
     WHERE sentiment IS NULL
       AND published_at >= datetime('now', '-24 hours')
     ORDER BY published_at DESC
     LIMIT 15`
  );

  if (!unscoredArticles.length) return;

  const holdings    = portfolio.getAllHoldings();
  const symbols     = holdings.map(h => h.symbol).filter(Boolean);

  try {
    const prompt   = prompts.newsSentimentPrompt(unscoredArticles, symbols);
    const response = await llm.chat(prompt, { maxTokens: 1500 });
    const scored   = llm.extractJSON(response);

    if (Array.isArray(scored)) {
      for (const item of scored) {
        const article = unscoredArticles[item.index - 1];
        if (!article) continue;
        run(
          `UPDATE news_cache SET
             sentiment      = ?,
             impact_score   = ?,
             related_symbols= ?
           WHERE id = ?`,
          [
            item.sentiment,
            item.impact_score || 0,
            JSON.stringify(item.related_symbols || []),
            article.id,
          ]
        );
      }
      logger.info(`[Analysis] Scored ${scored.length} news articles`);
    }
  } catch (err) {
    logger.warn(`[Analysis] News scoring failed: ${err.message}`);
  }
}

// ── Brief Generation ──────────────────────────────────────────────────────────

/**
 * Generate a morning brief.
 * @returns {{ content: string, briefId: number }}
 */
async function generateMorningBrief(userId = null) {
  logger.info('[Analysis] Generating morning brief...');

  // 1. Refresh market data
  const [marketSnapshot] = await Promise.allSettled([
    market.captureMarketSnapshot(),
    market.updateAllPrices(),
  ]);

  // 2. Fetch fresh news
  const holdings  = userId ? portfolio.getAllHoldings(userId) : portfolio.getAllHoldings();
  const symbols   = holdings.map(h => h.symbol).filter(Boolean);
  await news.fetchAndCache(symbols);
  await scoreNews();

  // 3. Build context
  const portfolioSummary = userId ? portfolio.getPortfolioSummary(userId) : portfolio.getPortfolioSummary();
  const goals            = userId ? portfolio.getGoals(userId) : portfolio.getGoals();
  const topNews          = news.getTopNews(20, 12);
  const snapshot         = market.getLatestSnapshot();

  // 4. Get yesterday's evening brief for context
  const lastEvening = dbGet(
    `SELECT summary FROM briefs
     WHERE type = 'evening'
     ORDER BY date DESC, created_at DESC
     LIMIT 1`
  );

  // 5. Check if LLM available
  if (!llm.isAvailable()) {
    const fallback = generateFallbackMorningBrief(portfolioSummary, snapshot, topNews, goals);
    const briefId  = saveBrief('morning', fallback, null);
    return { content: fallback, briefId };
  }

  // 6. Generate with LLM
  const prompt   = prompts.morningBriefPrompt({
    portfolio:    portfolioSummary,
    market:       snapshot,
    news:         topNews,
    goals,
    previousBrief: lastEvening?.summary || null,
  });

  try {
    const content = await llm.chat(prompt, { maxTokens: 3000 });
    const summary = content.slice(0, 800); // first ~800 chars as summary
    const briefId = saveBrief('morning', content, summary, snapshot, userId);

    logger.info('[Analysis] Morning brief generated');
    return { content, briefId };
  } catch (err) {
    logger.error(`[Analysis] Morning brief LLM failed: ${err.message}`);
    const fallback = generateFallbackMorningBrief(portfolioSummary, snapshot, topNews, goals);
    const briefId  = saveBrief('morning', fallback, null, snapshot, userId);
    return { content: fallback, briefId };
  }
}

/**
 * Generate an evening brief.
 * @returns {{ content: string, briefId: number }}
 */
async function generateEveningBrief(userId = null) {
  logger.info('[Analysis] Generating evening brief...');

  // 1. Refresh market data (closing prices)
  await Promise.allSettled([
    market.captureMarketSnapshot(),
    market.updateAllPrices(),
  ]);

  // 2. Fetch day's news
  const holdings  = userId ? portfolio.getAllHoldings(userId) : portfolio.getAllHoldings();
  const symbols   = holdings.map(h => h.symbol).filter(Boolean);
  await news.fetchAndCache(symbols);
  await scoreNews();

  // 3. Build context
  const portfolioSummary = userId ? portfolio.getPortfolioSummary(userId) : portfolio.getPortfolioSummary();
  const goals            = userId ? portfolio.getGoals(userId) : portfolio.getGoals();
  const topNews          = news.getTopNews(25, 24);
  const snapshot         = market.getLatestSnapshot();

  // 4. Get this morning's brief for continuity
  const thisMorning = dbGet(
    `SELECT content FROM briefs
     WHERE type = 'morning' AND date = date('now')
     ORDER BY created_at DESC LIMIT 1`
  );

  if (!llm.isAvailable()) {
    const fallback = generateFallbackEveningBrief(portfolioSummary, snapshot, topNews, goals);
    const briefId  = saveBrief('evening', fallback, null, snapshot, userId);
    return { content: fallback, briefId };
  }

  const prompt = prompts.eveningBriefPrompt({
    portfolio:    portfolioSummary,
    market:       snapshot,
    news:         topNews,
    goals,
    morningBrief: thisMorning?.content?.slice(0, 1500) || null,
  });

  try {
    const content = await llm.chat(prompt, { maxTokens: 3500 });
    const summary = content.slice(0, 800);
    const briefId = saveBrief('evening', content, summary, snapshot, userId);

    // Extract and save recommendations from brief
    await extractAndSaveRecommendations(content, briefId);

    logger.info('[Analysis] Evening brief generated');
    return { content, briefId };
  } catch (err) {
    logger.error(`[Analysis] Evening brief LLM failed: ${err.message}`);
    const fallback = generateFallbackEveningBrief(portfolioSummary, snapshot, topNews, goals);
    const briefId  = saveBrief('evening', fallback, null, snapshot);
    return { content: fallback, briefId };
  }
}

/**
 * Full on-demand portfolio analysis.
 */
async function analyzePortfolio() {
  logger.info('[Analysis] Running full portfolio analysis...');

  await market.updateAllPrices();
  const portfolioSummary = portfolio.getPortfolioSummary();
  const goals            = portfolio.getGoals();
  const snapshot         = market.getLatestSnapshot();

  if (!llm.isAvailable()) {
    return 'LLM not configured. Please set ANTHROPIC_API_KEY or OPENAI_API_KEY.';
  }

  const prompt   = prompts.portfolioAnalysisPrompt({ portfolio: portfolioSummary, market: snapshot, goals });
  const analysis = await llm.chat(prompt, { maxTokens: 4000 });
  return analysis;
}

// ── Persistence helpers ───────────────────────────────────────────────────────

function saveBrief(type, content, summary, snapshot = null, userId = null) {
  const today = new Date().toISOString().slice(0, 10);
  const marketSnap = snapshot ? {
    nifty50: snapshot.nifty50,
    sensex:  snapshot.sensex,
    usd_inr: snapshot.usd_inr,
  } : {};

  const result = run(
    `INSERT INTO briefs (user_id, type, date, content, summary, market_snapshot)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      userId,
      type,
      today,
      content,
      summary || null,
      JSON.stringify(marketSnap),
    ]
  );
  return result.lastInsertRowid;
}

function markBriefSent(briefId, channels) {
  run(
    `UPDATE briefs SET sent_channels = ? WHERE id = ?`,
    [JSON.stringify(channels), briefId]
  );
}

function getLatestBrief(type, userId = null) {
  if (userId) {
    return dbGet(
      `SELECT * FROM briefs WHERE user_id = ? AND type = ? ORDER BY date DESC, created_at DESC LIMIT 1`,
      [userId, type]
    );
  }
  return dbGet(
    `SELECT * FROM briefs WHERE type = ? ORDER BY date DESC, created_at DESC LIMIT 1`,
    [type]
  );
}

// ── Recommendation extraction ─────────────────────────────────────────────────

/**
 * Parse the LLM brief to extract specific buy/sell/hold recommendations
 * and save them to the recommendations table.
 */
async function extractAndSaveRecommendations(briefContent, briefId, userId = null) {
  if (!llm.isAvailable()) return;

  const holdings = userId ? portfolio.getAllHoldings(userId) : portfolio.getAllHoldings();
  const symbolsStr = holdings.map(h => h.symbol || h.name).filter(Boolean).join(', ');

  const extractPrompt = {
    system: 'You are a financial data extractor. Extract actionable stock recommendations from the text.',
    user: `Extract all specific stock recommendations from this brief.
For each recommendation provide:
- symbol: stock ticker (from this list if possible: ${symbolsStr})
- name: company name
- action: "buy"|"sell"|"hold"|"increase"|"reduce"|"watch"
- rationale: brief reason (max 100 chars)
- confidence: 1-10
- target_price: number or null
- stop_loss: number or null
- time_horizon: "intraday"|"short_term"|"long_term"

Brief text:
${briefContent.slice(0, 3000)}

Return a JSON array. Return [] if no specific recommendations found.`,
  };

  try {
    const response = await llm.chat(extractPrompt, { maxTokens: 1500 });
    const recs     = llm.extractJSON(response);

    if (!Array.isArray(recs)) return;

    for (const r of recs) {
      if (!r.action || !r.symbol) continue;

      const holding = holdings.find(h =>
        h.symbol?.toLowerCase() === r.symbol?.toLowerCase() ||
        h.name?.toLowerCase().includes(r.name?.toLowerCase() || '')
      );

      run(
        `INSERT INTO recommendations
           (user_id, holding_id, symbol, name, action, rationale, confidence, time_horizon,
            target_price, stop_loss, brief_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          holding?.id || null,
          r.symbol,
          r.name || r.symbol,
          r.action,
          r.rationale || '',
          r.confidence || 5,
          r.time_horizon || 'short_term',
          r.target_price || null,
          r.stop_loss    || null,
          briefId,
        ]
      );
    }
    logger.info(`[Analysis] Saved ${recs.length} recommendations`);
  } catch (err) {
    logger.debug(`[Analysis] Recommendation extraction failed: ${err.message}`);
  }
}

// ── Fallback briefs (no LLM) ──────────────────────────────────────────────────

function generateFallbackMorningBrief(summary, snapshot, newsItems, goals) {
  const date = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const lines = [`# Morning Brief — ${date}\n`];

  if (snapshot) {
    lines.push('## Market Snapshot');
    lines.push(`- Nifty 50:  ${snapshot.nifty50 || 'N/A'}`);
    lines.push(`- Sensex:    ${snapshot.sensex || 'N/A'}`);
    lines.push(`- USD/INR:   ${snapshot.usd_inr || 'N/A'}`);
    lines.push(`- Dow Jones: ${snapshot.dow_jones || 'N/A'}\n`);
  }

  if (summary) {
    lines.push('## Portfolio Status');
    lines.push(`- Total Value:    ₹${(summary.totalCurrent || 0).toLocaleString('en-IN')}`);
    lines.push(`- Unrealized P&L: ₹${(summary.unrealizedPnl || 0).toLocaleString('en-IN')} (${(summary.pnlPercent || 0).toFixed(2)}%)\n`);
  }

  if (newsItems && newsItems.length) {
    lines.push('## Top News');
    newsItems.slice(0, 5).forEach((n, i) => lines.push(`${i + 1}. ${n.title}`));
    lines.push('');
  }

  lines.push('> *LLM analysis not available. Configure ANTHROPIC_API_KEY for AI-powered insights.*');
  return lines.join('\n');
}

function generateFallbackEveningBrief(summary, snapshot, newsItems, goals) {
  const date = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const lines = [`# Evening Brief — ${date}\n`];

  if (snapshot) {
    lines.push('## Market Close');
    lines.push(`- Nifty 50: ${snapshot.nifty50 || 'N/A'}`);
    lines.push(`- Sensex:   ${snapshot.sensex || 'N/A'}\n`);
  }

  if (summary) {
    lines.push('## Portfolio End-of-Day');
    lines.push(`- Total Value:    ₹${(summary.totalCurrent || 0).toLocaleString('en-IN')}`);
    lines.push(`- Unrealized P&L: ₹${(summary.unrealizedPnl || 0).toLocaleString('en-IN')} (${(summary.pnlPercent || 0).toFixed(2)}%)\n`);

    lines.push('## Holdings P&L');
    (summary.holdings || [])
      .sort((a, b) => (b.pnl_percent || 0) - (a.pnl_percent || 0))
      .slice(0, 10)
      .forEach(h => {
        const pnl = h.pnl_percent != null ? `${h.pnl_percent >= 0 ? '+' : ''}${h.pnl_percent.toFixed(1)}%` : '';
        lines.push(`- ${(h.symbol || h.name).padEnd(20)} ${pnl}`);
      });
    lines.push('');
  }

  if (newsItems && newsItems.length) {
    lines.push('## Today\'s Key News');
    newsItems.slice(0, 8).forEach((n, i) => lines.push(`${i + 1}. ${n.title}`));
    lines.push('');
  }

  lines.push('> *LLM analysis not available. Configure ANTHROPIC_API_KEY for AI-powered insights.*');
  return lines.join('\n');
}

module.exports = {
  generateMorningBrief,
  generateEveningBrief,
  analyzePortfolio,
  scoreNews,
  saveBrief,
  markBriefSent,
  getLatestBrief,
};
