'use strict';

/**
 * All LLM prompt templates for the investment agent.
 * Each function returns a structured { system, user } object.
 */

const { format } = require('date-fns');

// ── Shared context builder ────────────────────────────────────────────────────

function buildPortfolioContext(summary) {
  if (!summary) return 'No portfolio data available.';

  const lines = [
    `Total Invested: ₹${summary.totalInvested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
    `Current Value:  ₹${summary.totalCurrent.toLocaleString('en-IN',  { maximumFractionDigits: 0 })}`,
    `Unrealized P&L: ₹${summary.unrealizedPnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (${summary.pnlPercent.toFixed(2)}%)`,
  ];

  if (summary.taxPnl) {
    lines.push(
      `Realized STCG (FIFO): ₹${(summary.taxPnl.stcg || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
      `Realized LTCG (FIFO): ₹${(summary.taxPnl.ltcg || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
      `Total Realized Tax P&L: ₹${(summary.taxPnl.totalRealized || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
    );
  }

  lines.push('', '── Allocation by Asset Type ──');

  for (const [type, data] of Object.entries(summary.byType || {})) {
    const pct = summary.totalInvested > 0 ? (data.invested / summary.totalInvested * 100).toFixed(1) : '0';
    lines.push(`  ${type.padEnd(15)} ₹${data.current.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (${pct}%)`);
  }

  if (Object.keys(summary.bySector || {}).length) {
    lines.push('', '── Top Sectors ──');
    const sectors = Object.entries(summary.bySector)
      .sort((a, b) => b[1].current - a[1].current)
      .slice(0, 8);
    for (const [sector, data] of sectors) {
      const pct = summary.totalInvested > 0 ? (data.invested / summary.totalInvested * 100).toFixed(1) : '0';
      lines.push(`  ${sector.padEnd(20)} ${pct}%`);
    }
  }

  lines.push('', '── Holdings ──');
  const topHoldings = (summary.holdings || [])
    .sort((a, b) => (b.current_value || 0) - (a.current_value || 0))
    .slice(0, 20);

  for (const h of topHoldings) {
    const pnl = h.pnl_percent ? ` (${h.pnl_percent >= 0 ? '+' : ''}${h.pnl_percent.toFixed(1)}%)` : '';
    lines.push(`  ${(h.symbol || h.name).padEnd(20)} ₹${(h.current_value || h.invested_amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}${pnl}`);
  }

  return lines.join('\n');
}

function buildMarketContext(snapshot) {
  if (!snapshot) return 'Market data not available.';

  const fmt = (v, dec = 2) => v != null ? v.toFixed(dec) : 'N/A';
  const chg = v => v != null ? (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2)) : '';

  return [
    `Nifty 50:  ${fmt(snapshot.nifty50)}  ${chg(snapshot.raw_data?.nifty50?.changePercent)}%`,
    `Sensex:    ${fmt(snapshot.sensex)}   ${chg(snapshot.raw_data?.sensex?.changePercent)}%`,
    `Nifty Bank:${fmt(snapshot.nifty_bank)}`,
    `Dow Jones: ${fmt(snapshot.dow_jones)}  ${chg(snapshot.raw_data?.dowJones?.changePercent)}%`,
    `NASDAQ:    ${fmt(snapshot.nasdaq)}   ${chg(snapshot.raw_data?.nasdaq?.changePercent)}%`,
    `S&P 500:   ${fmt(snapshot.sp500)}`,
    `USD/INR:   ${fmt(snapshot.usd_inr)}`,
    `India VIX: ${fmt(snapshot.vix)}`,
    `Gold:      ${fmt(snapshot.gold_mcx)}`,
    `Crude Oil: ${fmt(snapshot.crude_mcx)}`,
  ].join('\n');
}

function buildNewsContext(articles, maxItems = 15) {
  if (!articles || !articles.length) return 'No recent news available.';
  return articles.slice(0, maxItems).map((a, i) =>
    `${i + 1}. [${a.source}] ${a.title}\n   ${(a.summary || '').slice(0, 150)}`
  ).join('\n\n');
}

function buildGoalsContext(goals) {
  if (!goals || !goals.length) return 'No investment goals defined.';
  return goals.map(g => {
    const parts = [`[${g.type.toUpperCase()}] ${g.title}`];
    if (g.description) parts.push(`  ${g.description}`);
    if (g.target_amount) parts.push(`  Target: ₹${g.target_amount.toLocaleString('en-IN')}`);
    if (g.target_date)   parts.push(`  By: ${g.target_date}`);
    parts.push(`  Risk: ${g.risk_tolerance}`);
    return parts.join('\n');
  }).join('\n\n');
}

// ── Prompt templates ──────────────────────────────────────────────────────────

const SYSTEM_BASE = `You are an expert Indian stock market analyst and portfolio advisor with deep knowledge of:
- NSE and BSE listed companies
- Mutual funds, ETFs, and other Indian financial instruments
- Technical and fundamental analysis
- Macroeconomic factors affecting Indian markets
- Global market correlations
- RBI monetary policy and its market impact
- SEBI regulations

You provide clear, actionable, and data-driven investment advice.
Always mention risks alongside recommendations.
Format your responses in clean Markdown for readability.
Use ₹ for Indian Rupee amounts.
Be concise but comprehensive.`;

/**
 * Morning brief prompt — focus on TODAY's actionable plan.
 */
function morningBriefPrompt({ portfolio, market, news, goals, previousBrief }) {
  const today = format(new Date(), 'EEEE, MMMM d, yyyy');

  return {
    system: SYSTEM_BASE,
    user: `Today is ${today} (IST). Generate a morning investment brief.

═══ PORTFOLIO ═══
${buildPortfolioContext(portfolio)}

═══ INVESTMENT GOALS ═══
${buildGoalsContext(goals)}

═══ MARKET SNAPSHOT (pre-market / latest) ═══
${buildMarketContext(market)}

═══ RECENT NEWS (last 12 hours) ═══
${buildNewsContext(news, 15)}

${previousBrief ? `═══ YESTERDAY'S EVENING BRIEF SUMMARY ═══\n${previousBrief}\n` : ''}

Generate a morning brief with these sections:

## 🌅 Morning Brief — ${today}

### 📊 Market Outlook
(2-3 sentences on today's likely market direction based on global cues and news)

### ⚡ Today's Priority Actions
(Numbered list of 3-5 specific actions: which stocks to consider buying/selling/watching today, with reasoning and price levels)

### 🔍 Stocks to Watch
(2-3 stocks from the portfolio that need attention today with specific triggers)

### 🌍 Key Events Today
(Any scheduled events: results, RBI announcements, global data releases)

### ⚠️ Risks to Monitor
(Top 2-3 risk factors for today)

Be specific with stock names, price targets, and reasons. Keep it actionable for morning pre-market reading.`,
  };
}

/**
 * Evening brief prompt — recap of today + outlook for tomorrow.
 */
function eveningBriefPrompt({ portfolio, market, news, goals, morningBrief }) {
  const today = format(new Date(), 'EEEE, MMMM d, yyyy');

  return {
    system: SYSTEM_BASE,
    user: `Today is ${today} (IST). Generate an evening investment analysis brief.

═══ PORTFOLIO ═══
${buildPortfolioContext(portfolio)}

═══ INVESTMENT GOALS ═══
${buildGoalsContext(goals)}

═══ TODAY'S MARKET CLOSE ═══
${buildMarketContext(market)}

═══ TODAY'S NEWS ═══
${buildNewsContext(news, 20)}

${morningBrief ? `═══ THIS MORNING'S BRIEF ═══\n${morningBrief}\n` : ''}

Generate an evening brief with these sections:

## 🌙 Evening Brief — ${today}

### 📈 Market Recap
(Today's market performance: Nifty/Sensex movement, top sectors, breadth)

### 💼 Portfolio Performance Today
(How the portfolio moved today, top gainers/losers in holdings)

### 🔄 Action Review
(If morning brief was provided, did the market move as expected? What worked?)

### 🔮 Tomorrow's Outlook
(What to expect tomorrow based on global markets, upcoming events, technical levels)

### 📋 Action Plan for Tomorrow
(Specific buy/sell/hold recommendations for tomorrow with price levels and reasoning, mapped to user goals)

### 💡 Long-term Insights
(1-2 strategic observations relevant to the user's long-term goals)

Be analytical. Provide specific Nifty support/resistance levels. Map recommendations to user goals.`,
  };
}

/**
 * Portfolio analysis prompt — deep dive on demand.
 */
function portfolioAnalysisPrompt({ portfolio, market, goals }) {
  return {
    system: SYSTEM_BASE,
    user: `Perform a comprehensive portfolio analysis.

═══ PORTFOLIO ═══
${buildPortfolioContext(portfolio)}

═══ INVESTMENT GOALS ═══
${buildGoalsContext(goals)}

═══ CURRENT MARKET ═══
${buildMarketContext(market)}

Provide:

## 📊 Portfolio Health Report

### Overall Assessment
(Risk-adjusted performance, diversification score, goal alignment)

### Strengths
(What's working well in the portfolio)

### Weaknesses & Concerns
(Concentration risks, underperformers, goal misalignment)

### Rebalancing Recommendations
(Specific actions with allocation percentages)

### Stock-wise Verdict
For each equity holding, provide: KEEP / SELL / INCREASE / REDUCE with reasoning

### Goal Alignment Check
How well does the current portfolio serve each goal?`,
  };
}

/**
 * News sentiment analysis prompt.
 * Used to score and tag news articles.
 */
function newsSentimentPrompt(articles, holdingSymbols) {
  return {
    system: 'You are a financial news analyst. Analyze news for market sentiment and impact on specific stocks.',
    user: `Analyze these news articles and for each provide:
- sentiment: positive/negative/neutral
- impact_score: 0-10 (market impact severity)
- related_symbols: which stock tickers from this list are affected: ${holdingSymbols.join(', ')}

Articles:
${articles.slice(0, 10).map((a, i) => `${i + 1}. ${a.title}\n   ${(a.summary || '').slice(0, 200)}`).join('\n\n')}

Return a JSON array with fields: index, sentiment, impact_score, related_symbols`,
  };
}

/**
 * Goal setup assistance prompt — used during CLI setup.
 */
function goalSuggestionPrompt({ portfolio, userInput }) {
  return {
    system: SYSTEM_BASE,
    user: `Based on this portfolio and user input, suggest appropriate investment goals.

Portfolio:
${buildPortfolioContext(portfolio)}

User said: "${userInput}"

Suggest 2-3 specific, measurable investment goals in JSON format:
[
  {
    "type": "short_term" | "long_term",
    "title": "...",
    "description": "...",
    "target_amount": number or null,
    "target_date": "YYYY-MM-DD" or null,
    "risk_tolerance": "conservative" | "moderate" | "aggressive"
  }
]`,
  };
}

module.exports = {
  morningBriefPrompt,
  eveningBriefPrompt,
  portfolioAnalysisPrompt,
  newsSentimentPrompt,
  goalSuggestionPrompt,
  buildPortfolioContext,
  buildMarketContext,
  buildNewsContext,
  buildGoalsContext,
};
