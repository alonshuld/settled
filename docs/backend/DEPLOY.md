# Deploy runbook (free tier)

Implements design §13.1: Supabase (Postgres) + Render (API) + Vercel (web) + cron-job.org + Cloudflare R2 + Resend. Everything is free tier; verify current limits when you sign up. Repo files that drive this: `Dockerfile`, `render.yaml`, `.github/workflows/ci.yml`, `.github/workflows/backup.yml`, `apps/api/.env.example`.

Do the steps in order; later ones need values from earlier ones.

## 1. Generate secrets
```
openssl rand -hex 32        # CRON_SECRET
openssl rand -base64 48     # BETTER_AUTH_SECRET
npx web-push generate-vapid-keys   # VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
```

## 2. Supabase (Postgres)
1. New project (free), choose a region near Render's (Frankfurt).
2. Project > Connect > **Session pooler** URI (port 5432). Use it, not the direct host (IPv6 only on free) and not the transaction pooler (port 6543, breaks `prisma migrate`). Append `?sslmode=require`.
3. That string is `DATABASE_URL`. Tables are created by the API on first boot via `prisma migrate deploy`.

## 3. Cloudflare R2 (receipts)
1. R2 > create bucket, e.g. `settled-receipts` (keep it private; no public access).
2. R2 > Manage API tokens > create token, **Object Read & Write**, scoped to that bucket. Gives `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`. `R2_ACCOUNT_ID` is on the R2 overview page.
3. Bucket > Settings > CORS policy (browsers PUT receipts straight to R2):
```json
[{
  "AllowedOrigins": ["https://YOUR-APP.vercel.app"],
  "AllowedMethods": ["GET", "PUT"],
  "AllowedHeaders": ["content-type", "content-length"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3600
}]
```
Add custom domains / `http://localhost:3000` as extra origins if needed.
4. Optional: a second private bucket for DB backups (step 9).

## 4. Resend (email OTP, reminders) — optional, skip for now
**Without `RESEND_API_KEY` in production, email is off:** the login screen offers Google and guest only, the email OTP endpoint is not mounted, email is dropped from reminder channels (existing email auto-repeats stop) and the weekly digest goes by push only. Add the key later and redeploy to turn it on.

Create an API key (`RESEND_API_KEY`). Without a verified domain Resend only sends from `onboarding@resend.dev` and only to your own address; verify a domain to email real users, then set `EMAIL_FROM`.

## 5. Google sign-in
Google Cloud console > APIs & Services > Credentials > OAuth client (Web). Authorized redirect URI: `https://YOUR-APP.vercel.app/api/auth/callback/google` (the web app proxies `/api/*`, so the callback goes through Vercel). Gives `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Optional: without them Google login is simply off.

## 6. Render (API)
1. New > **Blueprint**, pick this repo; Render reads `render.yaml` (free plan, Docker, health check `/healthz`).
2. Fill the prompted env vars (all `sync: false` entries):

| Var | Value |
|---|---|
| `DATABASE_URL` | Supabase session pooler URI (step 2) |
| `APP_URL` | Public web origin, e.g. `https://YOUR-APP.vercel.app` (no trailing slash) |
| `CRON_SECRET` / `BETTER_AUTH_SECRET` | step 1 |
| `RESEND_API_KEY`, `EMAIL_FROM` | step 4 (optional: unset = no email in production) |
| `GOOGLE_CLIENT_ID/SECRET` | step 5 (optional) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | step 3 (optional: unset = receipts answer 503) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | step 1 (optional: unset = no web push) |
| `MOBILE_ORIGINS`, `EXPO_ACCESS_TOKEN` | native app only (optional): deep-link scheme such as `settled://`; Expo push security token (see `packages/api-client/README.md`) |

`NODE_ENV=production` and `PORT=3001` come from the blueprint. Set `AUTH_PHONE_OTP_ENABLED` only if you add an SMS provider (default off).
3. On start the container runs `prisma migrate deploy` then the server. Render has no free pre-deploy hook, so migrations are part of the start command; a failed migration fails the deploy and the old version keeps serving.
4. Note the service URL, e.g. `https://settled-api.onrender.com`. Check `curl $URL/healthz` (`{"status":"ok"}`) and `curl $URL/readyz` (DB reachable).

## 7. Web (`apps/web`, Vite SPA) on Vercel Hobby or Cloudflare Pages
Pick **one** host; the other host's files are ignored. The browser must reach the API same-origin (`/api/*` proxied to Render) because the API has no CORS and uses cookie sessions. The API serves auth at `/api/auth/*` and the rest under `/api/v1/*`.

### Vercel Hobby (config: `apps/web/vercel.json`)
1. Add New > Project, import the repo. **Root Directory:** `apps/web` (keep "Include source files outside of the Root Directory" on, the workspace packages are needed).
2. Framework preset: Other. The settings come from `vercel.json`: install `pnpm install --frozen-lockfile`, build `pnpm --filter @settled/web... build` (the `...` also builds `@settled/core` and `@settled/api-client` first), output `dist`.
3. `vercel.json` rewrites `/api/:path*` to `https://settled-api.onrender.com/api/:path*` (change the host if your Render service has another name), falls back to `/index.html` for every other path (never for `/api/` or `/assets/`), caches `/assets/*` as immutable and sets `no-cache` on `index.html`, `sw.js` and `manifest.webmanifest`.

### Cloudflare Pages (config: `apps/web/public/_headers`, `_redirects`, `functions/api/[[path]].ts`)
1. Workers & Pages > Create > Pages > connect the repo. **Root directory:** `apps/web`. **Build command:** `pnpm --filter @settled/web... build` (run from the repo root by Pages; if it runs inside `apps/web`, use `pnpm install --frozen-lockfile && pnpm --filter @settled/web... build`). **Build output directory:** `dist`. Set env var `NODE_VERSION=22`.
2. `_redirects` only contains the SPA fallback (`/* /index.html 200`). Pages `_redirects` cannot proxy to an external origin, so `/api/*` is proxied by the Pages Function `functions/api/[[path]].ts`, which runs before static assets and redirects. Optional env var `API_ORIGIN` overrides `https://settled-api.onrender.com`. `_headers` sets the same cache rules as Vercel.
3. Not verified against a live Pages project in this repo (no account used); check `curl -i https://<web>/api/v1/me` returns the API's 401 JSON, not HTML.

### After the web origin exists
- **Render `APP_URL`** = the web origin (`https://<web>`, no trailing slash), then redeploy the API. Better Auth uses it as base URL and trusted origin and for cookies; a wrong value gives 403 on sign-in.
- **Google OAuth** authorized redirect URI: `https://<web>/api/auth/callback/google` (step 5).
- **Web push:** `VAPID_PUBLIC_KEY` on Render is all the web needs; the SPA reads it from the API (`/api/v1/config`) at runtime, there is no build-time web env. Without it the notification opt-in shows as unavailable. iOS only allows push for installed web apps (Add to Home Screen).
- **R2 CORS** (step 3): add `https://<web>` to `AllowedOrigins`, since browsers PUT receipts directly to R2.
- **Cold starts:** Render free sleeps after 15 min idle and the first request takes 30-60 s. The cron-job.org job in step 8 (every 5 min) keeps it awake; if you skip it, expect a slow first load and the SPA's offline/error dialog on timeouts.

## 8. cron-job.org (scheduler and keep-alive)
Create a free account, then a cronjob:
- URL: `https://settled-api.onrender.com/api/v1/internal/cron`
- Schedule: every 5 minutes
- Advanced > Request method: **POST**
- Headers: `X-Cron-Secret: <CRON_SECRET>`
- Timeout: 60 s (a cold start can take 30-60 s); enable failure notifications.

Expected response: `200 {"ran":[...]}`; a wrong secret gives `401`. This one job also keeps Render awake and Supabase from pausing. Quick test:
```
curl -i -X POST -H "X-Cron-Secret: $CRON_SECRET" https://settled-api.onrender.com/api/v1/internal/cron
```

## 9. Backups (optional, free)
`.github/workflows/backup.yml` runs a weekly `pg_dump` into a private R2 bucket. Add GitHub repo secrets: `BACKUP_DATABASE_URL` (Supabase session pooler URI), `R2_ACCOUNT_ID`, `BACKUP_R2_BUCKET`, `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`. Run it once via Actions > Weekly backup > Run workflow. Restore: `pg_restore --no-owner -d "$URL" settled-YYYY-MM-DD.dump`.

## Releases and rollback
- Render auto-deploys on each commit to `main` (`dev` is not deployed). CI (`.github/workflows/ci.yml`) runs build, typecheck, migrations against a Postgres 16 service and the test suite on `main`, `dev` and PRs. To gate deploys on CI, turn on Render's "After CI checks pass" option.
- Roll back the code from the Render dashboard (Deploys > Rollback). Migrations are forward-only; ship a new migration to undo schema changes.
- Local image check: `docker build -t settled-api .` then run with `-e` values from `.env.example`.

## Checklist of manual actions
Accounts: Supabase, Render, Vercel or Cloudflare Pages, Cloudflare (R2), cron-job.org, Resend, Google Cloud (optional). Secrets: step 1 values plus the keys above. GitHub: backup secrets (optional).
