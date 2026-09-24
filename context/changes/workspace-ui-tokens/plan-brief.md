# Workspace UI Tokens — Plan Brief

> Full plan: `context/changes/workspace-ui-tokens/plan.md`
> Research: `context/changes/workspace-ui-tokens/research.md`

## What & Why

Make the workspace view (`src/pages/w/[token].astro`) take its colors from semantic tokens and its controls from repo components, instead of literal `text-white` / `bg-white/10` classes and hand-built buttons. The repo already ships a shadcn token set and a `Button`, but no screen reads them, so changing a token does nothing and every new form copies the same class strings. The dark navy cosmic palette stays as roles in one file, but the glass effect (translucent surfaces, backdrop blur) is dropped for solid surfaces, and corner radius is tightened.

## Starting Point

`src/styles/global.css` has neutral shadcn tokens and a `.dark` layer that is never activated (`<html>` has no class). The cosmic look is literals: `bg-cosmic` hex in the token file itself and ~16 color-literal lines in the view. `components/ui/` holds only a `Button` nothing imports. The view has no focus, disabled, loading or empty treatment, no input labels, and a Copy button that fails silently.

## Desired End State

The view and its shell (`Layout`, `Banner`) read `global.css` roles and `components/ui` primitives. It keeps its layout and palette but is flatter, with solid surfaces and smaller corners; keyboard focus is visible, controls are labelled, errors are announced, and all seven states (default, hover, focus, disabled, error, empty, loading) can be seen on a dev-only kitchen-sink page, screenshotted at desktop and one mobile width.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Target view | Workspace `/w/[token]` | It is the core flow and the one with the most states | Plan |
| Motif | Keep cosmic palette, tokenized in the existing `.dark` layer; `<html class="dark">` | Fixes the real problem, tokens not driving screens | Plan |
| Surfaces and corners | Solid surfaces, no glass or backdrop blur; `--radius` 0.625rem → 0.375rem, card `rounded-lg` | Requested 2026-09-24: flatter, less rounded | User |
| Sequencing | Everything after `timer-switch-rounding` Phase 3 merges | That phase edits the same file; migrating once avoids a conflict and an edit to another change's plan | Plan |
| Components added | `Input` + `Alert` via `npx shadcn add`; no `Card` | Removes every hand-rolled control and banner without a half-adopted card | Plan |
| Heading gradient | Keep as a token role (brand-gradient pair + utility) | Preserves the chosen motif and lets other pages adopt it later | Plan |
| Visual gate | Dev-only kitchen-sink route + extracted `WorkspaceCard` | Real markup for every state with no database; no test tooling to install | Plan |
| Submit guard | Disable the button while a form posts | Gives the view real disabled/loading states and stops double submit | Plan |
| Charges found | Missing tokens (C1, C5), shared component (C2), states/a11y (C3), architecture (C4) | Each has file, line and user impact | Research |
| Layout reorder | Deferred to the review loop | Layout is judged after the view is built from tokens | Research |

## Scope

**In scope:**
- Token roles, `.dark` activation, tokenized `bg-cosmic`, tokenized `Banner`
- `Input` and `Alert` components, `Button` given a solid look
- Extracting `WorkspaceCard`, migrating the view, dev-only `/dev/kitchen-sink`
- Focus, labels, ARIA roles, empty state, Copy failure path, retry link, submit guard
- Before/after screenshots and measured contrast in the change folder

**Out of scope:**
- Restyling `index`, `404`, `delete` (they inherit the tokens only)
- `Card` component, light/dark toggle, layout reordering, screenshot-test tooling
- Timer behavior, routes, database, `src/lib`

## Architecture / Approach

Contract before pixels: tokens (global) → components that read them → the one view moved onto both, extracted into a props-driven component so the kitchen sink renders the same markup as the real page → states and accessibility, then the gate. Values are deposited in `tokens.md` with the line "repo's existing cosmic look, 2026-09-24, no external preset".

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Tokens | Cosmic values as roles in `.dark`, `class="dark"`, tokenized `bg-cosmic` and `Banner`, `tokens.md`, before screenshots | Body background changing on the other three pages |
| 2. Components | `Input`, `Alert` (+ success/warning), `Button` solid variant | Solid surfaces losing card/control separation on the navy ground |
| 3. View migration and kitchen sink | `WorkspaceCard`, view on tokens and components, dev-only kitchen sink | Kitchen-sink route shipping to production (404 guard is the only protection) |
| 4. States, accessibility and gate | Focus, labels, roles, empty, Copy failure, retry, submit guard, screenshots, measured contrast | Contrast below 4.5:1 on muted text and the Delete link |

**Prerequisites:** `timer-switch-rounding` Phase 3 merged.
**Estimated effort:** ~2 sessions across 4 phases.

## Open Risks & Assumptions

- The workspace will look flatter and sharper than `index`, `404` and `delete`, which keep their glass cards until a follow-up change; their `rounded-lg`/`rounded-xl` controls also shrink with `--radius`.
- 0.375rem is a starting value for the radius; it is one token to adjust after the Phase 3 screenshot.
- Contrast and focus visibility are estimates until measured in the browser in Phase 4; fixes go at the token layer.
- The submit guard is a small behavior addition; if it is struck, disabled and loading remain component-level fixtures only.
- The `:root` (light) values stay valid but inactive; there is no theme toggle.

## Success Criteria (Summary)

- Editing a `.dark` token changes the workspace screen; no color literal remains in the view or card.
- Every control on the workspace page has a visible focus ring and an accessible name, and errors are announced.
- The kitchen-sink screenshots show all seven states at desktop and one mobile width, with measured contrast recorded.
