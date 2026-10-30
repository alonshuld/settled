---
name: run-local
description: Start the Settled stack locally (Postgres + Mailpit in Docker, NestJS API on :3001, Vite web on :3000), seed demo data, and sign in. Use when asked to run, start, launch, or screenshot the app, or to confirm a change works in the real app rather than only in tests.
---

# Run Settled locally

Stack: Postgres 16 and Mailpit (Docker) → NestJS API `:3001` → Vite web `:3000`. The web dev server proxies `/api` to the API, so the browser only talks to `http://localhost:3000` (the API has no CORS).

Run from the repo root. Needs Node 22+, pnpm 10, Docker.

## 1. First-time setup (skip the parts already done)

```
pnpm install
[ -f apps/api/.env ] || cp apps/api/.env.example apps/api/.env   # defaults work locally
docker compose up -d postgres mailpit        # = pnpm db:up. Never plain `up -d`: the unused minio image may not pull.
pnpm --filter @settled/api exec prisma migrate deploy
pnpm build                                   # builds core + api-client; web imports their dist/
```

Re-run `pnpm build` after changing `packages/*` or the OpenAPI spec.
Check Docker first with `docker compose ps`; if the containers are already up, do nothing.

## 2. Optional demo data

```
pnpm seed
```

Creates user `alon@example.com` (Alon) with groups and expenses. The seed wipes existing groups first, so don't run it over data the user wants to keep.

## 3. Start the servers

Run each in the background (`run_in_background`), not in the foreground:

```
pnpm --filter @settled/api dev        # http://localhost:3001  (nest --watch)
pnpm --filter @settled/web dev        # http://localhost:3000
```

Wait until ready before using them: `curl -sf localhost:3001/healthz` and `curl -sf localhost:3000/`. If a port is taken, find the owner with `ss -ltnp | grep -E ':300[01]'` and ask before killing anything you didn't start.

## 4. Sign in

Email-code login: enter any email on `/login`, then read the 6-digit code from Mailpit at http://localhost:8025 (or `curl -s localhost:8025/api/v1/messages` and read the newest message body). For the seed data use `alon@example.com`. "Continue as guest" needs no email. Google and phone login are hidden locally (no credentials); receipt upload and web push are unavailable (no R2 / VAPID keys), which is expected.

## 5. Drive the UI

Open http://localhost:3000. The app defaults to Hebrew RTL; language and theme toggles are in the header. For phone layout use a 390×844 viewport. With the Chrome tools, load them via ToolSearch first. If the extension isn't connected, use Playwright with the system Chromium (`CHROMIUM_PATH=/usr/bin/chromium`); `pnpm --filter @settled/web test:e2e` runs the guest → group → expense smoke test against the running stack.

## 6. Stop

Stop the two dev servers (kill the background jobs you started). Leave the containers running unless asked; `pnpm db:down` stops them (data persists in the `pgdata` volume).

## Troubleshooting

- `Cannot find module '@settled/core'` / failed named imports: run `pnpm build`.
- API fails at startup on env validation: `apps/api/.env` missing or incomplete; recopy from `.env.example`.
- Login code email never arrives: Mailpit not running (`docker compose ps`), or `RESEND_API_KEY` is set in `.env` (unset it for local).
- 401s right after login in dev: you opened the API port directly; use `localhost:3000` only.
- Slow first request: not a cold-start issue locally; check the API log for a migration or Prisma error.
