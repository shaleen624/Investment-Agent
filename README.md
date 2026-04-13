# Investment Agent

An AI-powered portfolio analysis agent for Indian markets. Tracks your investments across stocks, mutual funds, ETFs, FDs, bonds, and more — then delivers intelligent morning and evening briefs via Telegram, WhatsApp, and Email.
This app will tell you action items on your stocks/ holding based on your goal and current market state, so that your goals are achived and holding are always optimal. 

## Features

- **Multi-source portfolio ingestion** — Kite API, Groww (CSV export), CDSL/NSDL CAS PDF, generic CSV/text
- **Live market data** — Yahoo Finance (free), NSE India API (free), Alpha Vantage (free tier)
- **News aggregation** — RSS feeds (Economic Times, Moneycontrol, LiveMint, Reuters) + NewsAPI
- **AI-powered analysis** — Claude (Anthropic) primary, OpenAI fallback, fully customizable
- **Morning brief** — Market outlook, today's action plan, key events, risks
- **Evening brief** — Day recap, portfolio P&L, tomorrow's outlook + action plan
- **Three notification channels** — Telegram bot (interactive), WhatsApp, Email
- **Goal-aware advice** — Short-term and long-term goals shape every recommendation
- **Indian market focus** — NSE/BSE equities, Indian MFs, US stock awareness
- **Free to run** — SQLite database, free-tier APIs, no cloud costs

---

## Quick Start

### 1. Install dependencies

```bash
PUPPETEER_SKIP_DOWNLOAD=true npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your API keys
```

Minimum required for AI briefs: `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`)

### 3. Run setup wizard

```bash
node index.js setup
```

This walks you through:
- Your profile (name, email, notification IDs)
- Brief schedule (morning/evening times in IST)
- Initial portfolio import (CSV, PDF, or manual text)

### 4. Set your goals

```bash
node index.js goals
```

### 5. Start the agent

```bash
node index.js start
```

The agent runs silently, delivering briefs at your scheduled times.

---

## Commands

| Command | Description |
|---------|-------------|
| `node index.js` | Start agent (scheduler + Telegram bot) |
| `node index.js setup` | First-time setup wizard |
| `node index.js portfolio` | Manage portfolio interactively |
| `node index.js goals` | Manage investment goals |
| `node index.js brief morning` | Generate + send morning brief now |
| `node index.js brief evening` | Generate + send evening brief now |
| `node index.js analyze` | Full on-demand portfolio analysis |
| `node index.js status` | Show config and portfolio status |
| `node index.js notify test` | Test all notification channels |
| `node index.js prices refresh` | Refresh all holding prices |

---

## Notification Setup

### Telegram (recommended)
1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → get token
2. Message your new bot → visit `https://api.telegram.org/bot<TOKEN>/getUpdates` → find your `chat_id`
3. Set in `.env`:
   ```
   TELEGRAM_BOT_TOKEN=your_token
   TELEGRAM_CHAT_ID=your_chat_id
   ```

**Interactive Telegram commands** (once agent is running):
- `/brief` — Latest brief
- `/portfolio` — Portfolio summary
- `/news` — Top 10 news headlines
- `/analyze` — Full analysis
- `/morning` / `/evening` — Generate brief on demand

### Email
Any SMTP provider works. For Gmail:
1. Enable 2FA on your Google account
2. Generate an [App Password](https://myaccount.google.com/apppasswords)
3. Set in `.env`:
   ```
   EMAIL_HOST=smtp.gmail.com
   EMAIL_PORT=587
   EMAIL_USER=you@gmail.com
   EMAIL_PASS=your_app_password
   EMAIL_TO=you@gmail.com
   ```

### WhatsApp
Uses [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) (open source, free):
1. Set `WHATSAPP_ENABLED=true` and `WHATSAPP_RECIPIENT=91XXXXXXXXXX` in `.env`
2. On first run, scan the QR code shown in terminal
3. Session is saved — no QR needed after that

---

## Broker API Setup

### Zerodha Kite
1. Enable [Kite Connect API](https://kite.trade/) (₹2000/month)
2. Set `KITE_API_KEY` + `KITE_API_SECRET` in `.env`
3. Daily auth flow: open login URL → get `request_token` → run `generateSession()`
4. Set `KITE_ACCESS_TOKEN` (valid for 1 trading day)

### Groww
Groww Trade API is available for supported accounts:
1. Generate a Groww API access token from the Groww Trade API portal.
2. Set `GROWW_API_KEY` in `.env`.
3. Run `node index.js portfolio` → `Sync from broker` → `Groww`.

Fallback (works for all users): export portfolio CSV from app and import via `node index.js portfolio`.

---

## Portfolio Input Formats

### CSV — Kite Holdings Export
Columns: `Tradingsymbol`, `Average price`, `Quantity`, `Exchange`

### CSV — Groww Portfolio Export
Columns: `Symbol`, `Avg. Buy Price`, `Shares`, `Exchange`

### PDF — CDSL/NSDL CAS Statement
Upload the full CAS PDF. Holdings and folios are auto-extracted.

### Plain Text
```
RELIANCE 100 @ 2450.50
TCS 50 shares 3200
HDFC Bank 200 @ 1600
HDFC Flexi Cap MF - 1250.345 units, NAV 48.23, folio 123456
```

---

## LLM Configuration

Four providers supported. Set `LLM_PROVIDER` to one — if it fails, the agent auto-falls back through the chain: **claude → kimi → deepseek → openai**.

```env
# ── Option 1: Claude (Anthropic) ──────────────────────
LLM_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6        # or claude-opus-4-6

# ── Option 2: Kimi K2 (Moonshot AI via NVIDIA NIM) ────
LLM_PROVIDER=kimi
NVIDIA_API_KEY=nvapi-...
KIMI_MODEL=moonshotai/kimi-k2.5       # 128k context, strong reasoning

# ── Option 3: DeepSeek V3 (via NVIDIA NIM) ────────────
LLM_PROVIDER=deepseek
NVIDIA_API_KEY=nvapi-...
DEEPSEEK_MODEL=deepseek-ai/deepseek-v3.2
DEEPSEEK_THINKING=true                # enables chain-of-thought (slower but deeper)

# ── Option 4: OpenAI ──────────────────────────────────
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o

# ── Disable LLM (text-only fallback briefs) ───────────
LLM_PROVIDER=none
```

> **NVIDIA NIM** — one `NVIDIA_API_KEY` covers both Kimi K2 and DeepSeek.
> Get yours free at [build.nvidia.com](https://build.nvidia.com).
>
> **DeepSeek thinking mode** — when `DEEPSEEK_THINKING=true`, the model's chain-of-thought
> is logged at debug level and stripped from the final brief output.

---

## Architecture

```
investment-agent/
├── src/
│   ├── config/         Config loader + logger
│   ├── db/             SQLite schema + helpers
│   ├── sources/
│   │   ├── brokers/    Kite, Groww adapters
│   │   ├── market/     Yahoo Finance, NSE, Alpha Vantage
│   │   └── news/       RSS feeds, NewsAPI
│   ├── portfolio/      Parser, manager (CRUD + P&L + XIRR)
│   ├── llm/            Claude/OpenAI abstraction + prompts
│   ├── analysis/       Brief generation + recommendations
│   ├── notifications/  Telegram, WhatsApp, Email
│   ├── scheduler/      Cron jobs (morning/evening)
│   ├── cli/            Setup wizard, portfolio CLI, goals CLI
│   └── agent/          Main orchestrator (daemon mode)
├── data/               SQLite DB (gitignored)
├── uploads/            PDF/CSV uploads (gitignored)
├── logs/               Log files (gitignored)
├── .env.example        Config template
└── index.js            Entry point
```

---

## Deployment

### Docker (recommended)

```bash
# 1. Configure
cp .env.example .env
# Edit .env with your API keys

# 2. Build and start
docker compose up -d

# 3. View logs
docker compose logs -f

# 4. Run CLI commands inside the container
docker compose exec investment-agent node index.js portfolio
docker compose exec investment-agent node index.js goals
docker compose exec investment-agent node index.js brief morning
docker compose exec investment-agent node index.js status
```

**WhatsApp QR code (first run):**
```bash
# Attach to see the QR code in terminal
docker compose logs -f
# Scan with WhatsApp → Linked Devices → Link a Device
# Session is saved in .wwebjs_auth/ — no re-scan needed on restart
```

**Volumes created automatically:**
| Path | Contents |
|------|---------|
| `./data/` | SQLite database (portfolio, briefs, goals) |
| `./logs/` | Agent and error logs |
| `./uploads/` | PDF/CSV files for import |
| `./.wwebjs_auth/` | WhatsApp session (persist across restarts) |

### VPS without Docker

```bash
# Using PM2 for process management
npm install -g pm2
PUPPETEER_SKIP_DOWNLOAD=true npm install
pm2 start index.js --name investment-agent
pm2 save
pm2 startup
```

Or with systemd:
```bash
# /etc/systemd/system/investment-agent.service
[Unit]
Description=Investment Agent
After=network.target

[Service]
WorkingDirectory=/path/to/investment-agent
ExecStart=/usr/bin/node index.js
Restart=always
User=ubuntu
Environment=NODE_ENV=production
Environment=PUPPETEER_SKIP_DOWNLOAD=true

[Install]
WantedBy=multi-user.target
```

---

## Roadmap

- [ ] Angular PWA frontend
- [ ] Groww official API integration (when available)
- [ ] CDSL/NSDL direct API for auto-portfolio sync
- [ ] Options portfolio tracking
- [ ] Tax P&L calculation (STCG/LTCG)
- [ ] SIP tracking and reminders
- [x] Portfolio rebalancing calculator
- [ ] Multi-user support
