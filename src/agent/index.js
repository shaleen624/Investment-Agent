'use strict';

/**
 * Main Agent — orchestrates all modules in silent daemon mode.
 *
 * Responsibilities:
 *  - Start the scheduler (morning + evening briefs)
 *  - Start the Telegram bot (interactive commands)
 *  - Initialize WhatsApp client (if enabled)
 *  - Handle graceful shutdown
 */

const logger    = require('../config/logger');
const { config, validate } = require('../config');
const scheduler = require('../scheduler');
const apiServer = require('../api/server');
const telegram  = require('../notifications/telegram');
const whatsapp  = require('../notifications/whatsapp');
const analysis  = require('../analysis/engine');
const portfolio = require('../portfolio/manager');
const market    = require('../sources/market');
const news      = require('../sources/news');
const { getDb } = require('../db');
const llm       = require('../llm/provider');

// ── Telegram bot command handlers ─────────────────────────────────────────────

function getTelegramHandlers() {
  return {
    onBrief: async (ctx) => {
      await ctx.reply('Fetching latest brief...');
      const brief = analysis.getLatestBrief('evening') || analysis.getLatestBrief('morning');
      if (!brief) {
        return ctx.reply('No brief available yet. One will be sent at your scheduled time.');
      }
      await telegram.sendMessage(brief.content, ctx.chat.id.toString());
    },

    onPortfolio: async (ctx) => {
      const summary = portfolio.getPortfolioSummary();
      if (!summary) return ctx.reply('No portfolio data. Add holdings via CLI: node index.js portfolio');

      const pnlSign = summary.unrealizedPnl >= 0 ? '+' : '';
      const msg = [
        `*Portfolio Summary*`,
        `Invested: ₹${summary.totalInvested.toLocaleString('en-IN')}`,
        `Current:  ₹${summary.totalCurrent.toLocaleString('en-IN')}`,
        `P&L:      ₹${pnlSign}${summary.unrealizedPnl.toLocaleString('en-IN')} (${pnlSign}${summary.pnlPercent.toFixed(2)}%)`,
        `Holdings: ${summary.holdingsCount}`,
      ].join('\n');
      ctx.reply(msg, { parse_mode: 'Markdown' });
    },

    onNews: async (ctx) => {
      await ctx.reply('Fetching latest news...');
      const topNews = news.getTopNews(10, 12);
      if (!topNews.length) {
        return ctx.reply('No recent news cached. Fetch will happen at next brief.');
      }
      const msg = '*Top Market News*\n\n' +
        topNews.slice(0, 10).map((n, i) =>
          `${i + 1}. *${n.source}*: ${n.title}`
        ).join('\n\n');
      ctx.reply(msg, { parse_mode: 'Markdown', disable_web_page_preview: true });
    },

    onAnalyze: async (ctx) => {
      await ctx.reply('🔍 Running full portfolio analysis... (this may take 30-60 seconds)');
      try {
        const result = await analysis.analyzePortfolio();
        await telegram.sendMessage(result, ctx.chat.id.toString());
      } catch (err) {
        ctx.reply(`Analysis failed: ${err.message}`);
      }
    },

    onMorning: async (ctx) => {
      await ctx.reply('🌅 Generating morning brief...');
      try {
        const { content } = await analysis.generateMorningBrief();
        await telegram.sendMessage(content, ctx.chat.id.toString());
      } catch (err) {
        ctx.reply(`Morning brief failed: ${err.message}`);
      }
    },

    onEvening: async (ctx) => {
      await ctx.reply('🌙 Generating evening brief...');
      try {
        const { content } = await analysis.generateEveningBrief();
        await telegram.sendMessage(content, ctx.chat.id.toString());
      } catch (err) {
        ctx.reply(`Evening brief failed: ${err.message}`);
      }
    },
  };
}

// ── Agent startup ─────────────────────────────────────────────────────────────

async function start() {
  logger.info('=== Investment Agent Starting ===');

  // 1. Validate config
  const warnings = validate();
  if (warnings.length) {
    warnings.forEach(w => logger.warn(`[Config] ${w}`));
  }

  // 2. Initialize DB
  getDb();
  logger.info('[Agent] Database initialized');

  // 2b. Restore saved LLM provider preference (persisted by user via nav selector)
  try {
    const savedProfile = portfolio.getProfile();
    if (savedProfile?.default_llm_provider) {
      llm.setProviderOverride(savedProfile.default_llm_provider, savedProfile.default_llm_model || null);
      logger.info(`[Agent] Restored LLM override: ${savedProfile.default_llm_provider}${savedProfile.default_llm_model ? ' / ' + savedProfile.default_llm_model : ''}`);
    }
  } catch (e) {
    logger.debug(`[Agent] Could not restore LLM preference: ${e.message}`);
  }

  // 3. Start REST API server
  await apiServer.start();

  // 4. Start scheduler
  const { morningTime, eveningTime, timezone } = scheduler.start();
  logger.info(`[Agent] Scheduler started — Morning: ${morningTime}, Evening: ${eveningTime} (${timezone})`);

  // 4. Start Telegram bot (if configured)
  if (config.notifications.telegram.enabled) {
    const started = await telegram.startBot(getTelegramHandlers());
    if (started) {
      logger.info('[Agent] Telegram bot started');
    } else {
      logger.warn('[Agent] Telegram bot unavailable; continuing without Telegram commands');
    }
  } else {
    logger.info('[Agent] Telegram not configured — bot not started');
  }

  // 5. Initialize WhatsApp (if enabled)
  if (config.notifications.whatsapp.enabled) {
    logger.info('[Agent] Initializing WhatsApp (check terminal for QR code on first run)...');
    await whatsapp.initialize(() => {
      logger.info('[Agent] WhatsApp connected');
    });
  }

  // 6. Warm up market snapshot only in production, once per IST day.
  if (process.env.NODE_ENV === 'production') {
    setImmediate(async () => {
      try {
        const today = market.getCurrentIstDate();
        const latest = market.getLatestSnapshot();
        if (latest?.date === today) {
          logger.info('[Agent] Market warmup skipped (today snapshot already exists)');
          return;
        }

        await market.captureMarketSnapshot();
        logger.info('[Agent] Initial market snapshot captured');
      } catch (e) {
        logger.debug(`[Agent] Market warmup: ${e.message}`);
      }
    });
  } else {
    logger.info('[Agent] Market warmup skipped (non-production environment)');
  }

  logger.info('=== Investment Agent Running ===');
  logNextBriefTimes();

  // 7. Graceful shutdown
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);
}

async function shutdown() {
  logger.info('[Agent] Shutting down...');
  scheduler.stop();
  telegram.stopBot();
  await whatsapp.destroy();
  const { close } = require('../db');
  close();
  logger.info('[Agent] Shutdown complete');
  process.exit(0);
}

function logNextBriefTimes() {
  const profile     = portfolio.getProfile();
  const morningTime = profile?.morning_time || config.scheduler.morningTime;
  const eveningTime = profile?.evening_time || config.scheduler.eveningTime;
  logger.info(`[Agent] Next morning brief: ${morningTime} IST`);
  logger.info(`[Agent] Next evening brief: ${eveningTime} IST`);
}

module.exports = { start, shutdown };
