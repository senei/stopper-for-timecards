---
change_id: workspace-ui-tokens
title: Workspace ui tokens
status: planned
created: 2026-09-24
updated: 2026-09-24
archived_at: null
---

## Notes

UI change run through `/10x-ui` (design-system contract). Scope is one view plus global tokens.

- **View:** workspace, `src/pages/w/[token].astro`.
- **Motif / token source:** the repo's own "cosmic" dark palette (`bg-cosmic` in `src/styles/global.css`, blue-100 text, blue-to-purple gradient headings), kept but expressed as semantic roles in `global.css` (`:root` / `.dark` values, published through `@theme inline`). No external preset; nothing to deposit beyond the token block and a line naming this source next to it.
- **Existing system:** Tailwind v4 + shadcn (`components.json`, `new-york`, `neutral`), tokens in `src/styles/global.css`, one component in `src/components/ui/button.tsx`. Extend it; no `shadcn init`, no second palette. Any component added goes through `npx shadcn add <name>`.
- **Sequencing:** `timer-switch-rounding` (status `implementing`) Phase 3 rewrites the tracking state of `src/pages/w/[token].astro`. Land the token phase (global tokens) first, but do the view and states phases only after that Phase 3 is merged, so the audit covers the real tracking UI and there is no merge conflict.
- **Charges:** listed in `research.md` (audit + reference), each with file, line and user impact. Charges not addressed by the plan stay listed as deferred.
