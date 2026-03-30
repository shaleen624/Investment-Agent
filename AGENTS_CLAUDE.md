# Claude Instructions: Investment Agent

## Objective
Act as a senior collaborator on this codebase. Prefer minimal, safe diffs that preserve existing behavior and data integrity.

## Project Snapshot
- Monorepo with:
  - Node/Express backend at repo root (`src/`)
  - Angular 21 PWA at `pwa/`
- Persistent storage: SQLite (`data/portfolio.db`)
- Main process entry: `index.js`
- Agent daemon startup: `src/agent/index.js`

## System Architecture
- API server (`src/api/server.js`) mounts:
  - `/api/auth`, `/api/status`, `/api/portfolio`, `/api/goals`, `/api/briefs`, `/api/market`, `/api/news`, `/api/notifications`
- Domain modules:
  - Portfolio domain: `src/portfolio/manager.js`, `src/portfolio/parser.js`
  - Analysis domain: `src/analysis/engine.js`
  - Data providers: `src/sources/market/*`, `src/sources/news/*`, `src/sources/brokers/*`
  - LLM abstraction/fallback: `src/llm/provider.js`
  - Notifications: `src/notifications/*`
  - Scheduling: `src/scheduler/index.js`

## LLM and Fallback Behavior
- Configured with `LLM_PROVIDER`.
- Fallback chain in provider layer: `claude -> kimi -> deepseek -> openai`.
- If no provider available, analysis engine generates fallback plaintext briefs.

## API Endpoint Inventory
Auth:
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/verify`

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

## Frontend Behavior Map
- Auth/session: `AuthService`, `auth.interceptor.ts`, `error.interceptor.ts`, `auth.guard.ts`
- API client: `pwa/src/app/core/services/api.service.ts`
- Pages:
  - `dashboard`: summary/market/recs/news
  - `holdings`: CRUD + import + price refresh
  - `briefs`: history + generate + recommendation view
  - `goals`: CRUD
  - `market`: snapshot + news fetch + recommendations
  - `settings`: status + profile + notification tests

## Database Context
Schema bootstrapped from `src/db/schema.js`. Important tables include:
- `users`, `user_sessions`
- `holdings`, `transactions`
- `goals`
- `briefs`, `recommendations`
- `market_snapshots`, `news_cache`
- `notification_log`

## Runtime Commands
- `npm start` to run backend and PWA together
- `npm run start:agent` backend only
- `npm run start:pwa` Angular dev server only
- CLI utilities: `setup`, `portfolio`, `goals`, `analyze`, `status`, `notify:test`

## Collaboration Rules for Claude
- Keep edits localized and coherent with existing code style.
- Use strict user scoping for data reads/writes where applicable.
- Avoid changing API payload shapes unless requested.
- When adding endpoints, update both backend route handlers and `ApiService`.
- When adding UI features, wire to existing signals/computed patterns.

## Known Implementation Risks
- `auth.js` references `run/get` without importing from DB helper.
- `manager.js` references `user_profile` table that is absent from schema.
- `market/index.js` price refresh query omits `quantity` while using it for value math.
- Some data endpoints are global rather than user-scoped.

Treat these as high-priority context when making related changes.
