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

## 4. Resend (email OTP, reminders)
Create an API key (`RESEND_API_KEY`). Without a verified domain Resend only sends from `onboarding@resend.dev` and only to your own address; verify a domain to email real users, then set `EMAIL_FROM`. Without `RESEND_API_KEY` the API tries Mailpit and email will fail in prod.

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
| `RESEND_API_KEY`, `EMAIL_FROM` | step 4 |
| `GOOGLE_CLIENT_ID/SECRET` | step 5 (optional) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | step 3 (optional: unset = receipts answer 503) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | step 1 (optional: unset = no web push) |

`NODE_ENV=production` and `PORT=3001` come from the blueprint. Set `AUTH_PHONE_OTP_ENABLED` only if you add an SMS provider (default off).
3. On start the container runs `prisma migrate deploy` then the server. Render has no free pre-deploy hook, so migrations are part of the start command; a failed migration fails the deploy and the old version keeps serving.
4. Note the service URL, e.g. `https://settled-api.onrender.com`. Check `curl $URL/healthz` (`{"status":"ok"}`) and `curl $URL/readyz` (DB reachable).

## 7. Vercel (web)
Not in this repo yet (`apps/web` is built separately). When it exists, add the rewrite so cookies stay first-party:
```js
// next.config.js
async rewrites() { return [{ source: '/api/:path*', destination: 'https://settled-api.onrender.com/api/:path*' }]; }
```
Note: the API serves auth at `/api/auth/*` and the rest under `/api/v1/*`; `/healthz` and `/readyz` are unprefixed. Then set `APP_URL` in Render to the Vercel origin and redeploy the API.

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
Accounts: Supabase, Render, Vercel, Cloudflare (R2), cron-job.org, Resend, Google Cloud (optional). Secrets: step 1 values plus the keys above. GitHub: backup secrets (optional).
