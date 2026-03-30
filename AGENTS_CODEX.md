# Codex / ChatGPT Instructions: Investment Agent

## Purpose
Use this file as the authoritative project briefing when assisting on this repository. Optimize for correctness, minimal regressions, and incremental changes.

## Repository Overview
- Backend: Node.js (CommonJS), Express 5, SQLite (`better-sqlite3`)
- Frontend: Angular 21 standalone-component PWA (`pwa/`)
- Main launcher: `index.js`
- Daemon orchestrator: `src/agent/index.js`
- API server: `src/api/server.js` (base path `/api`)

## Architecture Map
- `src/config`: `.env` loading, typed config object, validation warnings
- `src/db`: DB singleton + schema bootstrap
- `src/api`: REST routes and auth middleware
- `src/portfolio`: holdings/goals/profile CRUD, portfolio summary/XIRR, import parsers
- `src/sources/market`: Yahoo/NSE/AlphaVantage with fallback
- `src/sources/news`: RSS + NewsAPI + cache
- `src/llm`: provider abstraction and fallback chain
- `src/analysis`: morning/evening brief generation + recommendation extraction
- `src/notifications`: Telegram, WhatsApp, Email + send logs
- `src/scheduler`: cron scheduling for brief jobs
- `pwa/src/app`: route pages + API/auth services + interceptors + guard

## Runtime Behavior
1. User authenticates and receives JWT.
2. PWA stores token in `localStorage` and sends `Authorization` via interceptor.
3. Protected API routes validate JWT + active session in `user_sessions`.
4. Brief jobs refresh market/news, score sentiment (LLM if available), generate brief, store brief, optionally send notifications.
5. Evening flow also extracts structured recommendations into DB.

## API Endpoints
Auth:
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/verify`

Status:
- `GET /api/status`

Portfolio:
- `GET /api/portfolio/summary`
- `GET /api/portfolio/holdings`
- `GET /api/portfolio/holdings/:id`
- `POST /api/portfolio/holdings`
- `PUT /api/portfolio/holdings/:id`
- `DELETE /api/portfolio/holdings/:id`
- `POST /api/portfolio/import/text`
- `POST /api/portfolio/import/file`
- `POST /api/portfolio/prices/refresh`
- `POST /api/portfolio/sync/:broker`

Goals:
- `GET /api/goals`
- `POST /api/goals`
- `PUT /api/goals/:id`
- `DELETE /api/goals/:id`

Briefs:
- `GET /api/briefs`
- `GET /api/briefs/latest`
- `GET /api/briefs/:id`
- `POST /api/briefs/generate`
- `GET /api/briefs/:id/recommendations`

Market:
- `GET /api/market/snapshot`
- `GET /api/market/snapshot/previous`
- `GET /api/market/snapshots`
- `POST /api/market/refresh`
- `GET /api/market/recommendations`

News:
- `GET /api/news`
- `POST /api/news/fetch`

Notifications:
- `POST /api/notifications/test`
- `POST /api/notifications/alert`
- `GET /api/notifications/log`
- `GET /api/notifications/profile`
- `PUT /api/notifications/profile`

## Frontend Feature Map
- `login`: login/register flow
- `dashboard`: portfolio summary + market + recs + top news
- `holdings`: CRUD + import text/file + refresh prices
- `briefs`: history + manual brief generation + recs per brief
- `goals`: CRUD goal management
- `market`: live snapshot refresh + news fetch/filter + recommendations
- `settings`: status, notification profile, test channels

## Database Context
Important tables include:
- `users`, `user_sessions`
- `holdings`, `transactions`
- `goals`
- `briefs`, `recommendations`
- `market_snapshots`, `news_cache`
- `notification_log`

## Commands
- `npm start` (backend + PWA concurrently)
- `npm run start:agent`
- `npm run start:pwa`
- `npm run setup`
- `npm run portfolio`
- `npm run goals`
- `npm run analyze`
- `npm run status`
- `npm run notify:test`

## Working Rules for Codex/ChatGPT
- Prefer small, targeted patches over broad rewrites.
- Keep backend in CommonJS and follow existing patterns.
- Preserve API contracts consumed by `ApiService`.
- Ensure user-scoped queries remain scoped by `user_id`.
- Update frontend service/types if backend response shapes change.

## Known Caveats
- `src/api/routes/auth.js` uses `run()`/`get()` in logout/verify without importing helpers.
- `src/portfolio/manager.js` references `user_profile` table that is not present in schema.
- `src/sources/market/index.js` uses `h.quantity` in price refresh but does not select `quantity` in query.
- Some endpoints are global rather than user-scoped.
