'use strict';

const path = require('path');
const fs   = require('fs');

// Load .env file
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  require('dotenv').config();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function get(key, defaultValue = undefined) {
  const val = process.env[key];
  if (val === undefined || val === '') return defaultValue;
  return val;
}

function getInt(key, defaultValue = 0) {
  const val = parseInt(get(key, String(defaultValue)), 10);
  return isNaN(val) ? defaultValue : val;
}

function getBool(key, defaultValue = false) {
  const val = get(key, String(defaultValue)).toLowerCase();
  return val === 'true' || val === '1' || val === 'yes';
}

function getList(key, defaultValue = []) {
  const val = get(key);
  if (!val) return defaultValue;
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

// ── Config Object ─────────────────────────────────────────────────────────────

const config = {
  // ── LLM ───────────────────────────────────────────────────────────────────
  llm: {
    // "claude" | "openai" | "kimi" | "deepseek" | "none"
    provider: get('LLM_PROVIDER', 'claude'),

    claude: {
      apiKey: get('ANTHROPIC_API_KEY'),
      model:  get('CLAUDE_MODEL', 'claude-sonnet-4-6'),
    },
    openai: {
      apiKey: get('OPENAI_API_KEY'),
      model:  get('OPENAI_MODEL', 'gpt-4o'),
    },

    // NVIDIA NIM — hosts Kimi K2 and DeepSeek V3 (single key for both)
    nvidia: {
      apiKey:         get('NVIDIA_API_KEY'),
      kimiModel:      get('KIMI_MODEL',     'moonshotai/kimi-k2.5'),
      deepseekModel:  get('DEEPSEEK_MODEL', 'deepseek-ai/deepseek-v3.2'),
      // DeepSeek extended thinking (chain-of-thought). Disable to reduce latency.
      deepseekThinking: getBool('DEEPSEEK_THINKING', true),
    },

    // OpenRouter — 100+ models from one API key
    openrouter: {
      apiKey: get('OPENROUTER_API_KEY'),
      // Default model (can be overridden per-request or via PUT /api/status/llm)
      model:  get('OPENROUTER_MODEL', 'deepseek/deepseek-r1'),
    },
  },

  // ── Market Data ───────────────────────────────────────────────────────────
  market: {
    alphaVantage: {
      apiKey: get('ALPHA_VANTAGE_API_KEY'),
      enabled: !!get('ALPHA_VANTAGE_API_KEY'),
    },
    // Yahoo Finance is always available (no key needed for basic use)
    yahooFinance: { enabled: true },
    // NSE India unofficial API
    nse: { enabled: true, baseUrl: 'https://www.nseindia.com' },
  },

  // ── News ──────────────────────────────────────────────────────────────────
  news: {
    newsApi: {
      apiKey:  get('NEWS_API_KEY'),
      enabled: !!get('NEWS_API_KEY'),
    },
    rss: {
      enabled: true,
      feeds: [
        { name: 'Economic Times Markets', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms' },
        { name: 'Moneycontrol Markets',   url: 'https://www.moneycontrol.com/rss/marketreports.xml' },
        { name: 'LiveMint Markets',       url: 'https://www.livemint.com/rss/markets' },
        { name: 'Business Standard',      url: 'https://www.business-standard.com/rss/home_page_top_stories.rss' },
        { name: 'Reuters India',          url: 'https://feeds.reuters.com/reuters/INbusinessNews' },
        { name: 'Bloomberg Quint',        url: 'https://www.ndtvprofit.com/feeds/rss/business' },
      ],
    },
  },

  // ── Brokers ───────────────────────────────────────────────────────────────
  brokers: {
    kite: {
      apiKey:      get('KITE_API_KEY'),
      apiSecret:   get('KITE_API_SECRET'),
      accessToken: get('KITE_ACCESS_TOKEN'),
      enabled:     !!(get('KITE_API_KEY') && get('KITE_ACCESS_TOKEN')),
    },
    groww: {
      apiKey:  get('GROWW_API_KEY'),
      enabled: !!get('GROWW_API_KEY'),
    },
  },

  // ── Notifications ─────────────────────────────────────────────────────────
  notifications: {
    channels: getList('NOTIFICATION_CHANNELS', ['telegram']),
    telegram: {
      token:   get('TELEGRAM_BOT_TOKEN'),
      chatId:  get('TELEGRAM_CHAT_ID'),
      enabled: !!(get('TELEGRAM_BOT_TOKEN') && get('TELEGRAM_CHAT_ID')),
    },
    email: {
      host:    get('EMAIL_HOST', 'smtp.gmail.com'),
      port:    getInt('EMAIL_PORT', 587),
      secure:  getBool('EMAIL_SECURE', false),
      user:    get('EMAIL_USER'),
      pass:    get('EMAIL_PASS'),
      from:    get('EMAIL_FROM'),
      to:      get('EMAIL_TO'),
      enabled: !!(get('EMAIL_USER') && get('EMAIL_PASS') && get('EMAIL_TO')),
    },
    whatsapp: {
      recipient: get('WHATSAPP_RECIPIENT'),
      enabled:   getBool('WHATSAPP_ENABLED', false),
    },
  },

  // ── Scheduler ─────────────────────────────────────────────────────────────
  scheduler: {
    morningTime: get('MORNING_BRIEF_TIME', '08:00'),
    eveningTime: get('EVENING_BRIEF_TIME', '20:00'),
    timezone:    get('TIMEZONE', 'Asia/Kolkata'),
  },

  // ── Storage ───────────────────────────────────────────────────────────────
  storage: {
    dbPath:      path.resolve(get('DB_PATH', './data/portfolio.db')),
    uploadsPath: path.resolve(get('UPLOADS_PATH', './uploads')),
    logsPath:    path.resolve(get('LOGS_PATH', './logs')),
  },

  // ── Logging ───────────────────────────────────────────────────────────────
  logging: {
    level: get('LOG_LEVEL', 'info'),
  },
};

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Returns an array of warning messages for missing but recommended config.
 * Does NOT throw — the agent can still run in degraded mode.
 */
function validate() {
  const warnings = [];

  if (config.llm.provider === 'claude' && !config.llm.claude.apiKey) {
    warnings.push('ANTHROPIC_API_KEY not set — LLM features disabled');
  }
  if (config.llm.provider === 'openai' && !config.llm.openai.apiKey) {
    warnings.push('OPENAI_API_KEY not set — LLM features disabled');
  }
  if (['kimi', 'deepseek'].includes(config.llm.provider) && !config.llm.nvidia.apiKey) {
    warnings.push(`NVIDIA_API_KEY not set — ${config.llm.provider} provider disabled`);
  }
  if (!config.market.alphaVantage.enabled) {
    warnings.push('ALPHA_VANTAGE_API_KEY not set — some market data unavailable');
  }
  if (!config.news.newsApi.enabled) {
    warnings.push('NEWS_API_KEY not set — falling back to RSS only');
  }

  const activeChannels = config.notifications.channels;
  if (activeChannels.includes('telegram') && !config.notifications.telegram.enabled) {
    warnings.push('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing — Telegram disabled');
  }
  if (activeChannels.includes('email') && !config.notifications.email.enabled) {
    warnings.push('Email credentials missing — Email notifications disabled');
  }
  if (activeChannels.includes('whatsapp') && !config.notifications.whatsapp.enabled) {
    warnings.push('WHATSAPP_ENABLED=false or recipient missing — WhatsApp disabled');
  }

  return warnings;
}

module.exports = { config, validate };
