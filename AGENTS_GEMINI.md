# Gemini Instructions: Investment Agent

## Mission
Work as a precise coding assistant for this repository. Preserve existing behavior unless explicitly asked to change it. Favor small, testable edits.

## Stack and Runtime
- Backend: Node.js (CommonJS), Express 5, SQLite (`better-sqlite3`)
- Frontend: Angular 21 PWA (`pwa/`)
- Entry point: `index.js`
- Daemon orchestrator: `src/agent/index.js`
- API base: `/api` from `src/api/server.js`

## High-Level Architecture
- `src/config`: env loading + config object + validation warnings
- `src/db`: SQLite connection and schema bootstrap
- `src/portfolio`: holdings/goals/profile CRUD + summary/XIRR + imports
- `src/sources/market`: quote/snapshot providers with fallback
- `src/sources/news`: RSS + NewsAPI fetch/cache
- `src/llm`: provider abstraction (`claude|kimi|deepseek|openai|none`) + prompts
- `src/analysis`: brief generation, sentiment scoring, recommendation extraction
- `src/notifications`: Telegram/WhatsApp/Email send + log
- `src/scheduler`: morning/evening cron jobs
- `src/api`: REST routes consumed by Angular PWA

## End-to-End Flow
1. User authenticates (`/api/auth/login` or `/api/auth/register`), receives JWT.
2. PWA stores token in `localStorage.auth_token`; interceptor sends `Authorization: Bearer ...`.
3. Protected endpoints use `authenticateToken` middleware + active session check in `user_sessions`.
4. Brief generation pipeline:
   - refresh prices + capture market snapshot
   - fetch/cache news, score sentiment (if LLM available)
   - build context from holdings/goals/news/snapshots
   - generate brief via LLM or fallback text
   - save brief, optionally send notifications, save recommendation extraction (evening)

## API Contracts
Auth:
- `POST /api/auth/register` body `{ username, password, email? }`
- `POST /api/auth/login` body `{ username, password }`
- `POST /api/auth/logout`
- `GET /api/auth/verify`

Status:
- `GET /api/status` returns LLM/notifications/schedule/portfolio/goals/warnings/brief timestamps

Portfolio (auth required except noted):
- `GET /api/portfolio/summary`
- `GET /api/portfolio/holdings?type=...`
- `GET /api/portfolio/holdings/:id`
- `POST /api/portfolio/holdings`
- `PUT /api/portfolio/holdings/:id`
- `DELETE /api/portfolio/holdings/:id`
- `POST /api/portfolio/import/text` body `{ text }`
- `POST /api/portfolio/import/file` multipart `file`
- `POST /api/portfolio/prices/refresh` (currently no auth middleware)
- `POST /api/portfolio/sync/:broker` (`kite|groww`)

Goals (auth required):
- `GET /api/goals?all=true|false`
- `POST /api/goals`
- `PUT /api/goals/:id`
- `DELETE /api/goals/:id` (soft delete via `is_active=0`)

Briefs (auth required):
- `GET /api/briefs?type=morning|evening&limit=10`
- `GET /api/briefs/latest?type=morning|evening`
- `GET /api/briefs/:id`
- `POST /api/briefs/generate` body `{ type, send }`
- `GET /api/briefs/:id/recommendations`

Market:
- `GET /api/market/snapshot`
- `GET /api/market/snapshot/previous`
- `GET /api/market/snapshots?days=7`
- `POST /api/market/refresh`
- `GET /api/market/recommendations?limit=10`

News:
- `GET /api/news?limit=20&hours=24&symbol=RELIANCE`
- `POST /api/news/fetch` body `{ symbol? }`

Notifications:
- `POST /api/notifications/test`
- `POST /api/notifications/alert` body `{ message }`
- `GET /api/notifications/log?limit=50`
- `GET /api/notifications/profile`
- `PUT /api/notifications/profile`

## PWA Route-to-API Mapping
- `login`: `login/register/verify/logout`
- `dashboard`: summary + market snapshot + recommendations + news
- `holdings`: holdings CRUD, import text/file, refresh prices
- `briefs`: list briefs, generate brief, recommendations for selected brief
- `goals`: goals CRUD
- `market`: refresh market, fetch news, read recs/news/snapshot
- `settings`: status + profile update + notification tests

## Key Data Model (SQLite)
Core tables: `users`, `user_sessions`, `holdings`, `transactions`, `goals`, `briefs`, `market_snapshots`, `news_cache`, `recommendations`, `notification_log`.

## Commands
- Full app: `npm start` (backend + PWA)
- Backend only: `npm run start:agent`
- PWA only: `npm run start:pwa`
- Setup/ops: `npm run setup`, `npm run portfolio`, `npm run goals`, `npm run analyze`, `npm run status`, `npm run notify:test`

## Coding Guidance
- Keep CommonJS style in backend and Angular standalone style in PWA.
- Respect user scoping (`user_id`) in any new query touching holdings/goals/briefs/recommendations.
- Reuse `ApiService` for new UI data access.
- Preserve auth interceptor and token/session semantics.

## Known Caveats (Important)
- `src/api/routes/auth.js` uses `run()`/`get()` in `/logout` and `/verify` without importing them.
- `src/portfolio/manager.js` uses `user_profile`, but schema does not define `user_profile` table.
- `src/sources/market/index.js` computes `currentValue` with `h.quantity`, but `quantity` is not selected in `updateAllPrices()` query.
- Some routes are not user-scoped (`/api/market/recommendations`, `/api/news/fetch` default symbol discovery).

When modifying related areas, fix cautiously and maintain backwards compatibility.
