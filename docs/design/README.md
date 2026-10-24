# שולם / Settled — design kit for Claude Code

1. Put this whole `shulam-design/` folder inside your repo (for example at `docs/design/`).
2. Open Claude Code in the repo and paste the prompt from `STARTER_PROMPT.md`.

Contents:
- `DESIGN_HANDOFF.md` — the spec: screens → routes, tokens, RTL/i18n rules, behaviours, loading & error states, data model, seed data, build order.
- `tokens.css` — light/dark colour tokens, font, radii, stamp + skeleton animations. Drop-in.
- `logo-mark.svg`, `logo-stamp-he.svg`, `logo-stamp-en.svg` — logo files.
- `screens/*.dc.html` — every designed screen (desktop + phone + loading + errors). Each file holds the layout, the exact styles, and all Hebrew + English copy. They are prototypes in a template format (`{{hole}}`, `<sc-for>`, `<sc-if>`), meant as reference, not to be shipped.
- `canvas.json` — which screen is which (titles, sizes).
