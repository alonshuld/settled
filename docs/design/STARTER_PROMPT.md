Paste this into Claude Code (adjust the stack line if you prefer something else):

---

I'm building "שולם" (English: "Settled"), a group expense-splitting web app. The full design is in `docs/design/` (adjust path):

- `docs/design/DESIGN_HANDOFF.md` is the spec. Read it fully first.
- `docs/design/screens/*.dc.html` are the designed screens. They're prototypes in a template format (`{{hole}}` = value from `renderVals()`, `<sc-for>` = loop, `<sc-if>` = conditional). Use them as the source of truth for layout, spacing, styles and copy. Every file contains its Hebrew and English strings in a `T = { he, en }` object.
- `docs/design/tokens.css` holds the colour and theme tokens; use these values, don't invent new colours.
- Logos are in `docs/design/*.svg`.

Stack: Next.js (App Router) + TypeScript + Tailwind (mapped to the CSS variables in tokens.css) + next-intl for he/en with RTL + lucide-react icons. Use Postgres + Prisma for data and Auth.js for Google, plus email/phone one-time-code login and guest sessions.

Requirements: Hebrew is the default (RTL); light/dark mode and a language switch available everywhere; responsive desktop + phone, matching both the desktop and the `Phone*` designs; accessible (real buttons/labels, 44px touch targets).

Before writing code:
1. Summarise the screens, flows and data model you found in the design.
2. Propose the project structure, route map and component list (header, logo, avatar, group card, expense row, split editor, transfer row, reminder composer, OTP input, skeleton, error dialog, toast, bottom sheet).
3. Propose a step-by-step plan following "Suggested build order" in the handoff, and wait for my OK.

Then build step 1 (setup, tokens, theme + language providers with RTL, app shell with the logo) and show me how to run it. Write unit tests for the balance and debt-simplification logic, and check it against the seed data in the handoff (Noa → Alon ₪900, Itay → Alon ₪900, Maya settled).
