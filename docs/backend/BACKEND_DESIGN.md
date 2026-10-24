# שולם / Settled — Backend design

Status: draft for review · 2026-10-24
Companion to [`docs/design/DESIGN_HANDOFF.md`](../design/DESIGN_HANDOFF.md). Section references like "handoff §7" point there.

---

## 1. Stack

| Concern | Choice |
|---|---|
| Runtime / language | Node.js LTS, TypeScript (strict) |
| API framework | NestJS (Express adapter) |
| Database | PostgreSQL 16 |
| ORM / migrations | Prisma (`prisma migrate`) |
| Auth | Better Auth: Google, email OTP, anonymous (guest) + account linking. Phone OTP is built but disabled until an SMS provider is affordable (§5.1) |
| Validation | Zod schemas shared from `packages/core`, wired into Nest with `nestjs-zod` (also feeds OpenAPI) |
| API docs / client | `@nestjs/swagger` → OpenAPI → generated TS client + TanStack Query hooks (orval) for web and later mobile |
| Background jobs | pg-boss for event jobs while the process is up; time-based jobs driven by an external cron hitting `/internal/cron` (§10) |
| Email | Resend (free tier) |
| SMS | **None in v1.** Reminders by SMS open the sender's own messaging app via an `sms:` link (free). An `SmsProvider` interface is kept for later |
| Push | Web Push (VAPID, free) now; Expo push (free) when the native apps arrive |
| WhatsApp | `wa.me` deep links built by the server, opened by the client (no Business API) |
| Exchange rates | Free public rate feeds, cached daily in Postgres (§4.2) |
| File storage | Cloudflare R2 (free tier) with presigned upload/download URLs |
| Logging / errors | `nestjs-pino`, Sentry (free tier) |
| Hosting | **Zero-cost setup (§13.1):** API on Render free, Postgres on Supabase free, web on Vercel Hobby, cron-job.org for scheduled calls |

## 2. Repository layout

pnpm workspace monorepo:

```
apps/
  web/                 Next.js App Router (frontend, built separately)
  api/                 NestJS API + job worker
packages/
  core/                Pure TS: money, split, balances, simplification, reminder templates, zod schemas, enums
  api-client/          Generated OpenAPI client + query hooks (do not edit by hand)
docs/
  design/              Design handoff (existing)
  backend/             This document
```

`packages/core` has **no framework imports**. Both the web app (live split preview, "effect on your balance") and the API (authoritative computation) use the same functions, so they always agree.

## 3. Architecture

```
 Browser ──► shulam.app (Vercel, Next.js)
               │  /api/*  ── rewrite (same origin) ──►  API (Render, NestJS)
               │                                          ├─ HTTP modules
               │                                          ├─ pg-boss worker (same process)
               │                                          └─► Postgres (Supabase), R2, Resend, Web Push, FX feed
 Mobile app ──────────── https://api.shulam.app ──────────┘   (bearer token auth)
 cron-job.org ── every 5 min ── POST /internal/cron ──────┘   (keeps API awake + runs due jobs)
```

- **Web uses a same-origin proxy.** Next.js rewrites `/api/:path*` to the API. Session cookies are then first-party (`SameSite=Lax`, `HttpOnly`, `Secure`), and there is no CORS for the web app.
- **Mobile calls the API directly** with a bearer session token (Better Auth bearer/Expo support). CORS stays closed except for listed origins.
- **One process in v1.** The API process also runs the pg-boss workers. Split into `api` and `worker` services (same image, different entrypoint) once load justifies it.
- **No realtime in v1.** The web app refetches on focus/interval with TanStack Query. Server-Sent Events per group can come later without changing the data model.

## 4. Cross-cutting conventions

### 4.1 URLs and versioning
- App API under `/api/v1/...`. Better Auth under `/api/auth/...`.
- JSON, `camelCase` fields.
- IDs: `cuid()` strings.

### 4.2 Money and currencies
- Always **integer minor units** + an ISO 4217 code: `{ "amount": 480000, "currency": "ILS" }` = ₪4,800. Minor-unit size follows the currency: 2 decimals for ILS/EUR/USD, 0 for JPY, 3 for KWD. `packages/core` ships a fixed ISO 4217 table (code → decimals) so client and server always agree; `Intl` is not used for this because browsers differ.
- **Any active ISO 4217 currency** is allowed, for groups and for individual expenses and settlements.
- **Each group has a base currency** (chosen at creation, default = creator's default currency). All balances, shares and transfers are computed in the base currency.
- **An expense or settlement can be in any currency.** It stores the original amount and currency, the exchange rate used, and the converted base amount:
  - `amount` / `currency` — what was actually paid (e.g. €40.00 = `4000 EUR`).
  - `fxRate` — base units per 1 unit of the original currency, stored as a decimal string (`"3.9821"`).
  - `baseAmount` — converted, rounded to the base currency's minor unit. This is what counts in balances.
  - `fxSource` — `same` (no conversion), `market` (from the rate feed), or `manual` (the user typed the rate, e.g. their card's actual rate).
- **Rate lookup:** the rate for the expense's date from the `ExchangeRate` table. If that date is missing it is fetched; if the feed fails, the latest cached rate is used and `fxSource` stays `market` with `fxDate` showing the date actually used. The user can always override with a manual rate.
- **The rate is locked** when the expense is saved. Later rate changes never move old balances. Editing amount, currency or date re-resolves the rate unless it was manual.
- **Rate feeds (free, no API key):** primary `fawazahmed0/exchange-api` (200+ currencies, dated history via jsDelivr); fallback Frankfurter (ECB, ~30 major currencies). A daily job stores rates in USD terms; cross rates are derived. Verify both endpoints and their terms when implementing.
- Cross-group totals (Home dashboard) are reported per base currency, plus an **approximate** total in the user's default currency using the latest rates, flagged `approximate: true` when conversion was involved.
- Rounding (handoff §9): splitting leaves a remainder of a few minor units. The remainder goes to the payer if they are included in the split, otherwise to the first included member by member order. The same rule applies when converting exact amounts (largest-remainder method, so converted shares always sum to `baseAmount`). The rules live in `packages/core` and are unit-tested.

### 4.3 Dates
- Timestamps: ISO 8601 UTC.
- Expense date and group start/end: calendar dates `YYYY-MM-DD` (Postgres `date`). Grouping "by day" uses the expense date, not the creation time.
- The server never formats dates or money for display; the client uses `Intl`. Exceptions: reminder messages, emails and SMS, which the server renders in the recipient's locale.

### 4.4 Errors
Every non-2xx response has the same shape:

```json
{
  "error": {
    "code": "SPLIT_SUM_MISMATCH",
    "message": "Exact amounts must add up to the total.",
    "details": { "expected": 480000, "actual": 470000 },
    "requestId": "req_01J..."
  }
}
```

`code` is stable and is what the client maps to the dialogs in `Errors.dc.html`. `message` is for logs and developers, not shown to users.

| HTTP | `code` | Client behaviour (handoff §8) |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Field errors from `details.fields` |
| 400 | `SPLIT_SUM_MISMATCH` | Red "amounts don't add up" |
| 400 | `UNSUPPORTED_CURRENCY` | Currency picker error |
| 503 | `FX_RATE_UNAVAILABLE` | No rate for that currency at all (feed down and nothing cached): ask the user to enter the rate manually |
| 401 | `UNAUTHENTICATED` / `SESSION_EXPIRED` | "Session expired" → Sign in again |
| 403 | `NOT_A_MEMBER` / `FORBIDDEN` | Go home |
| 404 | `NOT_FOUND` | — |
| 404 | `INVITE_NOT_FOUND` | "Enter a code" |
| 410 | `INVITE_EXPIRED` | "Invite link expired" dialog |
| 409 | `MEMBER_ALREADY_CLAIMED` | Refresh claim list |
| 409 | `VERSION_CONFLICT` | Reload expense, re-apply edit |
| 409 | `LEAVE_WITH_OPEN_BALANCE` | "Can't leave with open balance" → Settle up |
| 409 | `GROUP_CLOSED` | Read-only group |
| 422 | `REMINDER_CHANNEL_UNAVAILABLE` | "Reminder not sent" → Send by SMS / Cancel; `details.alternatives` lists channels that work |
| 429 | `RATE_LIMITED` | `Retry-After` header; OTP resend countdown |
| 5xx | `INTERNAL` | "Couldn't save" (draft kept) / Try again |

### 4.5 Idempotency
Creating endpoints (`POST` expense, settlement, reminder, group, join) accept an `Idempotency-Key` header (client-generated UUID). The key + user + route + response are stored for 24h, so a repeat with the same key returns the original response instead of creating a duplicate. This makes "Try again" after a network error safe (handoff §8 "Couldn't save expense").

### 4.6 Concurrency
Expenses carry a `version` integer. `PATCH` requires `version`. The update runs `WHERE id = ? AND version = ?` and increments; zero rows updated → `409 VERSION_CONFLICT`.

### 4.7 Pagination
Cursor-based: `?limit=30&cursor=<opaque>` → `{ "items": [...], "nextCursor": "..." | null }`.

## 5. Authentication and authorization

### 5.1 Sign-in methods (Better Auth)
| Method | Flow |
|---|---|
| Google | OAuth redirect → callback → session cookie |
| Email OTP | send code → verify 6 digits → session |
| Phone OTP | **Disabled in v1** (sending SMS costs money). Built behind the `AUTH_PHONE_OTP_ENABLED` flag; `GET /api/v1/config` tells the client to hide the Phone tab on the login screen. Turn on once an SMS provider is chosen |
| Guest | name only → anonymous user + session |

Users can still save an (unverified) phone number in their profile and on placeholder members; it's used for WhatsApp and SMS reminder links, never for login.

OTP rules (to match `Main.dc.html`):
- 6 digits, valid 10 minutes, **3 attempts** per code ("2 tries left" after the first wrong one). Remaining attempts are returned with the error.
- Resend cooldown 60 s per destination; max 5 sends per destination per hour and 20 per IP per hour (controls SMS cost and abuse).
- Phone and email are stored normalised (E.164; lowercase email).

Better Auth exposes its own endpoint paths under `/api/auth/*`. Check exact paths against the installed version when implementing; the client uses Better Auth's client SDK rather than hand-written calls.

### 5.2 Guests
**Change from handoff §1/§7:** the handoff says guest data lives on the device. That can't work when a guest joins someone else's group, because the other members must see the guest's expenses. Instead:

- A guest is a **server-side anonymous user** (`isAnonymous = true`). Only the session lives on the device.
- Linking Google / email / phone **upgrades the same user row** (sets the identifier, `isAnonymous = false`). No data migrates, nothing is lost.
- If the identifier already belongs to an existing account, the guest's group memberships are **merged** into that account (members re-pointed in one transaction) and the anonymous user is deleted. Duplicate memberships of the same group are handled by keeping the claimed member with activity and reporting the conflict. This edge case gets its own tests.
- **Settings banner copy changes** (approved), because "saved on this device only" is no longer true:
  - en: "Your groups are saved to a guest account. Link Google or your email to sign in on other devices and never lose them."
  - he: "הקבוצות שלך שמורות בחשבון אורח. אפשר לחבר Google או אימייל כדי להתחבר ממכשירים אחרים ולא לאבד אותן."
- Abandoned guests (no groups, inactive 30 days) are deleted by a cleanup job.

### 5.3 Sessions
- Web: `HttpOnly` cookie, rolling 30-day expiry, refreshed on use.
- Mobile: bearer token, stored in secure storage.
- Sign out deletes the session row. "Delete account" deletes all sessions.

### 5.4 Authorization model
- Global `SessionGuard`: every route requires a session unless decorated `@Public()`.
- `GroupMemberGuard` on every `/groups/:groupId/...` route: loads the caller's active `Member` row for that group, otherwise `403 NOT_A_MEMBER`. The member is attached to the request (`@CurrentMember()`).
- Roles: `owner` (creator) and `member`.

| Action | Who |
|---|---|
| View group, add expense, edit/delete any expense | Any member. Every edit and delete is logged with a before/after diff and **notifies the other members** (§9.5.1) |
| Add placeholder members, invite | Any member |
| Rename group, change dates, close/reopen, rotate invite code | Owner |
| Delete group | Owner, only when the group has no expenses |
| Mark a transfer received (confirmed settlement) | The **creditor** (receiver) |
| "I already paid" (pending settlement) | The **debtor** (payer); creditor confirms or rejects |
| Remind | The creditor, for debts owed to them |
| Remove a placeholder member | Any member, only if the placeholder has no expenses/shares/settlements |

The group's base currency is fixed once the group has its first expense.

## 6. Data model (Prisma)

Better Auth owns `User`, `Session`, `Account`, `Verification`. Generate them with the Better Auth CLI, then add the app fields below to `User`. Everything else is app-owned.

```prisma
enum GroupType      { trip home event meal gift other }
enum MemberRole     { owner member }
enum FxSource       { same market manual }
enum Gender         { male female }                 // optional, for Hebrew grammar only
enum Category       { food stay transport fuel shopping activities other }
enum SplitMode      { equal exact shares }
enum SettlementStatus { pending confirmed rejected }
enum PaymentMethod  { bit paybox paypal revolut bank cash other }
enum ReminderTone   { friendly neutral firm }
enum ReminderChannel { whatsapp sms email push }
enum ReminderStatus { queued sent failed handed_off } // handed_off = wa.me / sms: link given to the client

// Currency codes are plain strings (ISO 4217, validated against the table in packages/core),
// not a Prisma enum, because every currency is allowed.
enum ActivityType   { expense payment reminder member group }
enum Theme          { light dark system }
enum Locale         { he en }

model User {
  // --- Better Auth fields (generated): id, name, email, emailVerified, image,
  //     phoneNumber, phoneNumberVerified, isAnonymous, createdAt, updatedAt
  // --- App fields:
  locale           Locale    @default(he)
  theme            Theme     @default(system)
  defaultCurrency  String    @default("ILS") @db.Char(3)
  contactPhone     String?   // unverified, E.164; for reminder links (phoneNumber stays reserved for phone login)
  gender           Gender?
  activityReadAt   DateTime? // watermark for "unread"
  deletedAt        DateTime?

  paymentDetails   PaymentDetails?
  notificationPrefs NotificationPrefs?
  pushSubscriptions PushSubscription[]
  members          Member[]
}

model PaymentDetails {
  userId      String  @id
  user        User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  bitPhone    String?
  payboxPhone String?
  paypalMe    String? // PayPal.me username
  revolutTag  String? // Revolut @username
  bankDetails String? // free text "Bank · Branch · Account no." (or IBAN)
  updatedAt   DateTime @updatedAt
}

model NotificationPrefs {
  userId           String  @id
  user             User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  remindersToMe    Boolean @default(true)
  newExpenses      Boolean @default(true) // new + edited + deleted expenses you're not involved in (§9.5.1)
  paymentsReceived Boolean @default(true)
  weeklySummary    Boolean @default(false)
}

model PushSubscription {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  kind      String   // "webpush" | "expo"
  endpoint  String   @unique // web push endpoint or Expo token
  keys      Json?    // web push p256dh/auth
  createdAt DateTime @default(now())
}

model Group {
  id          String     @id @default(cuid())
  name        String
  type        GroupType
  currency    String     @db.Char(3) // base currency: balances are computed in it
  startDate   DateTime?  @db.Date
  endDate     DateTime?  @db.Date
  createdById String
  closedAt    DateTime?
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  members     Member[]
  invite      Invite?
  expenses    Expense[]
  settlements Settlement[]
  reminders   Reminder[]
  activities  Activity[]
}

model Invite {
  groupId   String    @id
  group     Group     @relation(fields: [groupId], references: [id], onDelete: Cascade)
  code      String    @unique // 6 chars, stored without dash, e.g. "KR74QX"
  expiresAt DateTime?
  revokedAt DateTime?
  createdAt DateTime  @default(now())
}

model Member {
  id           String     @id @default(cuid())
  groupId      String
  group        Group      @relation(fields: [groupId], references: [id], onDelete: Cascade)
  userId       String?    // null = placeholder ("added by name"), not yet claimed
  user         User?      @relation(fields: [userId], references: [id], onDelete: SetNull)
  displayName  String
  color        String     // one of the avatar palette hex values
  role         MemberRole @default(member)
  gender       Gender?    // overrides user's, for placeholders
  inviteEmail  String?    // contact typed in "Name, email or phone"
  invitePhone  String?
  sortOrder    Int        // stable order; used for rounding remainder
  joinedAt     DateTime?
  leftAt       DateTime?
  createdAt    DateTime   @default(now())

  paidExpenses   Expense[]    @relation("PaidBy")
  shares         ExpenseShare[]
  settlementsOut Settlement[] @relation("SettlementFrom")
  settlementsIn  Settlement[] @relation("SettlementTo")

  @@unique([groupId, userId]) // a user is at most one member per group
  @@index([userId])
}

model Expense {
  id             String     @id @default(cuid())
  groupId        String
  group          Group      @relation(fields: [groupId], references: [id], onDelete: Cascade)
  description    String
  category       Category
  amount         Int        // original amount, minor units of `currency`, > 0
  currency       String     @db.Char(3)
  fxRate         Decimal    @db.Decimal(20, 10) // base units per 1 unit of `currency`; 1 when same
  fxSource       FxSource
  fxDate         DateTime?  @db.Date // date of the rate actually used
  baseAmount     Int        // converted to group currency; this is what balances use
  paidByMemberId String
  paidBy         Member     @relation("PaidBy", fields: [paidByMemberId], references: [id])
  date           DateTime   @db.Date
  receiptKey     String?    // object key in R2
  splitMode      SplitMode
  createdById    String     // member id
  version        Int        @default(1)
  deletedAt      DateTime?
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  shares         ExpenseShare[]

  @@index([groupId, date])
}

model ExpenseShare {
  expenseId String
  expense   Expense @relation(fields: [expenseId], references: [id], onDelete: Cascade)
  memberId  String
  member    Member  @relation(fields: [memberId], references: [id])
  amount         Int  // final computed share in the group's base currency
  originalAmount Int? // only for splitMode = exact: what the user typed, in the expense currency
  shares         Int? // only for splitMode = shares

  @@id([expenseId, memberId])
}

model Settlement {
  id            String           @id @default(cuid())
  groupId       String
  group         Group            @relation(fields: [groupId], references: [id], onDelete: Cascade)
  fromMemberId  String           // debtor (pays)
  from          Member           @relation("SettlementFrom", fields: [fromMemberId], references: [id])
  toMemberId    String           // creditor (receives)
  to            Member           @relation("SettlementTo", fields: [toMemberId], references: [id])
  amount        Int              // original, minor units of `currency`
  currency      String           @db.Char(3)
  fxRate        Decimal          @db.Decimal(20, 10)
  fxSource      FxSource
  baseAmount    Int              // counts in balances
  method        PaymentMethod?
  status        SettlementStatus
  createdById   String           // member id
  confirmedAt   DateTime?
  createdAt     DateTime         @default(now())

  @@index([groupId, status])
}

model Reminder {
  id             String          @id @default(cuid())
  groupId        String
  group          Group           @relation(fields: [groupId], references: [id], onDelete: Cascade)
  fromMemberId   String
  toMemberId     String
  amount         Int             // outstanding at send time, group base currency
  tone           ReminderTone
  channel        ReminderChannel
  message        String          // final text as sent (user may edit the template)
  locale         Locale
  status         ReminderStatus
  error          String?
  autoRepeatDays Int?            // 3 when "Auto-remind" is on
  nextRunAt      DateTime?
  stoppedAt      DateTime?
  parentId       String?         // auto-repeat sends point at the original
  sentAt         DateTime?
  createdAt      DateTime        @default(now())

  @@index([groupId, toMemberId])
  @@index([nextRunAt])
}

model Activity {
  id             String       @id @default(cuid())
  groupId        String
  group          Group        @relation(fields: [groupId], references: [id], onDelete: Cascade)
  actorMemberId  String?
  type           ActivityType
  event          String       // e.g. "expense.created", "payment.confirmed"
  payload        Json         // snapshot for rendering (amounts, names, ids)
  audienceUserId String?      // null = all group members; set for private items (reminder to you)
  createdAt      DateTime     @default(now())

  @@index([groupId, createdAt])
  @@index([audienceUserId, createdAt])
}

model ExchangeRate {
  date      DateTime @db.Date
  currency  String   @db.Char(3)
  perUsd    Decimal  @db.Decimal(24, 10) // units of `currency` per 1 USD
  source    String   // "fawazahmed0" | "frankfurter"
  fetchedAt DateTime @default(now())

  @@id([date, currency])
}

model CronRun {
  task      String   @id // e.g. "digest.weekly"
  lastRunAt DateTime
}

model IdempotencyKey {
  key        String
  userId     String
  route      String
  statusCode Int
  response   Json
  createdAt  DateTime @default(now())

  @@id([userId, key])
}
```

Notes:
- **Balances are not stored.** They are computed from expenses, shares and confirmed settlements on each read. A group has dozens to hundreds of rows, so this is cheap and can never drift. Add a cache only if profiling shows a need.
- **Simplified transfers are not stored either.** They're derived. A `Settlement` row is created only when money actually moves.
- **Expenses are soft-deleted** (`deletedAt`) so activity entries can still describe them; soft-deleted rows are excluded from balances.
- **Balances only ever read `baseAmount`** (expenses, shares, settlements). Original amounts and currencies are kept for display ("€40 · ₪159").
- **Unread activity uses a watermark** (`User.activityReadAt`): anything newer is unread. The design only has "Mark all as read", so per-item read rows aren't needed.
- **Hebrew gender:** `Member.gender ?? User.gender`; when unknown, templates use neutral forms ("את/ה").

## 7. Core domain logic (`packages/core`)

Pure functions with exhaustive unit tests. The API calls them inside its transactions; the web app calls them for live previews.

```ts
// currency.ts
CURRENCIES: Record<string, { decimals: 0 | 2 | 3 }>  // ISO 4217 active codes
isCurrency(code): boolean
convert(amount: number, from: string, to: string, rate: string): number
  // decimal math (no floats): amount × rate, rescaled to `to` decimals, rounded half-even
crossRate(fromPerUsd: string, toPerUsd: string): string  // base units per 1 `from`

// split.ts
computeShares(input: {
  amount: number                      // original, expense currency
  baseAmount: number                  // converted; shares are returned in base currency
  payerId: string
  members: { id: string; order: number }[]
  mode: 'equal' | 'exact' | 'shares'
  included?: string[]                 // equal
  exact?: Record<string, number>      // exact; expense currency, must sum to `amount`
  shares?: Record<string, number>     // shares; integers ≥ 0, sum > 0
}): { memberId: string; amount: number; originalAmount?: number; shares?: number }[]
  // `amount` values sum to baseAmount exactly (largest remainder)

// balances.ts
computeBalances(expenses, shares, confirmedSettlements):
  { memberId, paid, share, sent, received, net }[]             // net = paid − share + sent − received

// simplify.ts
simplifyDebts(nets: { memberId: string; net: number }[]):
  { fromMemberId: string; toMemberId: string; amount: number }[]
  // Greedy min-cash-flow (handoff §7): match largest debtor with largest creditor.
  // Deterministic tie-break by member order so results don't flicker between requests.

// stats.ts
categoryTotals(expenses), memberStats(memberId, ...)

// reminders.ts
renderReminder({ tone, locale, gender, debtorName, creditorName, amount, currency, groupName, paymentDetails }): string

// invite.ts
generateInviteCode(): string        // 6 chars from 23456789ABCDEFGHJKLMNPQRSTUVWXYZ (no 0/O/1/I)
formatInviteCode('KR74QX') === 'KR7-4QX'
parseInviteCode('kr7-4qx') === 'KR74QX'

// payLinks.ts
buildPayOptions(details: PaymentDetails, amount: number, currency: string): PayOption[]
  // [{ method, label, url?, copyText? }] — see §9.8.1

// diff.ts
expenseDiff(before, after): { fields: Record<string, [unknown, unknown]>, netChanges: { memberId, before, after }[] }
```

**Required tests:**
- Handoff §10: the Crete seed data produces total ₪10,000, share ₪2,500 each, transfers `Noa → Alon ₪900` and `Itay → Alon ₪900`, and Maya settled.
- Multi-currency: a €40 expense at rate 3.9821 in an ILS group becomes `15928` agorot, split 3 ways as `5310 / 5309 / 5309` with the extra agora to the payer; a JPY (0 decimals) and a KWD (3 decimals) expense convert and split without losing units.

## 8. NestJS module layout

```
apps/api/src/
  main.ts                    bootstrap: helmet, pino, zod pipe, global filter, swagger
  app.module.ts
  prisma/                    PrismaService (+ transaction helper)
  common/
    guards/                  SessionGuard, GroupMemberGuard, GroupOwnerGuard
    decorators/              @Public, @CurrentUser, @CurrentMember
    filters/                 ApiExceptionFilter → error envelope (§4.4)
    interceptors/            IdempotencyInterceptor
    errors.ts                AppError(code, status, details)
  auth/                      Better Auth instance + Nest controller mounting /api/auth/*
  me/                        profile, settings, payment details, notification prefs, push subs, dashboard, stats, delete account
  groups/                    CRUD, close/reopen
  members/                   placeholders, leave
  invites/                   code lookup (public), join + claim, rotate
  expenses/                  CRUD + split validation via core
  uploads/                   presigned receipt URLs
  balances/                  balances + settle-up view
  settlements/               mark received, "I already paid", confirm/reject, undo
  reminders/                 compose/send, remind-all, auto-repeat stop
  activity/                  feed, counts, mark-read; ActivityService.record() used by other modules
  fx/                        ExchangeRate cache, feed clients, rate resolution, /fx endpoints
  notifications/
    channels/                EmailChannel, PushChannel, WhatsAppLinkBuilder, SmsLinkBuilder (SmsProvider later)
    notifications.service.ts fan-out per user prefs
  jobs/                      pg-boss setup + handlers; /internal/cron controller (§10)
  config/                    env validation + /config (feature flags for the client)
  health/                    /healthz, /readyz
```

Rule: services own transactions. A service method that changes data writes the change **and** its `Activity` row in one `prisma.$transaction`, then enqueues notification jobs after commit.

## 9. API reference (`/api/v1`)

Amounts are minor units. 🔓 = public (no session). Every `/groups/:groupId/...` route requires membership.

### 9.0 Config and exchange rates
| Method | Path | Query | Returns |
|---|---|---|---|
| GET 🔓 | `/config` | — | `{ auth: { google: true, emailOtp: true, phoneOtp: false, guest: true }, reminderChannels: ["push","email","whatsapp","sms"] }` |
| GET 🔓 | `/fx/currencies` | — | `[{ code: "EUR", decimals: 2 }, ...]` (names come from `Intl.DisplayNames` on the client) |
| GET | `/fx/rate` | `?from=EUR&to=ILS&date=2026-10-17` | `{ rate: "3.9821", date: "2026-10-17", source: "market" }`, used by the Add Expense screen to preview the conversion |

### 9.1 Me
| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/me` | — | user profile + `isGuest`, linked methods (google/email/phone), prefs |
| PATCH | `/me` | `{ name?, locale?, theme?, defaultCurrency?, gender?, contactPhone? }` | user |
| GET | `/me/payment-details` | — | `{ bitPhone, payboxPhone, paypalMe, revolutTag, bankDetails }` |
| PUT | `/me/payment-details` | same | same |
| GET | `/me/notification-prefs` | — | 4 booleans |
| PATCH | `/me/notification-prefs` | partial | same |
| POST | `/me/push-subscriptions` | `{ kind, endpoint, keys? }` | `{ id }` |
| DELETE | `/me/push-subscriptions/:id` | — | 204 |
| GET | `/me/dashboard` | — | see below |
| GET | `/me/stats` | `?month=2026-10` | `{ myShareOfExpenses, paidBackToMe, remindersSent }` per currency |
| DELETE | `/me` | `{ confirm: "DELETE" }` | 204 (§11.3) |

`GET /me/dashboard` (Home screen):
```json
{
  "totals": [{ "currency": "ILS", "net": 68000, "owedToMe": 180000, "iOwe": 34000,
               "owedByPeople": 3, "owedInGroups": 2, "oweToPeople": 1, "oweInGroups": 1 }],
  "overall": { "currency": "ILS", "net": 68000, "owedToMe": 180000, "iOwe": 34000, "approximate": false },
  "groups": [{ "id": "...", "name": "Crete trip", "type": "trip", "currency": "ILS",
               "startDate": "2026-10-12", "endDate": "2026-10-18",
               "memberCount": 4, "myNet": 180000, "settled": false, "closedAt": null }],
  "needsAttention": [
    { "kind": "iOwe", "groupId": "...", "groupName": "The flat", "memberId": "...", "name": "Roni",
      "amount": 34000, "note": "Electricity & city tax" },
    { "kind": "owedToMe", "groupId": "...", "groupName": "Crete trip", "memberId": "...", "name": "Noa",
      "amount": 90000, "since": "2026-10-19T..." }
  ],
  "recentActivity": [ /* first 5 activity items, same shape as /activity */ ]
}
```
`totals` has one entry per group base currency (exact). `overall` is everything converted to the user's default currency at the latest rates, for the hero card; `approximate: true` when any conversion happened, so the client shows "≈".

### 9.2 Groups
| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/groups` | `?status=active\|closed` | group cards (same shape as dashboard `groups`) |
| POST | `/groups` | `{ name, type, currency, startDate?, endDate?, members: [{ displayName, email?, phone? }] }` | group + members + invite (creator becomes `owner` member) |
| GET | `/groups/:groupId` | — | group, members, my stats `{ totalSpent, myShare, iPaid, myNet }`, `expenseCount` |
| PATCH | `/groups/:groupId` | `{ name?, type?, startDate?, endDate?, currency? }` (owner; base currency only before first expense) | group |
| POST | `/groups/:groupId/close` | — (owner) | group |
| POST | `/groups/:groupId/reopen` | — (owner) | group |
| DELETE | `/groups/:groupId` | — (owner, no expenses) | 204 |

### 9.3 Members
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/groups/:groupId/members` | `{ displayName, email?, phone? }` | member (placeholder) |
| PATCH | `/groups/:groupId/members/:memberId` | `{ displayName?, gender?, email?, phone? }` (self, or anyone for placeholders) | member |
| DELETE | `/groups/:groupId/members/:memberId` | — (placeholder with no money rows) | 204 |
| POST | `/groups/:groupId/leave` | — | 204, or `409 LEAVE_WITH_OPEN_BALANCE` |

Leaving sets `leftAt`; the member stays in history and balances.

### 9.4 Invites and joining
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/groups/:groupId/invite` | — | `{ code: "KR7-4QX", url: "https://shulam.app/j/KR7-4QX", expiresAt }` (QR is drawn client-side from `url`) |
| POST | `/groups/:groupId/invite/rotate` | — (owner) | new invite; old code returns `410` |
| GET 🔓 | `/invites/:code` | — | preview (below) |
| POST | `/invites/:code/join` | `{ claimMemberId?: string }` — omit for "I'm someone new" | `{ groupId, memberId }` |

Preview (`Join.dc.html`), rate-limited to 30/min per IP:
```json
{
  "group": { "name": "Crete trip", "type": "trip", "startDate": "2026-10-12", "endDate": "2026-10-18",
             "memberCount": 4, "expenseCount": 6, "totalSpent": 1000000, "currency": "ILS" },
  "invitedBy": { "name": "Alon", "color": "#C6F135" },
  "claimable": [{ "memberId": "...", "displayName": "Noa", "color": "#FFB59A" }]
}
```

Join rules:
- The caller needs a session (guest or real). "Join with Google as Noa" = the client keeps `{ code, claimMemberId }` across the OAuth redirect, then calls join.
- Claiming is atomic: `UPDATE member SET userId = ? WHERE id = ? AND groupId = ? AND userId IS NULL`. Zero rows → `409 MEMBER_ALREADY_CLAIMED`.
- Already a member → `200` with the existing member (idempotent).
- Closed group → `409 GROUP_CLOSED`.

### 9.5 Expenses
| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/groups/:groupId/expenses` | `?cursor&limit&category&memberId` | expenses ordered by `date desc, createdAt desc`, with shares |
| POST | `/groups/:groupId/expenses` | below | expense |
| GET | `/groups/:groupId/expenses/:expenseId` | — | expense + shares + `receiptUrl` (signed, 15 min) |
| PATCH | `/groups/:groupId/expenses/:expenseId` | same fields, all optional, + `version` (required) | expense |
| DELETE | `/groups/:groupId/expenses/:expenseId` | — | 204 (soft delete) |

Create body:
```json
{
  "amount": 4000,
  "currency": "EUR",
  "fxRate": null,
  "description": "Sunset cocktails",
  "category": "food",
  "paidByMemberId": "mem_alon",
  "date": "2026-10-17",
  "receiptKey": "receipts/grp_x/abc.jpg",
  "split": {
    "mode": "equal",
    "included": ["mem_alon", "mem_noa", "mem_itay"]
  }
}
```
`split` is one of `{ mode: "equal", included }`, `{ mode: "exact", amounts: { memberId: amount } }` (in the expense currency) or `{ mode: "shares", shares: { memberId: n } }`.

`currency` defaults to the group currency. `fxRate` is optional: `null` = look up the market rate for `date` (§4.2); a decimal string = manual rate. The response includes `fxRate`, `fxSource`, `fxDate` and `baseAmount`.

The server validates that the payer and all split members are members of this group, resolves the rate, converts, then recomputes shares with `core.computeShares`. **The client never sends final share amounts for `equal`/`shares`.** For `exact`, a mismatched sum returns `400 SPLIT_SUM_MISMATCH`. The "effect on your balance" preview is computed client-side with the same core function and the rate from `GET /fx/rate`, so no preview endpoint is needed.

#### 9.5.1 Edits and deletes notify the group
Any member may edit or delete any expense. Each change:
1. Stores an `expense.updated` / `expense.deleted` activity whose payload holds the editor, a field-level diff (`core.expenseDiff`: e.g. `amount: [48000, 52000]`, `paidBy: ["Noa", "Itay"]`) and each member's balance change in this group.
2. Notifies, via in-app activity + push:
   - **Members affected** (payer, or a share before or after the change, or whose net balance moved): **always**, regardless of preferences, because their money changed.
   - **Everyone else in the group:** if their "New expenses" preference is on (that toggle covers new, edited and deleted expenses; its description in Settings becomes "When someone adds, edits or deletes an expense").
3. Never notifies the editor themselves.

Several edits to the same expense by the same person within 5 minutes are collapsed into one notification (the activity rows are still all kept).

### 9.6 Uploads
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/uploads/receipts` | `{ groupId, contentType, size }` | `{ key, uploadUrl, expiresAt }` |

Allowed types: `image/jpeg`, `image/png`, `image/webp`, `image/heic`; max 10 MB. The key is scoped to the group (`receipts/<groupId>/<cuid>.<ext>`), and the expense endpoint rejects keys from another group. Orphaned uploads (no expense after 24h) are deleted by a job.

### 9.7 Balances and settle up
| Method | Path | Returns |
|---|---|---|
| GET | `/groups/:groupId/balances` | `{ currency, totalSpent, members: [{ memberId, paid, share, sent, received, net }], transfers: [{ fromMemberId, toMemberId, amount }], byCategory: [{ category, amount }], expenseCount }` |
| GET | `/groups/:groupId/settle` | settle-up view (below) |

`GET /settle` (`SettleUp.dc.html`):
```json
{
  "currency": "ILS",
  "outstanding": [
    { "fromMemberId": "mem_noa", "toMemberId": "mem_alon", "amount": 90000,
      "lastReminder": { "sentAt": "...", "channel": "whatsapp", "autoRepeat": true } | null,
      "pendingClaim": { "settlementId": "...", "amount": 90000 } | null }
  ],
  "settled": [ { "settlementId": "...", "fromMemberId": "mem_maya", "toMemberId": "mem_alon",
                 "amount": 50000, "currency": "ILS", "baseAmount": 50000, "confirmedAt": "..." } ],
  "progress": { "settled": 50000, "total": 230000 },
  "myPaymentDetails": { "bitPhone": "...", "bankDetails": "..." },
  "myPayOptions": [
    { "toMemberId": "mem_roni", "amount": 34000, "currency": "ILS",
      "options": [ /* PayOption[] built from the creditor's payment details, §9.8.1 */ ] }
  ]
}
```
`myPayOptions` lists, for each transfer where the caller is the debtor, the ways to pay that creditor. It powers the "Pay ₪340" button.
`outstanding` shows every transfer in the group. The client highlights the ones involving the caller. `progress.total` = confirmed settlements + current outstanding.

### 9.8 Settlements
| Method | Path | Body | Who | Effect |
|---|---|---|---|---|
| POST | `/groups/:groupId/settlements` | `{ fromMemberId, toMemberId, amount, currency?, fxRate?, method? }` | creditor (`to`) | status `confirmed` → "Mark received", green stamp |
| POST | same | same | debtor (`from`) | status `pending` → "I already paid"; creditor notified |
| POST | `/groups/:groupId/settlements/:id/confirm` | — | creditor | `pending → confirmed` |
| POST | `/groups/:groupId/settlements/:id/reject` | — | creditor | `pending → rejected` |
| DELETE | `/groups/:groupId/settlements/:id` | — | creator, within 24h | undo (hard delete + activity) |

Only `confirmed` settlements count in balances. A settlement can be paid in any currency (e.g. the trip group is in ILS but Noa paid back in EUR); it's converted like an expense and `baseAmount` counts. `baseAmount` may be less than the outstanding amount (partial payment). More than the outstanding amount plus a 1% tolerance for rate differences is rejected with `400 VALIDATION_FAILED`. A remainder within that tolerance is written off, so rate rounding never leaves "₪0.37 owed". Confirming a settlement stops any auto-repeat reminders for that pair once their outstanding amount reaches 0.

#### 9.8.1 Pay options ("Pay ₪340")
`core.buildPayOptions` turns the creditor's payment details into actions for the debtor:

| Method | What the button does | Prefilled amount |
|---|---|---|
| PayPal | Opens `https://paypal.me/<user>/<amount><CUR>` (PayPal's documented format) | Yes |
| Revolut | Opens `https://revolut.me/<tag>` | No (amount copied) |
| Bit | Copies the phone number and amount, then opens the Bit app or store | No |
| PayBox | Copies the phone number and amount, then opens the PayBox app or store | No |
| Bank | Copies the bank details and amount | — |

**Bit and PayBox:** I'm not aware of a public, documented link format that opens either app with recipient and amount filled in. Their payment-request features are for businesses. v1 uses copy + open-app. Researching official links is a separate task; if one exists, only `buildPayOptions` changes. Revolut's amount parameter also needs checking.

After paying, the debtor taps "I already paid" (pending settlement, §9.8) and the `method` records which option they used.

### 9.9 Reminders
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/groups/:groupId/reminders` | `?toMemberId` | history |
| POST | `/groups/:groupId/reminders` | `{ toMemberId, tone, channel, message, autoRepeat }` | reminder (+ `waUrl` for WhatsApp) |
| POST | `/groups/:groupId/reminders/all` | `{ tone, channel, autoRepeat }` | `{ created: Reminder[], skipped: [{ memberId, reason }] }` |
| POST | `/groups/:groupId/reminders/:id/stop` | — | stops auto-repeat |

Behaviour:
- Only allowed when `toMemberId` currently owes the caller (from the simplified transfers). The server sets `amount` from current balances.
- The composer's tone templates come from `core.renderReminder` (the client renders them for preview). The user may edit the text; the server stores `message` as sent, with payment details appended if not already present.
- Channel availability (all free):
  - `push`: recipient is a claimed member with a user (also creates an in-app activity item visible only to them). Sent by the server.
  - `email`: recipient has an email. Sent by the server (Resend).
  - `whatsapp`: recipient has a phone (`contactPhone` or `invitePhone`). The server returns `link = https://wa.me/<e164>?text=<encoded>` and the client opens it. Status `handed_off`.
  - `sms`: recipient has a phone. The server returns `link = sms:<e164>?body=<encoded>` (the client switches to `&body=` on iOS) and the client opens the sender's own messaging app, so the text goes from their phone at no cost to us. Status `handed_off`. Server-sent SMS comes later through `SmsProvider`.
  - Not available → `422 REMINDER_CHANNEL_UNAVAILABLE` with `details.alternatives`.
- Rate limit: max 1 reminder per pair per 12h (excluding auto-repeat).
- **Auto-remind** (every 3 days until paid): the server sends it itself for `push` and `email`. For `whatsapp` and `sms` the server can't send, so auto-repeat instead sends the *creditor* a push: "Time to nudge Noa again", with the prebuilt link.
- The recipient's locale and gender pick the template language and grammar; a placeholder without a user uses the group owner's locale.

### 9.10 Activity
| Method | Path | Query / body | Returns |
|---|---|---|---|
| GET | `/activity` | `?type=expense\|payment\|reminder\|member&groupId&cursor&limit` | `{ items, nextCursor }` |
| GET | `/activity/counts` | `?groupId` | `{ all, expense, payment, reminder, member, unread }` |
| POST | `/activity/mark-read` | `{ upTo?: ISO timestamp }` (default now) | 204 |
| GET | `/groups/:groupId/activity` | same as `/activity` | group-scoped feed |

Item:
```json
{
  "id": "...", "groupId": "...", "groupName": "Crete trip",
  "type": "payment", "event": "payment.confirmed",
  "actor": { "memberId": "...", "name": "Maya", "color": "#9EE6CF" },
  "payload": { "amount": 50000, "currency": "ILS", "toName": "Alon" },
  "createdAt": "...", "unread": true
}
```
The feed shows items from groups where the caller is an active member (`audienceUserId IS NULL`), plus items addressed to them. The client buckets them into Today / Yesterday / Earlier in the user's time zone.

Events written: `group.created`, `member.added`, `member.joined`, `member.claimed`, `member.left`, `expense.created`, `expense.updated`, `expense.deleted`, `payment.confirmed`, `payment.claimed`, `payment.rejected`, `reminder.sent` (audience = debtor), `reminder.received` (audience = debtor's user).

## 10. Background jobs (pg-boss)

| Job | Trigger | Does |
|---|---|---|
Two kinds of jobs, because the free API host sleeps when idle (§13.1):

**Event jobs** run in pg-boss inside the API process, enqueued right after a request commits (the process is awake then):

| Job | Trigger | Does |
|---|---|---|
| `reminder.deliver` | Reminder created (push/email) | Sends; retries 3× with backoff; sets `sent`/`failed` and creates the in-app item |
| `notify.activity` | After an activity write | Picks recipients (§9.5.1 for expense changes), checks `NotificationPrefs`, then push (and email for `remindersToMe`) |

**Time-based jobs** run from `POST /internal/cron`, called every 5 minutes by cron-job.org with a shared secret header. Each task checks what is due in the database, so a missed tick is caught up by the next one and nothing depends on the process having stayed awake:

| Task | When due | Does |
|---|---|---|
| `reminders.autoRepeat` | `Reminder.nextRunAt <= now()` | Recomputes outstanding for the pair; if 0, stops. Else re-renders with the current amount, sends a child reminder (or nudges the creditor for WhatsApp/SMS), sets the next run (+3 days). Row-locked (`FOR UPDATE SKIP LOCKED`) so overlapping ticks can't double-send |
| `fx.daily` | No rates stored for today | Fetches the day's rates (§4.2) |
| `digest.weekly` | Sunday ≥ 09:00 `Asia/Jerusalem` and not yet sent this week | Email/push "who owes whom" to users with `weeklySummary` |
| `cleanup.guests` | Daily | Delete anonymous users with no memberships, inactive 30 days |
| `cleanup.uploads` | Daily | Delete unreferenced receipt objects older than 24h |
| `cleanup.idempotency` | Hourly | Delete idempotency keys older than 24h |

A `CronRun(task, lastRunAt)` table records when each daily, weekly or hourly task last ran.

Event jobs are enqueued **after** the database transaction commits. A crash between commit and enqueue loses a notification, never data. That's acceptable in v1; switch to a transactional outbox if it ever matters.

## 11. Security and privacy

### 11.1 Hardening
- `helmet`, strict CORS (mobile origins only; web goes through the same-origin proxy).
- Better Auth's built-in CSRF/origin checks, plus `SameSite=Lax` cookies.
- `@nestjs/throttler`: global 120 req/min per user; strict limits on OTP send/verify (§5.1), invite preview (§9.4), reminders (§9.9).
- `/internal/cron` requires a secret header (`CRON_SECRET`), compared in constant time, and is excluded from the public OpenAPI spec.
- Email OTP limits also protect the Resend free quota.
- Every group-scoped query filters by `groupId` from the **guard-verified** member, never from the body.
- Validation with Zod on every input; amounts are positive integers ≤ 100,000,000 (₪1M) per expense.
- Receipts are only reachable through short-lived signed URLs; the bucket is private.

### 11.2 PII
Names, emails, phones, payment details. Log redaction for `email`, `phone`, `bankDetails`, OTP codes and the auth headers.

### 11.3 Deleting an account
In one transaction:
1. Unlink the user from every `Member` (`userId = null`). Each member keeps its `displayName` so the other members' balances and history stay correct. The deleted person becomes a placeholder in each group.
2. Delete payment details, prefs, push subscriptions, sessions, accounts.
3. Scrub the user row (name, email, phone → null), set `deletedAt`, then delete it.

Groups where they were the only member are deleted. Ownership of other groups passes to the longest-standing remaining member.

## 12. Testing

| Level | Tooling | Covers |
|---|---|---|
| Unit | Vitest on `packages/core` | split modes, rounding, balances, simplification (seed data from handoff §10), templates, invite codes |
| Integration | Jest + Testcontainers Postgres | services with a real DB: transactions, claim races, version conflicts, guest merge |
| E2E (API) | supertest against the Nest app | auth guard, membership guard, error envelope, idempotency, main flows end to end |
| Contract | OpenAPI snapshot check in CI | breaking API changes are visible in review |

Seed script (`prisma/seed.ts`) loads the handoff §10 data, including "The flat", "Friday dinners" and "Gift for Dana", so the web app looks like the mocks in development.

## 13. Operations

### 13.1 Zero-cost hosting
Requirement: run for free for now. Every service below has a free tier with no paid add-ons. **Free-tier limits change often: verify each one when setting up.**

| Need | Service (free tier) | Limits to watch |
|---|---|---|
| Web app | Vercel Hobby | Hobby is for non-commercial use; move to Pro (or Cloudflare Pages) if the app starts earning |
| API (NestJS) | Render free web service | Sleeps after ~15 min without requests and takes ~30–60 s to wake. The 5-minute cron ping keeps it awake, and one always-awake service fits in the monthly free hours |
| Postgres | Supabase free (used as plain Postgres only) | ~500 MB storage; project pauses after a week with no activity (the cron ping prevents that). Not Neon: its free plan limits compute hours, and pg-boss polling would use them up |
| Scheduler | cron-job.org | Calls `/internal/cron` every 5 min |
| Email | Resend free | Daily and monthly send caps; one verified domain |
| Receipts | Cloudflare R2 free | 10 GB storage; no egress fees |
| Push | Web Push (VAPID) / Expo push | Free, no account needed for Web Push |
| Exchange rates | fawazahmed0/exchange-api, Frankfurter | Free, no key |
| Errors | Sentry free | Monthly event cap |
| Domain | Optional: `*.onrender.com` / `*.vercel.app` are free | A custom domain is the only likely cost; needed for nicer invite links and for sending email from your own address |

**The weak spot is Render's sleep.** If the ping stops, the first request after idle is slow and pg-boss jobs pause until the process wakes. Time-based jobs survive because they run from the database on the next tick (§10). If this becomes a problem, the next step is still free: an Oracle Cloud Always Free VM running the API with Docker, which never sleeps, at the cost of managing a server yourself.

**Same-origin proxy on free hosting:** Vercel rewrites `/api/*` to the Render URL, so session cookies still work without a custom domain.

### 13.2 Everything else
- **Environments:** local (Docker Compose: Postgres + MinIO for S3 + Mailpit for email), production. Add staging later (another free Render + Supabase pair).
- **Config:** validated at boot with Zod (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `VAPID_*`, `R2_*`, `APP_URL`, `CRON_SECRET`, `AUTH_PHONE_OTP_ENABLED`).
- **Migrations:** `prisma migrate deploy` runs on release before the new version starts.
- **Health:** `/healthz` (process up), `/readyz` (DB reachable, pg-boss started).
- **Observability:** request ID per request (returned in errors), pino JSON logs, Sentry for exceptions, a log line per cron task run.
- **Backups:** the Supabase free tier has no point-in-time recovery. A weekly `pg_dump` from a scheduled GitHub Action into a private R2 bucket is a free stand-in.

## 14. Build order (backend side of handoff §11)

1. **Foundation:** monorepo, `packages/core` with currency table + conversion + split/balance/simplify + seed and multi-currency tests, Nest skeleton, Prisma schema + migrations, error filter, config, health, Docker Compose.
2. **Auth:** Better Auth (Google, email OTP via Resend/Mailpit, anonymous; phone OTP behind its off-by-default flag), session guard, `/me`, `/config`, guest linking + merge.
3. **Groups:** create/list/get, placeholder members, invites, join + claim, dashboard.
4. **Expenses:** FX module + daily rates, CRUD in any currency, split validation, edit/delete diffs + notifications, receipts upload, balances endpoint, activity writes.
5. **Settle up:** settlements in any currency (mark received, I already paid, confirm/reject/undo), pay options, settle view, reminders (push, email, WhatsApp link, SMS link), `/internal/cron` + auto-repeat.
6. **Activity & settings:** feed, counts, mark-read, notification prefs + fan-out, payment details, stats, weekly digest, delete account.
7. **Deploy (free tier):** Render + Supabase + Vercel + cron-job.org + R2 per §13.1.
8. **Mobile readiness:** bearer auth, Expo push channel, API client package published for the app.

## 15. Decisions log

| # | Question | Decision (2026-10-24) | Where |
|---|---|---|---|
| 1 | Who can edit or delete expenses? | Any member; changes notify the other members | §5.4, §9.5.1 |
| 2 | Currencies | Any ISO 4217 currency, per group and per expense/settlement, with locked exchange rates | §4.2, §6, §9.0, §9.5 |
| 3 | "Pay" button | Pay options with deep links where a documented format exists (PayPal); copy + open-app for Bit/PayBox until official links are found | §9.8.1 |
| 4 | Guest banner wording | Changed to describe a guest account on the server | §5.2 |
| 5 | SMS provider | None for now (zero cost). Phone login disabled; SMS reminders open the sender's own messaging app | §1, §5.1, §9.9, §13.1 |

### Implementation notes (step 2, auth)
- **Guest linking** uses Better Auth's `onLinkAccount` hook: signing in with Google or email while holding a guest session moves the guest's `Member` rows to the signed-in account, then Better Auth deletes the guest user. The result is the same as "upgrading the row", but the user id changes. If the account is already in the same group, the guest's member stays as a placeholder (`mergeGuestInto`, tested).
- **OTP attempts:** Better Auth allows 3 wrong tries, then returns `403 TOO_MANY_ATTEMPTS` and kills the code. It does not return "tries left". Showing "2 tries left" needs either a client-side counter or a custom hook. Not done.
- **OTP send limits** (60 s cooldown, 5/hour per destination, 20/hour per IP) are in-memory (`OtpLimiter`), applied before Better Auth's handler. A restart resets them.
- **Guest name:** `sign-in/anonymous` takes no body, so the client signs in and then calls `PATCH /me { name }`. Until then the name is "Anonymous".
- **Email:** Resend when `RESEND_API_KEY` is set, otherwise Mailpit's HTTP API (local).

### Implementation notes (step 3, groups)
- **Rotated invites** return `404 INVITE_NOT_FOUND`, not `410`: the invite is one row per group, so the old code is simply gone. `410 INVITE_EXPIRED` is still used for `expiresAt` in the past and `revokedAt` set.
- **New error codes:** `GROUP_HAS_EXPENSES` (delete group), `CURRENCY_LOCKED` (change base currency after first expense), `MEMBER_HAS_ACTIVITY` (remove placeholder with money rows), all `409`.
- **Owner cannot leave** (`403 FORBIDDEN`): there is no ownership transfer in the design yet.
- **Rejoin:** joining a group you left reactivates your old member row (history intact).
- **Dashboard:** `overall` only covers groups already in the user's default currency and lists `excludedCurrencies`; real conversion arrives with the FX module (step 4). `recentActivity` is `[]` until `/activity` (step 6). `needsAttention` items carry `currency` and come from simplified transfers; `note` and `since` are not filled yet.
- **Preview rate limit** (30/min per IP) is in-memory, like the OTP limits.
- Group, member and join changes write `Activity` rows (`group.*`, `member.*`) in the same transaction.

### Implementation notes (step 4, expenses)
- **FX:** `FxService.rateFor` reads `ExchangeRate`, fetches a missing day from fawazahmed0 (Frankfurter as fallback), and stores every currency in the core table in USD terms. If both feeds fail it uses the newest cached day on or before the date (or the oldest cached one for a backdated expense), and `fxDate` shows the day actually used. A failed fetch is not retried for 60 s; a successful one is not repeated for an hour. `FX_RATE_UNAVAILABLE` only happens with an empty cache. `FxService.ensureToday()` is ready for the `fx.daily` cron task (step 5).
- **Rate on edit:** amount, currency or date edits re-resolve the market rate; a manual rate survives such edits unless the currency changes or a new `fxRate` is sent. `fxRate: null` switches back to the market rate. Edits that touch none of the three keep the locked rate.
- **Edit/delete activity:** `expense.updated` / `expense.deleted` payloads hold `actor`, `diff` (payer shown by name), `netChanges` per member and `affectedMemberIds`. An edit that changes nothing writes no activity and no notification (the version still increments). **Push/email fan-out and the 5-minute collapse of repeat edits are step 6**; the payload already has what the recipient rules in §9.5.1 need.
- **Receipts:** `POST /uploads/receipts` presigns an R2 `PUT` with content type and length in the signature. Without `R2_*` env it answers `503 UPLOADS_UNAVAILABLE`. `GET /expenses/:id` returns a 15-minute `receiptUrl`. The orphan cleanup job is step 5.
- **Idempotency:** `IdempotencyInterceptor` covers `POST /groups/:id/expenses`, `POST /groups` and `POST /invites/:code/join`. Only successful responses are stored. Reusing a key on another route returns `400`. Concurrent duplicates wait on the first request (in-process, fine for one process). Settlements and reminders will use it in step 5.
- **Dashboard:** `overall` now converts other currencies at the latest market rate and sets `approximate: true`; only currencies with no rate at all land in `excludedCurrencies`.
- **Balances:** `GET /groups/:id/balances` returns members, simplified transfers and `byCategory`. Only confirmed settlements count, so it matches the dashboard.
- **Left members:** new expenses require active members; an edit or delete may still reference members who have left if they were already in that expense.

### Implementation notes (step 5, settle up)
- **core:** `buildPayOptions`, `renderReminder` (3 tones × he/en, Hebrew verbs agree with the debtor's gender, neutral slash forms when unknown), `appendPaymentDetails` (skips if the text already carries a detail), `whatsappLink`, `smsLink`, `formatMoney`, `toMajorString`. `PayOption` also carries `amountPrefilled`.
- **Settlements:** the 1% tolerance works both ways. A payment up to 1% above what is owed is accepted and counted as exactly what is owed; one up to 1% below is the same (the remainder is written off). `baseAmount` is therefore the amount that counts, which can differ from the converted amount by under 1%. A pending claim is re-fitted against the outstanding amount when the creditor confirms. A pair with no current simplified transfer has outstanding 0, so any payment for it is rejected with `400 VALIDATION_FAILED` (`details.outstanding`). Undo writes `payment.undone` (not in §9.10's list). New error code `SETTLEMENT_NOT_PENDING` (409) for confirm/reject on a decided claim. Confirm/reject return `200`.
- **Reminders:** reachability is derived, not stored: `push` = recipient has a user; `email` = user email (not a guest) or `inviteEmail`; `whatsapp`/`sms` = `contactPhone` or `invitePhone`. The 12 h cooldown ignores failed sends and auto-repeat children. `message` is optional; omitted, the server renders the tone template in the recipient's locale (owner's for a placeholder). "Remind everyone" reports `skipped[].reason` as the error code (`REMINDER_CHANNEL_UNAVAILABLE`, `RATE_LIMITED`).
- **Delivery without pg-boss:** email is sent right after the commit, 3 tries with short backoff, and the row ends `sent` or `failed` (with `error`); the response shows the final status. `push` is in-app only for now: the `reminder.received` activity is the notification, real Web Push joins the fan-out in step 6. This keeps step 5 free of a queue dependency; the event-job design in §10 still applies when step 6 adds fan-out.
- **Activity audience:** `reminder.sent` is private to the sender (a placeholder debtor has no user id, so addressing it to the debtor as §9.10 reads would make it group-wide); `reminder.received` is private to the debtor's user. New event `reminder.nudge` (audience = creditor) is written when an auto-repeat WhatsApp/SMS reminder comes due, with the prebuilt `link`.
- **Auto-repeat:** `RemindersService.runDue` locks due rows with `FOR UPDATE SKIP LOCKED` inside a transaction, re-renders with the current amount, writes a child reminder (`parentId`), and moves the original's `nextRunAt` to now + 3 days (not +3 days from the old time, so an outage does not cause a burst). It stops the chain when the pair owes nothing, the group is closed, the creditor left, or the recipient lost the channel. Marking a payment received also stops the chain at once when the pair reaches 0.
- **Cron:** `POST /internal/cron` (header `X-Cron-Secret`, constant-time compare) runs `reminders.autoRepeat` and `fx.daily` every tick, and `cleanup.idempotency` (hourly), `cleanup.uploads` (daily, R2 objects under `receipts/` older than 24 h with no expense), `cleanup.guests` (daily, anonymous users with no membership and no session activity for 30 days). Periodic tasks are claimed with a conditional update on `CronRun`, so overlapping ticks cannot both run one. `digest.weekly` waits for step 6. The route is `@Public()` (no session) and protected only by the secret.
- **Idempotency:** `POST /settlements`, `/reminders` and `/reminders/all` use `Idempotency-Key`.

### Implementation notes (step 6, activity & settings)
- **Feed:** `/activity`, `/activity/counts`, `/activity/mark-read`, `/groups/:groupId/activity`. Newest first with an opaque `createdAt|id` cursor. `type` buckets are `expense|payment|reminder|member`; `group.*` events show only in the unfiltered feed and in `counts.all`. `unread` = newer than `User.activityReadAt` and not your own action. `mark-read` only moves the watermark forward (a stale `upTo` is ignored) and caps it at now. Dashboard `recentActivity` is the first 5 items.
- **Fan-out:** `NotificationsService.dispatch(activityIds)` runs after the transaction that wrote the rows and never throws. It is push only: reminder emails are already sent by the reminder flow, so `notify.activity` does not email, and there is no pg-boss queue (same reasoning as step 5). Rules: expense events go to `affectedMemberIds` always and to other active members with `newExpenses` on, never to the actor; `payment.claimed` → creditor (`paymentsReceived`); `payment.confirmed` → creditor (`paymentsReceived`) and payer (always), each unless they did it; `payment.rejected` → payer; `reminder.received` → debtor (`remindersToMe`, and only when the reminder channel was `push`; its payload now carries `channel`); `reminder.nudge` → creditor. `payment.undone` and member/group events are not pushed. Repeat `expense.updated` by the same person for the same expense within 5 minutes of the previous one push once (activity rows are all kept).
- **Push:** `PushService` sends Web Push (needs `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`; `web-push generate-vapid-keys`) and Expo push (plain HTTPS, no key). `GET /config` returns `push.vapidPublicKey` (null = web push off). Subscriptions that answer 404/410 or `DeviceNotRegistered` are deleted. `POST /me/push-subscriptions` is an upsert on `endpoint`, so a device moves to whoever subscribed last.
- **Me:** `PUT /me/payment-details` replaces the record (fields left out or `""` are cleared). `GET/PATCH /me/notification-prefs` (no row = defaults). `GET /me/stats?month=YYYY-MM` (UTC month, default current) answers `{ month, perCurrency: [{ currency, myShareOfExpenses, paidBackToMe }], remindersSent }`: share of non-deleted expenses dated in the month, confirmed payments received in the month (by `confirmedAt`), and non-failed reminders the user sent themselves (auto-repeats excluded).
- **Weekly digest:** `digest.weekly` runs from the cron tick once the last run is older than the most recent Sunday 09:00 `Asia/Jerusalem` (DST-safe), so a missed tick is caught up. Users with `weeklySummary` on get one line per simplified transfer they are in (open groups only), by push and, for non-guests, email, in their locale. Nothing to report = nothing sent.
- **Delete account** (`DELETE /me`, body `{ confirm: "DELETE" }`, 204): as §11.3, plus private activity, idempotency keys and email-OTP verifications are removed. A group with no other active signed-in member is deleted with its expenses and settlements. The deleted person's own `Member` rows become placeholders (`role` reset to `member`).

### Implementation notes (step 7, deploy)
- Everything is checked in; the runbook is [`DEPLOY.md`](DEPLOY.md). No account could be created from here, so signing up and pasting secrets is manual.
- **Image:** root `Dockerfile` (node 22 slim, multi-stage, builds `packages/core` then the API). Verified locally: it applies both migrations to an empty database and `/readyz` answers `ready`. `render.yaml` is a free-plan Blueprint with `/healthz` as the health check; secrets are `sync: false` so they are typed into Render, never committed.
- **Migrations:** Render's free plan has no pre-deploy command, so the container runs `prisma migrate deploy` before `node dist/main.js`. Use Supabase's session pooler URI (port 5432); the transaction pooler breaks migrations.
- **Cron URL** is `POST /api/v1/internal/cron` (the global prefix applies), not `/internal/cron` as §3 and §10 abbreviate it.
- **Proxy:** `main.ts` sets `trust proxy` to 1 so the in-memory IP rate limits and OTP limits see the client IP behind Render, not the proxy's.
- **CI:** `.github/workflows/ci.yml` (build, typecheck, migrate against Postgres 16, tests) on `main`, `dev` and PRs. `backup.yml` is the weekly `pg_dump` to R2 from §13.2 (needs GitHub secrets). Render deploys from `main` only.
- **R2:** private bucket, token scoped to it, CORS allows `PUT`/`GET` from the web origin (runbook has the JSON). `/readyz` still checks only the database (pg-boss was never added).

### Still open
- Official Bit / PayBox payment links (research task, §9.8.1).
- Custom domain: optional, but the only likely cost.
