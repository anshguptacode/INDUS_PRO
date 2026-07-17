# 👣 Footprint Pro — Real-time Digital Footprint Analyzer

Production-grade social media analytics. Connect your **Twitter/X, Instagram and
GitHub** accounts; background workers ingest your real posts on a schedule,
a Python analytics engine cleans + analyzes them, and the dashboard updates
**live over websockets** — no refresh needed.

> **Zero-config demo:** with `MOCK_MODE=true` (the default) every "Connect"
> button uses a realistic mock provider — no API keys needed. Flip to real
> APIs once your keys are configured.

---

## What this repo contains

- `backend/`: Node.js + Express API gateway, JWT auth, OAuth connect flows,
  socket.io real-time notifications, BullMQ sync queue, and token encryption.
- `analytics-service/`: FastAPI analytics engine that cleans posts, computes
  sentiment/EDA insights, and generates 7-day engagement forecasts.
- `frontend/`: Vite + React 18 dashboard, accounts page, login/register, and
  live websocket refresh.
- `docker-compose.yml`: ships PostgreSQL, MongoDB, Redis, analytics, backend,
  worker, and frontend services.
- `db/schema.sql`: schema for the PostgreSQL app database.
- `GO_LIVE.md`: deployment and go-live guidance.
- `Major_Project_Report.docx` / `.pdf`: project report files.

## Architecture

```
 Browser ── nginx (gzip, immutable asset cache, ws proxy)
    │             │
    │   React 18 (code-split routes, memoized charts, socket.io-client)
    │             │
    └──> /api ──> Node/Express backend ──────────────┐
                  · JWT access (15m) + rotating       │
                    refresh tokens (30d, revocable)   │
                  · OAuth 2.0 (PKCE) connect flows    │
                  · AES-256-GCM token encryption      │
                  · helmet / rate limits / pino logs  │
                  · socket.io  ◄── Redis pub/sub ◄──┐ │
                                                    │ │
                  BullMQ queue (Redis) ──> Worker ──┘ │
                  · scheduled every N minutes         │
                  · incremental fetch (since_id)      │
                  · 429-aware retry/backoff           │
                                │                     │
                                ▼                     ▼
                  FastAPI analytics service      PostgreSQL (tidy data)
                  · cleaning (dupes, imputation, MongoDB   (raw API docs)
                    outliers, mixed date formats) Redis     (cache/queue/pubsub)
                  · sentiment, EDA insights
                  · SARIMA 7-day forecast
```

## Quick start

```bash
cd footprint-pro
cp .env.example .env        # works as-is in mock mode
docker compose up --build
```

Open **http://localhost:3000** → create an account → **Accounts** page →
Connect platforms. The first sync ingests demo history for mock providers; the
dashboard fills in live as each platform finishes. Workers re-sync every
`SYNC_INTERVAL_MINUTES` (default 15) and push updates over websockets.

## Service ports and runtime

- Frontend is exposed on `http://localhost:3000`.
- Backend is available internally to frontend via Docker networking.
- Analytics runs internally on `http://analytics:8000`.
- Redis, PostgreSQL, and MongoDB are provisioned by Compose and are internal.

## .env configuration

Copy `.env.example` to `.env`. Key values include:

- `BASE_URL`: public app URL, used for OAuth callbacks and CORS.
- `MOCK_MODE`: `true` to use fake providers; `false` to enable real API keys.
- `SYNC_INTERVAL_MINUTES`: background sync cadence.
- `PGUSER`, `PGPASSWORD`, `PGHOST`, `PGDATABASE`: PostgreSQL settings.
- `MONGO_URL`: MongoDB connection.
- `REDIS_URL`: Redis connection.
- `ANALYTICS_URL`: internal analytics service URL.
- `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET`.
- `INSTAGRAM_CLIENT_ID` / `INSTAGRAM_CLIENT_SECRET`.
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.

## Going live with real APIs

Set the keys in `.env`, then `MOCK_MODE=false` and `docker compose up -d --build`.
Any platform left without keys automatically stays in mock mode.

| Platform | Where | Callback URL to register | Notes |
|---|---|---|---|
| **GitHub** (easiest, free) | github.com → Settings → Developer settings → OAuth Apps | `{BASE_URL}/api/connect/github/callback` | Instant approval. Repos are analyzed as posts (stars=likes, forks=shares). |
| **Twitter / X** | developer.x.com → Projects → App → OAuth 2.0 (type: Web App) | `{BASE_URL}/api/connect/twitter/callback` | Free tier is ~100 reads/mo — fine for testing; Basic tier for real use. |
| **Instagram** | developers.facebook.com → Create App → Facebook Login + Instagram Graph API | `{BASE_URL}/api/connect/instagram/callback` | Requires an Instagram **Business/Creator** account linked to a Facebook Page. Long-lived tokens (60d) are auto-refreshed. |

Start with GitHub — it takes 2 minutes and exercises the entire real-OAuth path.

## Backend and analytics behavior

- `backend/` uses Express with secure defaults: `helmet()`, `compression()`, CORS restricted to `BASE_URL`, rate limiting, and structured `pino` logging.
- OAuth token payloads are encrypted using AES-256-GCM before storage.
- `worker` runs the BullMQ queue processor separately from the API so syncs do not block requests.
- `analytics-service/` runs FastAPI with pandas, NumPy, statsmodels, and MongoDB/PostgreSQL integration.
- The frontend uses React 18, Recharts, and socket.io-client for live dashboard updates.
   Also set a strong `PGPASSWORD`. The backend logs a warning at boot if
   defaults are detected.
2. **Domain + HTTPS** — put a TLS terminator (Caddy, Traefik, or your cloud
   LB) in front of port 3000, and set `BASE_URL=https://yourdomain.com`
   (it drives OAuth callbacks, CORS and redirects). Update each provider's
   registered callback URL to match.
3. **`MOCK_MODE=false`** with real keys configured.
4. **Backups** — `pgdata` and `mongodata` volumes hold everything; snapshot
   them. `docker compose exec postgres pg_dump -U footprint footprint > backup.sql`
5. **Scale knobs** — worker concurrency (3 jobs) and `SYNC_INTERVAL_MINUTES`
   in `.env`; Redis is capped at 256 MB LRU; uvicorn runs 2 workers.
6. **Logs** — everything is structured JSON on stdout (`docker compose logs -f
   backend worker analytics`); point your log shipper at the Docker daemon.

## What the analytics engine does

- **Cleaning:** dedupes by (platform, post id) keeping the most complete copy,
  parses mixed date formats (ISO vs legacy Twitter), imputes missing
  comments/shares/impressions from per-platform median ratios (Instagram
  doesn't return impressions without extra permissions), drops z>4 outliers.
- **Insights** (recomputed after every sync, in *your* timezone):
  optimal posting window, best topic, best hashtag, sentiment mix,
  influencer score — each with a lift multiplier and sample size, and only
  reported when the lift is real (≥1.05×).
- **Forecast:** SARIMA (2,0,1)(1,0,0,7) on daily engagement with a
  seasonal-naive fallback, 7 days ahead with confidence bands.

## Project layout

```
footprint-pro/
├── docker-compose.yml     # 7 services, healthchecked
├── .env.example           # copy to .env
├── db/schema.sql          # auto-applied on first boot
├── backend/               # Express API + socket.io + OAuth providers
│   └── src/workers/       # BullMQ sync workers + scheduler (separate container)
├── analytics-service/     # FastAPI: cleaning → sentiment → EDA → forecast
└── frontend/              # React 18 + Recharts, nginx with gzip/caching
```

## Troubleshooting

- **`docker pull` fails with CDN/EOF errors** (some ISPs block Docker's CDN):
  Docker Desktop → Settings → Docker Engine → add
  `"registry-mirrors": ["https://mirror.gcr.io"]` → Apply & Restart.
- **OAuth redirect mismatch:** the callback registered with the provider must
  byte-for-byte equal `{BASE_URL}/api/connect/{platform}/callback`.
- **A platform shows a sync error:** it's surfaced on the Accounts page and in
  `sync_jobs`; workers retry 3× with backoff and honor 429 rate-limit windows.
- **Reset everything:** `docker compose down -v` (deletes volumes).
