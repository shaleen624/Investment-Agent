# Copilot Instructions: Investment Agent

## What This Repo Is
AI-powered investment assistant focused on Indian markets, with:
- Node.js + Express backend
- Angular PWA frontend
- SQLite persistence
- Scheduled brief generation and multi-channel notifications

## Core Entry Points
- CLI/launcher: `index.js`
- Agent orchestrator: `src/agent/index.js`
- REST API: `src/api/server.js`
- Frontend API client: `pwa/src/app/core/services/api.service.ts`

## Backend Module Layout
- `src/config`: config/env parsing + warnings
- `src/db`: SQLite bootstrap and query helpers
- `src/api`: route modules + auth middleware
- `src/portfolio`: holdings/goals/profile/analytics/parsing
- `src/sources`: market/news/broker adapters
- `src/analysis`: brief generation and recommendation extraction
- `src/llm`: provider abstraction and fallback chain
- `src/notifications`: Telegram/WhatsApp/Email integrations
- `src/scheduler`: cron jobs for morning/evening briefs

## Frontend Module Layout
- `pwa/src/app/pages/*`: login, dashboard, holdings, briefs, goals, market, settings
- `pwa/src/app/core/services/*`: API + auth service
- `pwa/src/app/core/interceptors/*`: auth token attach + 401 handling
- `pwa/src/app/core/guards/auth.guard.ts`: route guard
- `pwa/proxy.conf.json`: `/api` -> `http://localhost:3000`

## Functional Flows
Authentication:
- Register/login returns JWT and stores active session in DB.
- JWT added to outgoing requests by auth interceptor.
- Protected routes validate token and active session row.

Portfolio:
- CRUD holdings + import from text/file (CSV/PDF/TXT/XLSX) + optional broker sync.
- Price refresh updates P&L/current values from market providers.

Analysis:
- Morning/evening generation refreshes market + news, then prompts LLM.
- Saves briefs to DB; evening flow extracts recommendations from brief text.
- Fallback briefs generated when LLM unavailable.

Notifications:
- Sends briefs/alerts across configured channels.
- Every attempt logged in `notification_log`.

## REST Endpoints (Canonical)
- Auth: `/api/auth/{register,login,logout,verify}`
- Status: `/api/status`
- Portfolio:
  - `/api/portfolio/summary`
  - `/api/portfolio/holdings`
  - `/api/portfolio/holdings/:id`
  - `/api/portfolio/import/text`
  - `/api/portfolio/import/file`
  - `/api/portfolio/prices/refresh`
  - `/api/portfolio/sync/:broker`
- Goals: `/api/goals`, `/api/goals/:id`
- Briefs:
  - `/api/briefs`
  - `/api/briefs/latest`
  - `/api/briefs/:id`
  - `/api/briefs/generate`
  - `/api/briefs/:id/recommendations`
- Market:
  - `/api/market/snapshot`
  - `/api/market/snapshot/previous`
  - `/api/market/snapshots`
  - `/api/market/refresh`
  - `/api/market/recommendations`
- News: `/api/news`, `/api/news/fetch`
- Notifications:
  - `/api/notifications/test`
  - `/api/notifications/alert`
  - `/api/notifications/log`
  - `/api/notifications/profile`

## Data Model Essentials
Primary tables:
- `users`, `user_sessions`
- `holdings`, `transactions`
- `goals`
- `briefs`, `recommendations`
- `market_snapshots`, `news_cache`
- `notification_log`

## Dev Commands
- `npm start` (backend + PWA)
- `npm run start:agent` (backend only)
- `npm run start:pwa` (frontend only)
- `npm run setup`, `npm run portfolio`, `npm run goals`
- `npm run analyze`, `npm run status`, `npm run notify:test`

## Editing Expectations for Copilot
- Keep backend in CommonJS syntax.
- Keep Angular pages standalone and signal-driven.
- Do not break existing endpoint shapes used by `ApiService`.
- Prefer incremental changes over broad refactors.
- Ensure user-specific data remains scoped by `user_id`.

## Important Caveats to Remember
- `src/api/routes/auth.js`: missing DB helper imports for `run/get` in logout/verify.
- `src/portfolio/manager.js`: uses `user_profile` table not defined in schema.
- `src/sources/market/index.js`: price refresh uses `h.quantity` but query does not select `quantity`.
- Some endpoints return global data rather than per-user data.
