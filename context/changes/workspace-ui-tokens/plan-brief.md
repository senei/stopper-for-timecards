# Workspace UI Tokens — Plan Brief

> Full plan: `context/changes/workspace-ui-tokens/plan.md`
> Research: `context/changes/workspace-ui-tokens/research.md`

## What & Why

Make the workspace view (`src/pages/w/[token].astro`) take its colors from semantic tokens and its controls from repo components, instead of literal `text-white` / `bg-white/10` classes and hand-built buttons. The repo already ships a shadcn token set and a `Button`, but no screen reads them, so changing a token does nothing and every new form copies the same class strings. The look changes too (user decisions, 2026-09-24): a light-gray page with white solid cards, dark-gray primary buttons (Start, Switch), bordered secondary buttons (Copy, Delete) and orange headings, replacing the dark navy glass, with small corners (2px controls, 3px cards).

## Starting Point

`src/styles/global.css` has neutral shadcn tokens and a `.dark` layer that is never activated (`<html>` has no class). The old cosmic look is literals: `bg-cosmic` hex in the token file itself and ~16 color-literal lines in the view. `components/ui/` holds only a `Button` nothing imports. The view has no focus, disabled, loading or empty treatment, no input labels, and a Copy button that fails silently.

## Desired End State

The view and its shell (`Layout`) read `global.css` roles and `components/ui` primitives. The workspace is a white card on a light-gray page with orange headings, dark-gray primary buttons, bordered secondary buttons and small corners; keyboard focus is visible, controls are labelled, errors are announced, and all seven states (default, hover, focus, disabled, error, empty, loading) can be seen on a dev-only kitchen-sink page, screenshotted at desktop and one mobile width.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Target view | Workspace `/w/[token]` | It is the core flow and the one with the most states | Plan |
| Palette | Light-gray page, white cards, dark-gray primary buttons, bordered secondary buttons (Copy, Delete), orange headings, blue focus ring; tokens in `:root`, no `dark` class (`screenshots/palette-light-gray.png`) | The dark navy was "too dark" and the blue page "too blue"; the user asked for a light-gray background | User |
| Scope | All four pages adopt the light-gray look: the workspace in Phase 3, landing/404/delete in a separate Phase 5; the legacy `bg-cosmic` is deleted there | The user asked that every page adopt it; the toolkit default is one view, so it is its own phase | User |
| Corners | `--radius` 2px (controls), `--radius-card` 3px; `rounded-lg/md/sm` map to the first, `rounded-xl/2xl` to the second | The user asked for smaller corners; two tokens make it one edit | User |
| Solid surfaces | No glass, no `backdrop-blur`; every surface role is alpha-free | Requested 2026-09-24 | User |
| Headings | One solid orange role (`--heading`, orange-700); blue-purple gradient dropped | "Headings can be orange"; orange-700 gives 4.77:1 on the card | User |
| Heading | One funny pair per day from six (idle + tracking), same all day, chosen by the viewer's local date (server UTC, corrected by the page script); pure function `headingForDate` with a unit test, added in Phase 3 | The user asked for a heading that varies daily; six pairs are the safest of eight proposals | User |
| Banner | `Banner.astro` and its use in `Layout.astro` removed | "Banner is not needed"; closes charge C5 by removal | User |
| Sequencing | Everything after `timer-switch-rounding` Phase 3 (now merged) | That phase edited the same file | Plan |
| Components added | `Input` + `Alert` via `npx shadcn add`; no `Card` | Removes every hand-rolled control and message without a half-adopted card | Plan |
| Visual gate | Dev-only kitchen-sink route + extracted `WorkspaceCard` | Real markup for every state with no database; no test tooling to install | Plan |
| Submit guard | Disable the button while a form posts | Gives the view real disabled/loading states and stops double submit | Plan |
| Charges found | Missing tokens (C1), shared component (C2), states/a11y (C3), architecture (C4), banner colors (C5, closed by removal) | Each has file, line and user impact | Research |
| Layout reorder | Deferred to the review loop | Layout is judged after the view is built from tokens | Research |

## Scope

**In scope:**
- Token roles in `:root` (palette, `--field`, `--heading`, status roles, radii), `bg-cosmic` kept as a legacy dark utility until Phase 5, `Banner` removed
- `Input` and `Alert` components, `Button` given a solid look
- Extracting `WorkspaceCard`, migrating the view, dev-only `/dev/kitchen-sink`
- Focus, labels, ARIA roles, empty state, Copy failure path, retry link, submit guard
- Daily rotating workspace heading (`src/lib/workspace-headings.ts` + unit test)
- Restyling `index`, `404` and `delete` onto the same look and deleting `bg-cosmic` (Phase 5, added on user request)
- Before/after screenshots and measured contrast in the change folder

**Out of scope:**
- The `Card` shadcn component, light/dark toggle, layout reordering, screenshot-test tooling (the line below is the replacement)
- Timer behavior, routes, database, other `src/lib` code

## Architecture / Approach

Contract before pixels: tokens (global) → components that read them → the one view moved onto both, extracted into a props-driven component so the kitchen sink renders the same markup as the real page → states and accessibility, then the gate. Values are deposited in `tokens.md` with the line "light-gray page, white cards, dark-gray primary buttons, bordered secondary buttons, orange headings and a blue focus ring, chosen by the user on 2026-09-24 from mocks, no external preset".

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Tokens | New palette and radii as roles in `:root`, `--field`/`--heading`, legacy `bg-cosmic` kept for index/404/delete, `Banner` removed, `tokens.md`, before screenshots | The three unrestyled pages keep a dark look that no longer matches the workspace |
| 2. Components | `Input`, `Alert` (+ success/warning), `Button` dark-gray default and bordered secondary variants | shadcn defaults assume `--background` is the surface, but here it is the gray page |
| 3. View migration and kitchen sink | `WorkspaceCard`, view on tokens and components, dev-only kitchen sink | Kitchen-sink route shipping to production (404 guard is the only protection) |
| 4. States, accessibility and gate | Focus, labels, roles, empty, Copy failure, retry, submit guard, screenshots, measured contrast | Browser contrast below the computed values |
| 5. Other pages | Landing, 404 and delete restyled on `PageCard` and the shared buttons; legacy `bg-cosmic` deleted | Turnstile widget on the light page; four pages to keep visually consistent |

**Prerequisites:** `timer-switch-rounding` Phase 3 merged (done).
**Estimated effort:** ~2-3 sessions across 5 phases.

## Open Risks & Assumptions

- Until Phase 5, index, 404 and delete keep their dark navy page and translucent cards (the old `bg-cosmic`, kept as a legacy utility), so they will not match the light workspace; only their radii shrink with the tokens.
- "3px and 2px for buttons" was read as a 3px card and 2px buttons and fields; both are single tokens if that is wrong.
- Contrast in `tokens.md` is computed from the token values; it is browser-measured in Phase 4, and fixes go at the token layer.
- The submit guard is a small behavior addition; if it is struck, disabled and loading remain component-level fixtures only.
- `src/lib/config-status.ts` lost its only consumer with the banner and is deleted in Phase 2.
- The `.dark` layer is the stock shadcn set and is unused; there is no theme toggle.
- The heading text is new copy with jokes: it can be reworded in one file, and the daily choice can briefly swap at load for viewers whose local date differs from UTC.
- The card differs from the page by only 1.10:1, so its edge relies on the border and a soft shadow.

## Success Criteria (Summary)

- Editing a token in `:root` changes the workspace screen; no color literal remains in the view or card.
- Every control on the workspace page has a visible focus ring and an accessible name, and errors are announced.
- The kitchen-sink screenshots show all seven states at desktop and one mobile width, with measured contrast recorded.
