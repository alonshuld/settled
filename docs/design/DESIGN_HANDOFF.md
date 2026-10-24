# שולם / Settled — Design handoff

Group expense splitting, one group per occasion (trip, flat, dinner, gift). Users log who paid what; the app shows who owes whom, simplifies debts to the fewest transfers, and lets people send payment reminders.

The reference screens live in `screens/*.dc.html`. They are design prototypes, not production code: markup + inline styles + a small logic class. `{{name}}` is a template hole filled by `renderVals()`, `<sc-for>` is a loop, `<sc-if>` a conditional. **Read them for layout, spacing, copy (Hebrew + English dictionaries are inside each file's script) and behaviour, then rebuild in the real stack.**

---

## 1. Requirements (from the product owner)

- Web app, desktop + phone (responsive). Later: iOS + Android.
- Light and dark mode.
- Hebrew (default, RTL) and English (LTR). App name: **שולם** in Hebrew, **Settled** in English (working name).
- Sign in: **Google**, **email or phone with a one-time code (no passwords)**, or **guest** (name only, data on device, can link an account later).
- Create groups per occasion, join by link / 6-char code / QR, claim a placeholder member ("which one is you?").
- Add expenses with split modes: equal (choose who's included), exact amounts, shares.
- Balances + simplified "who owes whom".
- Remind people to pay (tone + channel + auto-repeat), mark payments received.
- Loading states (splash + skeletons) and error pop-ups.

## 2. Screens → suggested routes

| File | Screen | Route |
|---|---|---|
| `Main.dc.html` | Welcome & sign in (Google / email-phone OTP / guest), OTP step, success | `/login` |
| `Home.dc.html` | My groups dashboard: net balance, owed / owe, group cards, "needs attention", recent activity | `/` |
| `NewGroup.dc.html` | Create group: name, occasion type, currency, dates, members, invite link + QR, live preview | `/groups/new` |
| `Join.dc.html` | Join via invite: group preview, claim placeholder member, join with Google / guest, code entry | `/j/:code` |
| `Group.dc.html` | Group: stats, Expenses tab (by day), Balances tab (diverging bars, by category), who-owes-whom panel | `/groups/:id` |
| `AddExpense.dc.html` | Add expense: amount, description, category, payer, date, receipt, split modes, live impact | `/groups/:id/expenses/new` |
| `SettleUp.dc.html` | Settle up: transfers, mark received, reminder composer (tone, channel, auto-remind), payment details | `/groups/:id/settle` |
| `Activity.dc.html` | Activity feed with filters, reminder you received | `/activity` |
| `Settings.dc.html` | Profile, guest-upgrade banner, theme, language, currency, notifications, payment details, sign out / delete | `/settings` |
| `Phone*.dc.html` | Phone layouts of login, OTP, home (bottom tab bar + FAB), group, add expense, settle (reminder bottom sheet) | same routes, mobile layout |
| `Splash.dc.html`, `PhoneSplash.dc.html` | Splash: stamp "thump" animation + rotating status text + indeterminate bar | app boot |
| `HomeLoading.dc.html`, `PhoneLoading.dc.html` | Skeleton (shimmer) versions of Home | data loading |
| `Errors.dc.html`, `PhoneError.dc.html` | Error dialog catalogue, toasts, mobile error bottom sheet | — |
| `Logo.dc.html` | Logo sheet | — |

Desktop pages are fluid (max-width containers ~1200–1280px, flex-wrap so side columns stack under ~900px). Phone frames are 390×844.

## 3. Design tokens

See `tokens.css` (drop-in). Summary:

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#F2F3F5` | `#0A0C0F` |
| `--surface` | `#FFFFFF` | `#13161B` |
| `--surface2` | `#F6F7F9` | `#1A1E24` |
| `--line` | `#E2E5EA` | `#262B33` |
| `--ink` | `#0E1116` | `#EDEFF2` |
| `--muted` | `#596170` | `#9AA2AE` |
| `--accent` (lime, buttons/brand) | `#C6F135` | `#C6F135` |
| `--accent-ink` (text on accent) | `#0E1116` | `#0E1116` |
| `--pos` / `--pos-bg` (owed to you, paid) | `#0A7A4F` / `#E2F4EB` | `#4BDB98` / `#0F2A1E` |
| `--neg` / `--neg-bg` (you owe, errors) | `#BF3F0B` / `#FCECE3` | `#FF9568` / `#2D1911` |
| `--warn` / `--warn-bg` | `#8A5A00` / `#FFF3D1` | `#FFCB5C` / `#2B230F` |

- **Font:** Rubik (Google Fonts, 400/500/600/700/800), Hebrew + Latin. `font-variant-numeric: tabular-nums` everywhere for amounts.
- **Radii:** buttons/inputs 12px, cards 20px, hero cards 24–28px, pills 999px, phone sheets 28px top.
- **Touch targets:** min 44px; primary buttons 48–56px.
- **Hero / balance card:** always dark (`#0E1116`, border `#262B33`) with lime number, in both themes.
- **Avatar palette (dark text `#0E1116` on top):** `#C6F135` (you), `#FFB59A`, `#9CC8FF`, `#E2B6FF`, `#FFE08A`, `#9EE6CF`.
- **Category / group tints:** trip `#9CC8FF`, home `#FFE08A`, food `#FFB59A`, gift `#E2B6FF`, activity `#9EE6CF`, event `#9EE6CF`, other `#D5D9E0`.
- Positive vs negative never relies on colour alone: always paired with words ("owes you" / "you owe") or +/− signs.

## 4. Logo

- **App icon / mark:** `logo-mark.svg` — lime rounded square, tilted (−12°) outlined stamp with a check inside. Used in every header at 36–40px.
- **Full logo = the stamp:** word (שולם / Settled) + check, Rubik 800, inside a rounded outline, rotated −8°. Ink on light, lime on dark. `logo-stamp-he.svg`, `logo-stamp-en.svg` are references (convert text to outlines for production).
- **In-app stamp:** the same stamp marks settled balances/groups/transfers (green `--pos` outline), and is the success animation after sign-in.

## 5. Icons

Inline stroke icons (1.8px stroke, round caps). Use **lucide** equivalents: `plane, home, utensils, gift, bed, car, fuel, shopping-cart, waves/sailboat, bell, users, user-plus, link, copy, qr-code, send, mail, smartphone, camera, calendar, wifi-off, triangle-alert, lock, circle-dollar-sign, x, check, chevron-left/right, arrow-right, sun, moon, arrow-left-right`.

## 6. RTL & i18n rules

- Set `<html dir="rtl" lang="he">` / `dir="ltr" lang="en">` from the language setting; switch live without reload.
- Use **logical CSS only** (`margin-inline-start`, `padding-inline`, `inset-inline-end`, `text-align: start`, `border-start-start-radius`…). Flex rows flip automatically.
- Mirror directional icons (arrows, chevrons, send) in RTL (`[dir=rtl] .flip { transform: scaleX(-1) }`).
- Keep LTR islands for: phone numbers, emails, invite codes/links, OTP boxes, the amount input (`dir="ltr"` / `<bdi>`).
- Money: `₪1,800` format in both languages (Intl.NumberFormat with `en-US` grouping + ₪ prefix, or `he-IL` currency format — pick one and stay consistent). Support ILS / EUR / USD per group.
- Hebrew copy is gendered in places ("חייב / חייבת", "העביר / העבירה"); store member gender or use neutral phrasings ("את/ה"). All copy for every screen is in the `T = { he: {...}, en: {...} }` objects in the screen files — lift them into your i18n message files.
- Dates: "שבת, 24 באוקטובר" / "Saturday, October 24" via `Intl.DateTimeFormat`.

## 7. Key behaviours

**Auth**
- Google OAuth.
- Email or phone (Israeli default `+972`) → "Send me a login code" (button shows spinner + "Sending…") → 6-digit OTP screen (separate boxes, paste-to-fill, auto-advance), resend countdown (0:42 in mock), wrong code shows red boxes + alert "That code doesn't match. 2 tries left." → success stamp animation → splash → home.
- Guest: name only; data local to the device; persistent banner in Settings offering "Link Google" (and should also offer email/phone) without losing data.

**Groups & joining**
- Invite link `shulam.app/j/KR7-4QX`, 6-char code `KR7-4QX` (displayed with a dash), QR.
- Members can be added by name before they join; on join the user picks "which one is you?" or "I'm someone new".

**Expenses**
- Fields: amount, description, category, payer, date, optional receipt photo.
- Split modes: **Equally** (toggle who's included; per-person recomputes), **Exact amounts** (must sum to total — show green "Amounts add up" / red when not), **Shares** (± steppers).
- Live "effect on your balance" in the summary.

**Balances & simplification**
- Net balance per member = paid − share (+ settlements).
- Simplify with greedy min-cash-flow: repeatedly match the largest debtor with the largest creditor. Mock: 6 expenses → 3 transfers.

**Reminders**
- Per transfer: Remind → composer with tone (Friendly / Neutral / Firm) that swaps message template, channel (WhatsApp, SMS, Email, In-app push), auto-remind toggle (every 3 days until marked paid), payment details appended (Bit/PayBox phone, bank).
- "Remind everyone" in group.
- Debtor side: received reminder card with "Pay ₪340" and "I already paid".
- Mark received → transfer gets the green stamp; progress bar on settle page updates.

**Activity**
- Grouped Today / Yesterday / Earlier; filters All, Expenses, Payments, Reminders, Members with counts; unread dot; type badge on avatar.

## 8. Loading & errors

- **Splash:** stamp scales in from 2.2× with overshoot (≈2.6s loop), expanding ring, rotating text ("Loading your groups…", "Doing the math…", "Simplifying debts…", "Almost there…"), indeterminate lime bar. Respect `prefers-reduced-motion`.
- **Skeletons:** same layout as the real page, shimmer blocks (`--sk1`/`--sk2` gradient, 1.5s).
- **Button loading:** spinner replaces label, `aria-busy="true"`, ignore repeat clicks.
- **Error dialogs (copy in `Errors.dc.html`):** no internet (neutral, Try again), couldn't save expense (draft kept; Try again / Keep editing), invite link expired (Enter a code / Go home), reminder not sent (channel unavailable → Send by SMS / Cancel), session expired (Sign in again), can't leave group with open balance (Settle up / Cancel).
- **Toasts:** dark pill bottom/top — error with Retry, success with lime check, offline warning (amber).
- **Mobile:** errors as bottom sheets with error code line (e.g. `NET-408`).

## 9. Data model (sketch)

```
User        { id, name, email?, phone?, googleId?, isGuest, locale, theme, defaultCurrency, paymentDetails{bitPhone?, bank?} }
Group       { id, name, type(trip|home|event|meal|gift|other), currency, startDate?, endDate?, inviteCode, createdBy, closedAt? }
Member      { id, groupId, userId?, displayName, color, claimed:boolean }
Expense     { id, groupId, description, category, amount, currency, paidByMemberId, date, receiptUrl?, splitMode(equal|exact|shares), createdBy }
ExpenseShare{ expenseId, memberId, amount, shares? }
Settlement  { id, groupId, fromMemberId, toMemberId, amount, method?, confirmedAt? }
Reminder    { id, groupId, fromMemberId, toMemberId, amount, tone, channel, autoRepeatDays?, sentAt }
Activity    { id, groupId, actorMemberId, type(expense|payment|reminder|member), payload, createdAt, readBy[] }
```

Money as integer agorot/cents; round shares and give the remainder to the payer (or first member).

## 10. Seed data (matches the mocks)

Group "Crete trip / טיול לכרתים", Oct 12–18 2026, ILS, members Alon (you), Noa, Itay, Maya:
- Hotel in Chania ₪4,800 — Alon
- Car rental ₪1,600 — Noa
- Gas ₪640 — Maya
- Taverna dinner ₪1,120 — Itay
- Groceries ₪480 — Itay
- Boat tour to Balos ₪1,360 — Maya
- Settlement: Maya → Alon ₪500

Result: total ₪10,000, share ₪2,500 each; Noa → Alon ₪900, Itay → Alon ₪900 outstanding; Maya settled.
Other groups on Home: "The flat" (you owe Roni ₪340), "Friday dinners" (owed ₪120), "Gift for Dana" (settled).

## 11. Suggested build order

1. Project setup, tokens, Rubik, theme + language providers (RTL), app shell/header, logo.
2. Auth: Google, email/phone OTP, guest; splash.
3. Groups: create, list (Home), join/claim.
4. Expenses + split modes; group page; balances + simplification (unit-test this).
5. Settle up, mark received, reminders (start with in-app + copy-to-WhatsApp link, add SMS/email providers later).
6. Activity, settings, skeletons, error handling, toasts.
7. Mobile polish (bottom tab bar, bottom sheets), PWA, then native apps.
