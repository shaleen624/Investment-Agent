'use strict';

/**
 * Telegram notification channel.
 * Uses Telegraf — https://github.com/telegraf/telegraf
 *
 * Setup:
 *  1. Message @BotFather on Telegram, create a bot → get TELEGRAM_BOT_TOKEN
 *  2. Message your bot, then visit:
 *     https://api.telegram.org/bot<TOKEN>/getUpdates
 *     to find your chat_id → set TELEGRAM_CHAT_ID
 */

const logger    = require('../config/logger');
const { config } = require('../config');

let bot;
let isBotRunning = false;
let launchPromise = null;

function getBot() {
  if (bot) return bot;
  const { Telegraf } = require('telegraf');
  bot = new Telegraf(config.notifications.telegram.token);
  return bot;
}

/**
 * Send a text message to the configured chat.
 * Automatically splits messages > 4096 chars (Telegram limit).
 *
 * @param {string} text - Markdown formatted message
 * @param {string} chatId - optional override
 */
async function sendMessage(text, chatId = null) {
  const cfg = config.notifications.telegram;
  if (!cfg.enabled) throw new Error('Telegram not configured');

  const targetChatId = chatId || cfg.chatId;
  const b = getBot();

  // Split long messages
  const chunks = splitMessage(text, 4096);
  for (const chunk of chunks) {
    await b.telegram.sendMessage(targetChatId, chunk, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });
    if (chunks.length > 1) await new Promise(r => setTimeout(r, 500));
  }

  logger.info(`[Telegram] Message sent (${chunks.length} chunk(s))`);
}

/**
 * Send a brief as a nicely formatted Telegram message.
 */
async function sendBrief(content, type = 'morning') {
  const cfg = config.notifications.telegram;
  if (!cfg.enabled) {
    logger.warn('[Telegram] Not configured — skipping');
    return false;
  }

  try {
    await sendMessage(content, cfg.chatId);
    return true;
  } catch (err) {
    logger.error(`[Telegram] sendBrief failed: ${err.message}`);
    return false;
  }
}

/**
 * Start the Telegram bot to receive commands.
 * This allows users to interact with the agent via Telegram.
 */
function startBot(handlers = {}) {
  if (!config.notifications.telegram.token) {
    logger.warn('[Telegram] Bot token not set — skipping bot start');
    return Promise.resolve(false);
  }

  const b = getBot();

  b.start(ctx => ctx.reply(
    '👋 Investment Agent active!\n\n' +
    'Commands:\n' +
    '/brief – Get latest brief\n' +
    '/portfolio – Portfolio summary\n' +
    '/news – Top news\n' +
    '/analyze – Full portfolio analysis\n' +
    '/morning – Generate morning brief\n' +
    '/evening – Generate evening brief\n' +
    '/help – Show this menu'
  ));

  b.help(ctx => ctx.reply(
    'Investment Agent Commands:\n\n' +
    '/brief – Latest stored brief\n' +
    '/portfolio – Current portfolio summary\n' +
    '/news – Last 10 news headlines\n' +
    '/analyze – On-demand portfolio analysis\n' +
    '/morning – Generate morning brief now\n' +
    '/evening – Generate evening brief now'
  ));

  if (handlers.onBrief)    b.command('brief',    handlers.onBrief);
  if (handlers.onPortfolio)b.command('portfolio', handlers.onPortfolio);
  if (handlers.onNews)     b.command('news',      handlers.onNews);
  if (handlers.onAnalyze)  b.command('analyze',   handlers.onAnalyze);
  if (handlers.onMorning)  b.command('morning',   handlers.onMorning);
  if (handlers.onEvening)  b.command('evening',   handlers.onEvening);

  b.catch((err, ctx) => {
    logger.error(`[Telegram] Bot error: ${err.message}`);
    ctx.reply('⚠️ Something went wrong. Check agent logs.').catch(() => {});
  });

  launchPromise = b.launch({ dropPendingUpdates: true })
    .then(() => {
      isBotRunning = true;
      logger.info('[Telegram] Bot started and listening for commands');
    })
    .catch((err) => {
      isBotRunning = false;
      logger.error(`[Telegram] Bot startup failed: ${err.message}`);
    });

  // Graceful stop
  process.once('SIGINT',  () => {
    if (isBotRunning) b.stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    if (isBotRunning) b.stop('SIGTERM');
  });

  return launchPromise.then(() => isBotRunning);
}

function stopBot() {
  if (bot && isBotRunning) {
    bot.stop();
    isBotRunning = false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function splitMessage(text, maxLen = 4096) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let current  = '';

  for (const line of text.split('\n')) {
    if ((current + '\n' + line).length > maxLen) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = current ? current + '\n' + line : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

module.exports = { sendMessage, sendBrief, startBot, stopBot };
