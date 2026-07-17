# 🚀 GO LIVE — from mock data to your real accounts

This guide takes footprint-pro from demo mode to ingesting **your real
social data**. Total time: ~10 minutes for GitHub, longer for Twitter/Meta
(their developer approval flows).

Every platform is independent: add keys for one, leave the others in mock
mode, and mix freely.

---

## Step 0 — Health check

```powershell
cd C:\Users\anshh\Downloads\footprint-pro1
docker compose run --rm backend node scripts/doctor.js
```

The doctor tells you exactly what's missing, prints the callback URLs to
register, and generates strong secrets you can paste into `.env`.

## Step 1 — Real secrets (2 min, do this once)

The doctor prints fresh values — copy them into `.env`:

```
JWT_SECRET=<96 hex chars>
JWT_REFRESH_SECRET=<different 96 hex chars>
TOKEN_ENC_KEY=<64 hex chars>
```

⚠️ Changing `TOKEN_ENC_KEY` invalidates any previously stored provider
tokens (they can't be decrypted anymore) — set it once, before connecting
real accounts, and never change it afterwards.

## Step 2 — GitHub (free, instant — do this one first)

1. Go to **github.com → Settings → Developer settings → OAuth Apps → New OAuth App**
2. Fill in:
   - Application name: `Footprint Pro` (anything)
   - Homepage URL: `http://localhost:3000`
   - Authorization callback URL: `http://localhost:3000/api/connect/github/callback`
3. Register → copy the **Client ID** → click **Generate a new client secret** → copy it.
4. In `.env`:
   ```
   GITHUB_CLIENT_ID=<your id>
   GITHUB_CLIENT_SECRET=<your secret>
   ```

That's it — GitHub needs no review process. Your public repos become
"posts" (stars = likes, forks = shares, open issues = comments).

## Step 3 — Twitter / X (developer account required)

1. **developer.x.com** → sign in → create a Project + App (Free tier is fine to test).
2. App settings → **User authentication settings** → Set up:
   - App permissions: **Read**
   - Type of App: **Web App, Automated App or Bot**
   - Callback URI: `http://localhost:3000/api/connect/twitter/callback`
   - Website URL: `http://localhost:3000`
3. Copy the **OAuth 2.0 Client ID and Client Secret** into `.env`
   (`TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`).

> Free tier allows ~100 reads/month — enough to demo a real sync, not for
> 15-minute polling. If you keep Twitter live, raise
> `SYNC_INTERVAL_MINUTES` (e.g. 1440 = daily) or trigger syncs manually.

## Step 4 — Instagram (most involved — needs a Business/Creator account)

Prerequisites: your Instagram account converted to **Business or Creator**
(free, in the Instagram app settings) and linked to a **Facebook Page**.

1. **developers.facebook.com** → My Apps → Create App → type **Business**.
2. Add products: **Facebook Login** and **Instagram Graph API**.
3. Facebook Login → Settings → Valid OAuth Redirect URIs:
   `http://localhost:3000/api/connect/instagram/callback`
4. App settings → Basic → copy **App ID** and **App Secret** into `.env`
   (`INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET`).
5. While the app is in **Development mode**, add yourself under
   Roles → add your own account as a tester — then your own account works
   without Meta's App Review.

## Step 5 — Flip the switch

```powershell
# in .env:
MOCK_MODE=false

docker compose run --rm backend node scripts/doctor.js   # should be green
docker compose up -d --build
```

## Step 6 — Verify with real data

1. Open http://localhost:3000 → log in → **Accounts** page.
2. Platforms with keys now show a **LIVE API** badge instead of MOCK.
3. Click **Connect** on GitHub → you'll land on GitHub's real consent
   screen → approve → you're redirected back and the first sync runs.
4. Watch the sync-activity table: the job goes queued → running → done,
   and the dashboard fills with your actual repositories.
5. `docker compose logs -f worker` shows the live fetch happening.

### What "real time" means once live

- Workers re-sync every `SYNC_INTERVAL_MINUTES` (default 15).
- Each sync fetches only items newer than the last one (incremental).
- When a sync lands, the dashboard updates itself over WebSocket — no
  refresh. New star on your repo? It shows up on the next cycle.

## Troubleshooting

| Symptom | Cause → Fix |
|---|---|
| `redirect_uri mismatch` on the provider's page | Registered callback ≠ `{BASE_URL}/api/connect/{platform}/callback` byte-for-byte. Fix it in the provider's app settings. |
| Connect button returns to Accounts with an error banner | Read the banner — it carries the provider's actual error message. Also check `docker compose logs backend`. |
| Platform still shows MOCK after adding keys | `MOCK_MODE` still `true`, or only one of ID/SECRET set, or containers not rebuilt (`docker compose up -d --build`). |
| Twitter sync fails with rate-limit | Free tier exhausted (~100 reads/mo). The job auto-reschedules for the reset time; raise `SYNC_INTERVAL_MINUTES`. |
| Instagram error `instagram_business_account is null` | IG account isn't Business/Creator or isn't linked to your Facebook Page. |
| Instagram works for you but not friends | App is in Development mode — only listed testers can connect until Meta App Review. |
| Sync error on Accounts page after weeks offline | Provider token expired beyond refresh (e.g. Meta 60-day window lapsed). Disconnect and reconnect the platform. |
| `docker pull` CDN/EOF errors | ISP blocks Docker's CDN → Docker Desktop → Settings → Docker Engine → add `"registry-mirrors": ["https://mirror.gcr.io"]`. |

## Going public (beyond localhost)

When you deploy on a server with a domain:

1. Set `BASE_URL=https://yourdomain.com` in `.env`.
2. Update every provider's registered callback to the same domain.
3. Put TLS in front (Caddy: `caddy reverse-proxy --from yourdomain.com --to localhost:3000`).
4. Re-run the doctor — it enforces HTTPS for public URLs.
