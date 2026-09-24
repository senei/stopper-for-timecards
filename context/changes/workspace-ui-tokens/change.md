---
change_id: workspace-ui-tokens
title: Workspace ui tokens
status: implementing
created: 2026-09-24
updated: 2026-09-24
archived_at: null
---

## Notes

UI change run through `/10x-ui` (design-system contract). Scope was one view plus global tokens; on 2026-09-24 the user extended it so **every page adopts the light-gray look** (landing, 404 and delete are Phase 5).

- **View:** workspace, `src/pages/w/[token].astro`.
- **Motif / token source (changed 2026-09-24, during Phase 1):** the first plan kept the repo's dark navy "cosmic" palette as tokens. The user found it too dark, then found a blue-page draft too blue, and settled on a light-gray page (`screenshots/palette-light-gray.png`): white solid cards, dark-gray primary buttons (Start, Switch), bordered secondary buttons (Copy, Delete), orange headings, a blue focus ring, 2px control / 3px card corners, no glass. Values are Tailwind v4 palette colors in `:root` of `src/styles/global.css` (published through `@theme inline`); no external preset. Sources per role: `tokens.md`. The shared `Banner.astro` was also removed at the user's request.
- **Existing system:** Tailwind v4 + shadcn (`components.json`, `new-york`, `neutral`), tokens in `src/styles/global.css`, one component in `src/components/ui/button.tsx`. Extend it; no `shadcn init`, no second palette. Any component added goes through `npx shadcn add <name>`.
- **Sequencing:** `timer-switch-rounding` Phase 3 rewrote the tracking state of `src/pages/w/[token].astro`; it is done and archived (`context/archive/2026-09-23-timer-switch-rounding/`), so all four phases here can run.
- **Charges:** listed in `research.md` (audit + reference), each with file, line and user impact. Charges not addressed by the plan stay listed as deferred.
