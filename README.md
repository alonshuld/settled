# Settled (שולם)

A group expense-splitting app: add shared expenses, see who owes whom, settle up and send reminders. Hebrew (RTL) first, English, light/dark. Built to run on free tiers only.

## Layout
| Path | What |
|---|---|
| `apps/web` | Vite + React SPA (see its README) |
| `apps/api` | NestJS API, Prisma + Postgres, Better Auth |
| `packages/core` | Shared money/split/balance logic |
| `packages/api-client` | Typed client generated from `openapi.json` |
| `docs/design` | Design handoff and screen boards (`STARTER_PROMPT.md` is outdated) |
| `docs/backend` | Backend design and `DEPLOY.md` (free-tier runbook) |
| `Dockerfile`, `render.yaml` | API deploy (Render) |

## Quick start
Needs Node 22+, pnpm 10, Docker.
```
pnpm install
docker compose up -d postgres mailpit        # same as: pnpm db:up
cp apps/api/.env.example apps/api/.env
pnpm --filter @settled/api exec prisma migrate deploy
pnpm build                                   # builds packages first
pnpm seed                                    # optional demo data
pnpm --filter @settled/api dev               # API on :3001
pnpm --filter @settled/web dev               # web on :3000, proxies /api to :3001
```
Sign-in emails land in Mailpit at http://localhost:8025. `docker compose up -d` without service names also starts a MinIO container that the app does not use (receipts go to Cloudflare R2).

## Checks
`pnpm build && pnpm typecheck && pnpm test` (API tests need `DATABASE_URL`, `CRON_SECRET`, `BETTER_AUTH_SECRET`, as in `.github/workflows/ci.yml`). Web e2e: `pnpm --filter @settled/web test:e2e`.

## Deploy
See `docs/backend/DEPLOY.md`.
