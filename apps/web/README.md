# @settled/web

Vite + React 19 single-page app for Settled (Hebrew RTL default, English, light/dark). It talks to the NestJS API in `apps/api` through the generated client in `packages/api-client`.

## Stack
React 19, React Router 8 (data router, per-route code splitting), TanStack Query 5, Better Auth (`better-auth/react`), Tailwind v4 (CSS-first tokens in `src/index.css`, e.g. `bg-surface text-ink border-line rounded-card`), Radix Dialog, i18next, lucide-react. Tests: Vitest (jsdom) via `vp test`; e2e: Playwright.

## Scripts (run from `apps/web`, or `pnpm --filter @settled/web <script>` at the root)
| Script | What |
|---|---|
| `dev` | Vite dev server on `:3000`, proxies `/api` to `API_URL` (default `http://localhost:3001`) |
| `build` | `tsc -b && vite build` to `dist/` (build `@settled/api-client` and `@settled/core` first: `pnpm build` at the root does it in order) |
| `typecheck` | `tsc -b --noEmit` |
| `test` | unit/component tests (jsdom). Playwright e2e is not part of this |
| `test:e2e` | Playwright smoke test (see below) |

## API and proxy
The API has no CORS and uses cookie sessions, so the browser only ever calls `location.origin + /api/...`. In dev Vite proxies it; in production the host rewrites it (see `vercel.json`, or `public/_headers`, `public/_redirects` and `functions/api/[[path]].ts` for Cloudflare Pages, and `docs/backend/DEPLOY.md`). There is no build-time env for the web. Runtime config such as the VAPID public key comes from `GET /api/v1/config`. `src/lib/api.ts` creates the client with `createSettledApi`; a 401 clears the query cache and navigates to `/login?next=...`.

## i18n and RTL conventions
- Every user-visible string goes through i18next. Add keys to both `src/lib/i18n/he.ts` and `en.ts` (`en` is typed against `he`, so `typecheck` enforces parity). Language is stored in `localStorage` (`settled.lang`) and sets `<html lang dir>`.
- Use logical utilities only (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`); flip directional icons with `rtl:`.
- Amounts, phones, emails, OTP and codes are LTR islands (`dir="ltr"`). Money is integer minor units plus currency, formatted with `Intl` only at render time (`src/lib/format.ts`).
- 44px touch targets, real buttons/links, aria labels on icon buttons, `focus-visible` rings.

## Screens, routes and API
Routes are in `src/router.tsx`; each screen lives in `src/features/<name>` and exports `Component`. Query hooks and keys are in `src/api/*`.

| Route | Screen | Main API |
|---|---|---|
| `/login` | `auth/LoginPage` (email/Google/guest, OTP step) | Better Auth `/api/auth/*` |
| `/j/:code?` | `invites/JoinPage` (public) | invites, join group |
| `/` | `groups/GroupsPage` | groups, balances |
| `/groups/new` | `groups/NewGroupPage` | create group |
| `/groups/:id` | `groups/GroupPage` (expenses, balances, members, invite) | group detail, expenses |
| `/groups/:id/expenses/new`, `.../:eid/edit` | `expenses/AddExpensePage` (split editor, FX, receipt upload to R2) | expenses, fx, uploads |
| `/groups/:id/settle` | `settle/SettlePage` (transfers, payments, reminders) | settlements, reminders |
| `/activity` | `activity/ActivityPage` | activity |
| `/settings` | `settings/SettingsPage` (profile, appearance, notifications, web push, payment details, delete account) | me |

PWA bits live in `public/` (`manifest.webmanifest`, icons, `sw.js` push receiver).

## E2E
`e2e/smoke.spec.ts` (guest, create group, add expense, balance) needs the real stack:
```
docker compose up -d postgres mailpit   # from the repo root (pnpm db:up)
# run the API on :3001 (cp apps/api/.env.example apps/api/.env; pnpm --filter @settled/api dev)
pnpm --filter @settled/web test:e2e     # starts `pnpm dev` itself if :3000 is free
```
No Playwright browser download available? Set `CHROMIUM_PATH` to a system Chromium. CI runs it in the `e2e` job (`.github/workflows/ci.yml`).
