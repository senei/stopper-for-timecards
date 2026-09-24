---
date: 2026-09-24T09:11:41+02:00
researcher: senei web
git_commit: a3d37c3fc1e8a42e1955c1923ea2fbeffe270e93
branch: main
repository: x10-dev--curse
topic: "Workspace view: where do its values come from, which components does it use, and what are the charges (audit + reference)?"
tags: [research, ui, design-tokens, tailwind-v4, shadcn, workspace, global.css, button]
status: complete
last_updated: 2026-09-24
last_updated_by: senei web
---

# Research: Workspace view (`/w/[token]`) — audit and reference for `workspace-ui-tokens`

**Date**: 2026-09-24T09:11:41+02:00
**Researcher**: senei web
**Git Commit**: a3d37c3fc1e8a42e1955c1923ea2fbeffe270e93 (working tree also has uncommitted edits to `CLAUDE.md`, `roadmap.md` and `timer-switch-rounding/plan.md`; none touch `src/`)
**Branch**: main
**Repository**: x10-dev--curse

## Research Question

Audit: locate this repo's source of values and its shared components directory, and find which views read them. Reference: name the motif to borrow from. Output: a list of charges (file, line, user impact) for the one view `src/pages/w/[token].astro`, per `/10x-ui`.

Method: static read of every file under `src/` that renders UI (8 files: `layouts/Layout.astro`, `components/Banner.astro`, `components/ui/button.tsx`, `styles/global.css`, `pages/index.astro`, `pages/404.astro`, `pages/w/[token].astro`, plus `pages/w/[token]/projects/[projectId]/delete.astro`) and repo-wide greps. Nothing was rendered or screenshotted; contrast and focus visibility below are code-derived, not measured.

## Summary

- **The design system exists and the screens ignore it.** Values live in `src/styles/global.css` (`:root` at :6-39, `.dark` at :41-73, published through `@theme inline` at :75-111), and the one shared component is `src/components/ui/button.tsx`. In the inspected `src/` tree, no file imports `Button` or anything from `components/ui`, and no page uses a React island (no `client:` directive anywhere in `src/`).
- **The workspace view reads none of the semantic tokens by name.** Its colors are literal utilities (`text-white`, `text-blue-100/80`, `border-white/10`, `bg-white/10`, `from-blue-200 to-purple-200`, red/emerald banners). The only global look-defining rule is `bg-cosmic` (`global.css:113-115`), which hard-codes three hex colors.
- **Dark mode is unreachable.** `.dark` is defined at `global.css:41`, but the `<html>` element at `Layout.astro:14` carries no class and no `.dark` toggle exists in `src/`. Today's dark look comes entirely from literals, so editing `--background` or `--foreground` would change only the strip of body outside the `min-h-screen` wrapper.
- **Nothing in the repo runs screenshot tests**, so the visual gate is the kitchen-sink form.
- **Sequencing constraint:** `timer-switch-rounding` Phase 3 (`plan.md:192-222`) edits this same file and specifies "same styling" for its new forms (`plan.md:206`), so it will copy the hand-rolled classes a second time unless the shared components exist first.

## Detailed Findings

### 1. Source of values

- `src/styles/global.css:6-39` — `:root` holds the shadcn "neutral" values (`--background`, `--foreground`, `--card`, `--primary`, `--muted-foreground`, `--destructive`, `--border`, `--input`, `--ring`, chart and sidebar sets). `components.json` confirms style `new-york`, `baseColor: neutral`, `cssVariables: true`, CSS at `src/styles/global.css`.
- `global.css:41-73` — `.dark` overrides, also neutral grays (e.g. `--background: oklch(0.145 0 0)` at :42). These are not the navy of the cosmic look.
- `global.css:75-111` — `@theme inline` publishes each as `--color-*`, so `bg-card`, `text-muted-foreground`, `border-border`, `bg-destructive` already exist as utilities. It publishes values by reference (`var(--x)`), i.e. the correct split; the dark-mode-break pattern (raw colors inside `@theme inline`) is not present.
- **Roles that do not exist:** there is no success or warning token in `:root`/`.dark` (only `--destructive`). That is why the emerald status banner (`[token].astro:90`) and the amber warning banner (`Banner.astro:32-36`) are literals.
- `global.css:113-115` — `@utility bg-cosmic` = `linear-gradient(to bottom, #0a0e1a, #0f1529, #0a0e1a)`. This is a literal in the token file itself; it is not derived from `--background`.
- `global.css:117-124` — base layer applies `border-border outline-ring/50` to `*` and `bg-background text-foreground` to `body`. Body is therefore the light neutral `--background`; the cosmic look is painted only on a wrapper `div` (`[token].astro:72`, `index.astro:26`, `404.astro:11`, `delete.astro:49`).

### 2. Shared components

- `src/components/ui/` contains one file, `button.tsx` (variants default/destructive/outline/secondary/ghost/link; sizes default/sm/lg/icon). It has a `focus-visible:ring-[3px] focus-visible:ring-ring/50` state and `disabled:opacity-50` (`button.tsx:8`).
- No `Input`, `Alert`, or `Card` component exists in the repo (directory listing of `src/components` and `src/components/ui`).
- `Banner.astro` is the only other shared component. It has `info|warning|error` variants with hex colors (`Banner.astro:27-40`) and correct `role="alert"`/`role="status"` (`:11`). It is rendered only by `Layout.astro:22-26` for missing config, never for the page-level `?error=` / `?status=` messages.
- Consumers: 0 of the 4 pages import `Button`; all 4 hand-roll their buttons and links with `border-white/20 bg-white/10 …` classes, except `index.astro:45-50`, which uses `bg-purple-600 hover:bg-purple-500`.

### 3. The workspace view (`src/pages/w/[token].astro`), state by state

| State | Where | Observed |
| --- | --- | --- |
| default | 100-141 | New-name form, project pick list (one form per project), private-link block |
| tracking | 94-98 | Static "Currently tracking … started at" line. Add form and pick list are hidden. No action is offered (switching is `timer-switch-rounding` Phase 3) |
| hover | 112, 125, 132, 156 | `hover:bg-white/20` or `hover:text-red-200` on buttons and the Delete link |
| focus | 108, 112, 125, 132, 151, 156 | No `focus-visible:` class on any of these controls. Only the global `outline-ring/50` (`global.css:119`) applies, i.e. the browser's default focus outline recolored to `--ring` at 50% alpha. Not verified in a browser |
| disabled | whole file | No `disabled` attribute or style anywhere in the file |
| error | 60, 84-88; 38-40, 74-78 | Redirect-driven `?error=` banner (a `<p>` with no `role`); and the unavailable state, which sets HTTP 503 and renders a heading plus one sentence. It has no retry action and does not show the private link |
| empty | 117-139 | With no projects the list is silently omitted (no "no projects yet" text) |
| loading | whole file | None. Plain form POSTs; no pending state and no double-submit guard on Start (`:110-115`) |

### 4. Accessible names (a11y floor)

- The project-name input (`[token].astro:102-109`) has a `placeholder` and no `<label>` or `aria-label`; the read-only link input (`:146-152`) has neither a label nor a placeholder. There is no `<label>` or `aria-label` string anywhere in the file.
- Status/error `<p>` banners at `:85-93` carry no ARIA role, while the existing shared `Banner.astro:11` sets one.
- The Copy handler (`:175-182`) has no `.catch`, so a rejected `navigator.clipboard.writeText` is an unhandled rejection with no message to the user. It also never restores the "Copied" label (`:180`) and has no live region.

### 5. Contrast (hand-calculated estimate, not measured)

Delete link (`[token].astro:132`): `text-blue-100/50` at `text-xs` over the glass card. Composited over an approximate `#252a3c` card surface I get about 4.1:1, which would fall below 4.5:1 for 12px text. The card surface value is itself an approximation of `#0f1529` + 10% white; measure in the browser before using this number in review.

### 6. Reference: the named motif

The motif is the repo's own "cosmic dark glass" (per user decision, 2026-09-24): three parts, all currently literals.

| Part | Today (file:line) | Proposed role |
| --- | --- | --- |
| Page ground | `bg-cosmic` `global.css:113-115`; wrapper divs at `[token].astro:72` etc. | `--background` (dark navy) + a gradient utility built from tokens |
| Glass card | `border-white/10 bg-white/10 backdrop-blur-xl text-white` `[token].astro:73` | `--card` / `--card-foreground` / `--border` |
| Muted text | `text-blue-100/80` (`:76,95`), `/60` (`:144,161`), `/50` (`:132`), `/40` (`:108`) | `--muted-foreground` (four alpha levels collapse to one or two roles) |
| Inputs | `border-white/20 bg-black/20` (`:108,125,151`) | `--input` |
| Secondary button | `border-white/20 bg-white/10 hover:bg-white/20` (`:112,156`) | `Button` `secondary`/`outline` variant |
| Error banner | `border-red-400/30 bg-red-500/10 text-red-100` (`:85`) | `--destructive` |
| Status banner | `border-emerald-400/30 bg-emerald-500/10 text-emerald-100` (`:90`) | new `--success` |
| Heading gradient | `from-blue-200 to-purple-200` (`:81`, same in `index.astro:28`, `delete.astro:58`) | new brand-gradient role, or drop to `text-foreground` (open question) |

Source line to deposit next to the edited block: "Values: repo's existing cosmic look (`bg-cosmic`, glass card, blue-100 text), 2026-09-24, no external preset."

## Code References

- `src/styles/global.css:6-39` — `:root` token values (neutral shadcn)
- `src/styles/global.css:41-73` — `.dark` values (never activated)
- `src/styles/global.css:75-111` — `@theme inline` publication of tokens
- `src/styles/global.css:113-115` — `bg-cosmic` with hard-coded hex
- `src/styles/global.css:119,122` — `outline-ring/50` on `*`; `bg-background` on `body`
- `src/layouts/Layout.astro:14` — `<html lang="en">` with no `dark` class; `:22-26` renders `Banner` for missing config
- `src/components/ui/button.tsx:7-33` — only shared UI component, imported by no page
- `src/components/Banner.astro:27-40` — hex banner colors; `:11` ARIA roles
- `src/pages/w/[token].astro:72-164` — view markup; `:171-194` client script
- `src/pages/w/[token].astro:74-78` and `src/pages/w/[token]/projects/[projectId]/delete.astro:51-55` — identical "Temporarily unavailable" copy in two places
- `src/pages/index.astro:45-50` — purple-600 button (a fifth button look)
- `context/changes/timer-switch-rounding/plan.md:202-206` — Phase 3 edits this view with "same styling"

## Charges

Counts: a repo-wide grep for hex or `bg|text|border|from|to-(white|black|blue|purple|red|emerald)` matched 43 lines in 7 files: `[token].astro` 16, `Banner.astro` 9, `index.astro` 7, `delete.astro` 7, `404.astro` 2, `global.css` 1, `button.tsx` 1 (`text-white` at `:14`). 41 of the 43 are in view or component files (not the token source). These are matching lines, not distinct colors.

| # | Category | Evidence | Effect on the user |
| --- | --- | --- | --- |
| **C1** | Missing tokens | `[token].astro:72-164` (16 matching lines), `global.css:113-115` (hex in the token file), `.dark` unreachable (`Layout.astro:14`), no `--success`/`--warning` roles (`global.css:6-39`) | A future theme or dark/light change does nothing to the screen; the same "muted" text has four opacity levels, so a designer or the next agent has no role to change. |
| **C2** | Missing shared component | Hand-rolled inputs and buttons at `[token].astro:102-128,146-158`, shadowing `components/ui/button.tsx`; no `Input`/`Alert` in `components/ui/`; `Phase 3` (`plan.md:206`) will add two more copies | Buttons look different across pages (`index.astro:45-50` purple vs. glass elsewhere); every new form re-invents its states, which is where C3 comes from. |
| **C3** | Missing states and a11y floor | No focus, disabled, empty or loading treatment (§3); no input labels, no ARIA role on banners, no clipboard failure path (§4) | Keyboard users get only a faint default outline; screen-reader users get unlabeled inputs and unannounced errors; a failed copy looks like nothing happened, which matters because the link "cannot be recovered" (`:162`). |
| **C4** | Accidental architecture | Identity-critical private-link block last at `:143-164`, below the project list; Delete is a 12px, 50%-alpha link at `:130-135` (≈4.1:1 estimate); unavailable state duplicated (`:74-78`, `delete.astro:51-55`) with no retry | On mobile the one unrecoverable thing is the least prominent; a destructive action is both low-contrast and adjacent to the primary pick action; a 503 leaves the user with no next step. |
| **C5** | Missing tokens (global, shared) | `Banner.astro:27-40` hex colors; used by `Layout.astro:22-26` on every page | Config-warning banners ignore the theme and show a light strip above the dark wrapper on the white body. Only appears when `missingConfigs` is non-empty. |

**Deferred (recorded, not dropped, unless the plan takes them):**

- `index.astro:45-50` purple CTA, `index.astro` / `404.astro` / `delete.astro` restyle — other views. They already share the `bg-cosmic` wrapper and will inherit token changes, but their own controls are not restyled in this change (one view per change).
- The heading gradient decision (see Open Questions).
- The identical unavailable-state copy shared by two pages, if the plan chooses not to add a shared component for it.

## Architecture Insights

- **Value source nothing reads** — the "fresh starter whose screens ignore its own tokens" playbook applies: Phase 1 is making the view read `global.css` roles, not choosing a theme.
- The tokens are published correctly through `@theme inline`; the fix is adding roles and mapping values, not restructuring.
- The app renders React components only as static HTML if it uses them at all (no `client:` directives in `src/`); a `Button` used in `.astro` files needs no hydration, so adopting it adds no client JS.
- No screenshot tooling is in `package.json`, so per the skill the visual gate is a kitchen-sink page screenshotted from the browser, not a `toHaveScreenshot` test, and nothing should be installed to satisfy it.

## Historical Context (from prior changes)

- `context/changes/timer-switch-rounding/plan.md:11` — records that this view "only ever shows one of two states" and that switching was deferred by S-02; `:202-206` (Phase 3) is the overlap that drives the sequencing in `change.md`. Status: `implementing`, Phases 1 and 2 committed (`c619b72`, `a3d37c3`).
- A grep over `context/` for "cosmic", "shadcn", "glass" and "dark mode" (excluding this change) found only unrelated hits ("rounded-" Tailwind classes in `first-timer-start-audit/research.md:47`; `AGENTS.md:18`; `README.md:18`). There is no prior recorded UI or design decision.
- `context/foundation/lessons.md` has two entries (Vite cache warm-up; destructive migrations). Only the Vite one applies: running `npx astro check` before `astro dev` after config changes, relevant when the kitchen-sink is screenshotted.

## Related Research

- `context/changes/first-timer-start-audit/research.md` — not UI-related; confirms no stop/switch route existed before `timer-switch-rounding`.

## Open Questions

1. **Land the component phase before or after `timer-switch-rounding` Phase 3?** `change.md` says token phase first, view/states after Phase 3. But Phase 3 copies the hand-rolled forms ("same styling", `plan.md:206`). Landing `Button`/`Input` adoption first would let Phase 3 use them; landing after means restyling two more forms. This is the user's call at plan time.
2. **Heading gradient:** keep `from-blue-200 to-purple-200` as a named role (new token) or reduce it to `text-foreground`? It appears on three pages (`[token].astro:81`, `index.astro:28`, `delete.astro:58`).
3. **Where does the kitchen sink live?** In an SSR app deployed to Cloudflare Workers, a page under `src/pages/` would also ship to production. Options for the plan: a dev-only route guarded by `import.meta.env.DEV`, or a static HTML file in the change folder.
4. **Unmeasured:** actual focus-ring visibility, real contrast values and mobile layout have not been checked in a browser. Verify them in the states phase screenshot, not from this document.
