# Workspace UI Tokens Implementation Plan

## Overview

Make the workspace view (`src/pages/w/[token].astro`) read semantic tokens and repo components instead of literal colors and hand-rolled controls, keeping today's dark navy cosmic palette but dropping the glass effect (translucent surfaces, backdrop blur) and tightening corner radius (decided 2026-09-24). The tokens and components are extended inside the existing Tailwind v4 + shadcn system; nothing is initialized twice. The view is then audited against the seven states and gated with a kitchen-sink page screenshotted at desktop and one mobile width.

**Prerequisite for every phase:** `timer-switch-rounding` Phase 3 has merged. It rewrites the tracking state of the same view file (`context/changes/timer-switch-rounding/plan.md:202-206`), and we migrate the whole file once, afterwards.

## Current State Analysis

- Values live in `src/styles/global.css` (`:root` :6-39, `.dark` :41-73, published through `@theme inline` :75-111). They are neutral shadcn grays and are read by no page.
- The cosmic look is literal: `bg-cosmic` hard-codes three hex colors (`global.css:113-115`); the view uses `text-white`, `text-blue-100/{80,60,50,40}`, `border-white/{10,20}`, `bg-white/10`, `from-blue-200 to-purple-200`, red/emerald banners (`[token].astro:72-164`).
- `.dark` is never applied: `<html lang="en">` has no class (`Layout.astro:14`).
- `src/components/ui/` holds only `button.tsx`, imported by no page. There is no `Input` or `Alert`. `Banner.astro` has hex colors (`:27-40`) and correct ARIA roles (`:11`) but renders only for missing config (`Layout.astro:22-26`).
- The view has no focus, disabled, loading or empty treatment, no input labels, no ARIA role on its error/status `<p>` banners, and a Copy handler with no failure path (`[token].astro:85-93,102-109,146-152,175-182`).
- No screenshot tooling exists in `package.json`, so the visual gate is the kitchen-sink form.

Full detail and the charge list: `context/changes/workspace-ui-tokens/research.md`.

## Desired End State

The workspace view and the shell around it (`Layout`, `Banner`) take every color, radius and state from tokens in `global.css`, and every control from `components/ui`. Changing a token in `.dark` changes the screen. The view keeps its layout and dark navy palette, but surfaces are solid instead of translucent glass and corners are tighter than today's `rounded-2xl` card and 0.625rem controls; keyboard focus is visible, every control has an accessible name, errors are announced, and each of the seven states (default, hover, focus, disabled, error, empty, loading) can be seen at once on `/dev/kitchen-sink` in development. Verify with the screenshots in `context/changes/workspace-ui-tokens/screenshots/` and the measured contrast values recorded in `tokens.md`.

### Key Discoveries:

- `@theme inline` already publishes by reference (`var(--x)`), which is the correct split; the work is adding roles and mapping values, not restructuring (`global.css:75-111`).
- `@custom-variant dark (&:is(.dark *))` (`global.css:4`) matches descendants of `.dark`, so `class="dark"` on `<html>` covers `body` and everything below it.
- `Button` already has `focus-visible:ring-[3px] focus-visible:ring-ring/50` and `disabled:opacity-50` (`button.tsx:8`), so adopting it brings those states with it.
- The Astro React integration is present (`astro.config.mjs:4,12`) and no page uses `client:`; `Input`, `Alert` and `Button` render as static HTML with no hydration and no client JS.
- `scripts/smoke.mjs` drives the API over HTTP and does not depend on workspace markup, so it stays a valid regression check.

## What We're NOT Doing

- No `shadcn init`, no second palette, no light/dark theme toggle. The app has one look (dark); the `:root` values stay valid but inactive.
- No restyle of `index.astro`, `404.astro` or `delete.astro`. They already share `bg-cosmic`, so they inherit the token change (including the dark `<html>` class), but their own buttons, heading, and the purple CTA (`index.astro:45-50`) stay as they are. Logged as deferred.
- No `Card` component (the repeated card wrapper stays a token-based class string in `WorkspaceCard.astro`).
- No glass restyle of `index.astro`, `404.astro` or `delete.astro`: their cards keep `bg-white/10 backdrop-blur-xl rounded-2xl` literals, so the workspace will look flatter and sharper than those three until a follow-up change. Their `rounded-lg`/`rounded-xl` controls do shrink, because `--radius-lg`/`--radius-xl` in `@theme inline` derive from `--radius`.
- No layout reordering, notably not moving the "Your private link" block (`[token].astro:143-164`). Layout is judged after the view is built from tokens, in the `/10x-impl-review` loop.
- No shared "Temporarily unavailable" component for `delete.astro`; its duplicate copy (`delete.astro:51-55`) is deferred.
- No new timer behavior, no stop action, no changes to routes, `src/lib` or the database.
- No screenshot-test tooling installed, and no baselines.

## Implementation Approach

Fix the contract before the pixels: tokens first (Phase 1), then the components that read them (Phase 2), then move the one view onto both while extracting it into a props-driven component so a kitchen sink can render the real markup (Phase 3), then add the states and accessibility the view lacked and take the gate screenshots (Phase 4). Values come from the repo's own cosmic look, so the source line is "repo's existing cosmic look, 2026-09-24, no external preset"; the raw values go into `context/changes/workspace-ui-tokens/tokens.md` before the CSS is edited.

## Critical Implementation Details

- **Token layering (Tailwind v4):** put values only in `:root` / `.dark` and publish them through `@theme inline` as `var(--x)`. Do not write raw colors into `@theme inline`; that is the classic dark-mode break. New roles need a value in both `:root` and `.dark`.
- **Astro + React components:** `Button` with `asChild` cannot wrap an Astro element. For a link that must look like a button (the retry link), put `buttonVariants({ variant })` on an `<a>`.
- **Submit guard:** disable the submit button inside the form's `submit` event handler (the submit buttons have no `name`/`value`, and pick-list forms carry the name in a hidden input, so no data is lost). Re-enable on `pageshow` when `event.persisted` is true, otherwise a back-navigation restores a disabled button from the back/forward cache.
- **Kitchen sink is not a production page:** `src/pages/dev/kitchen-sink.astro` must return a 404 (`Astro.rewrite("/404")`) unless `import.meta.env.DEV`, and set the same `X-Robots-Tag: noindex` header the other pages set. It ships in the Workers bundle, so the guard is the only protection.
- **Dev server:** if `npx astro dev` reports "failed to start" after adding components or dependencies, follow `context/foundation/lessons.md`: run `npx astro check` once to warm Vite's cache, then start dev again.

## Phase 1: Tokens

### Overview

Make the cosmic palette a set of roles in `global.css` with solid (not translucent) surfaces and a smaller radius, activate the `.dark` layer, and move the shared banner off hex. No view markup changes yet, so the pages should look the same afterwards apart from slightly tighter `rounded-lg`/`rounded-xl` corners.

### Changes Required:

#### 1. Token deposit and "before" evidence

**File**: `context/changes/workspace-ui-tokens/tokens.md` (new), `context/changes/workspace-ui-tokens/screenshots/` (new)

**Intent**: Record the raw values and their source before editing CSS, and capture the current look so the visual delta can be explained later.

**Contract**: `tokens.md` lists each role with its raw source value (`#0a0e1a`, `#0f1529`, the white/10 glass and black/20 input surfaces being replaced, blue-100 text opacities, red/emerald banner colors from `[token].astro:85,90`), the resulting `oklch` value, and the line "Values: repo's existing cosmic palette (`bg-cosmic`, blue-100 text) with glass surfaces flattened to solid ones and radius reduced at the user's request, 2026-09-24, no external preset." Screenshots `before-workspace-desktop.png` and `before-workspace-mobile.png` (default state, real page) are taken before any CSS change.

#### 2. Token layer

**File**: `src/styles/global.css`

**Intent**: Express the cosmic look as roles so screens can read `bg-background`, `bg-card`, `text-muted-foreground`, `border-border`, `bg-input`, and so on.

**Contract**:
- `.dark` values are changed from neutral grays to cosmic values for `--background`, `--foreground`, `--card`, `--card-foreground`, `--secondary`, `--muted`, `--muted-foreground`, `--border`, `--input`, `--ring`, `--primary`, `--primary-foreground`; the `:root` values stay as they are.
- New roles, each defined in both `:root` and `.dark` and published in `@theme inline`: `--success`, `--warning`, `--destructive-foreground`, and the brand-gradient pair (for example `--brand-from`, `--brand-to`). The success and warning roles need a matching light foreground for text on their tinted alert backgrounds.
- `bg-cosmic` (`:113-115`) is rebuilt from `var(--background)` plus one new role token for the mid-stop; no `#hex` literal remains in the file. A gradient-text `@utility` (for example `text-gradient-brand`) is defined from the brand pair.
- No glass: `--card`, `--secondary`, `--input` and `--popover` in `.dark` are solid colors (no alpha channel), a step lighter than `--background` so cards, controls and fields stay distinguishable; `--border` stays a subtle solid or low-alpha line. Views must not use `backdrop-blur`.
- `--radius` (`:7`) is reduced from `0.625rem` to `0.375rem`, which makes `rounded-lg` 6px, `rounded-md` 4px and `rounded-sm` 2px; the card uses `rounded-lg`, never `rounded-2xl`. If 6px looks too sharp in the Phase 3 screenshot, adjust the one token.
- `.dark` also sets `color-scheme: dark`, so native form controls and scrollbars match.
- `--ring` in `.dark` is chosen to be at least 3:1 against `--card` (measured in Phase 4).

#### 3. Dark layer active

**File**: `src/layouts/Layout.astro`

**Intent**: Activate the `.dark` layer so tokens drive the screen.

**Contract**: `<html lang="en">` (`:14`) becomes `<html lang="en" class="dark">`. No toggle is added.

#### 4. Shared banner reads tokens

**File**: `src/components/Banner.astro`

**Intent**: Remove hex from the shared banner so config warnings follow the theme (charge C5).

**Contract**: Variants `info`, `warning`, `error` (`:27-40`) reference `var(--…)` roles (`--warning`, `--destructive`, and an info role or `--secondary`) instead of hex; the ARIA `role` logic at `:11` is unchanged.

### Success Criteria:

#### Automated Verification:

- Lint and type check pass: `npm run lint`, `npx astro check`
- Unit tests pass: `npm run test -- --run`
- No hex color literal remains in the token file or shared banner: `grep -nE "#[0-9a-fA-F]{3,8}" src/styles/global.css src/components/Banner.astro` returns no matches

#### Manual Verification:

- "Before" screenshots of the real workspace page (desktop and one mobile width) exist in the change folder and were taken before the CSS edit
- `tokens.md` lists every new and changed role with raw value, `oklch` value and the source line
- Index, 404 and delete pages look the same as before at a glance apart from slightly tighter `rounded-lg`/`rounded-xl` corners: cosmic gradient, no light strip, no white flash on load
- With `SUPABASE_URL` blanked, the config warning banner renders with themed colors on the dark page
- The token file has no translucent surface roles: `--card`, `--secondary`, `--input` and `--popover` in `.dark` have no alpha channel

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Components

### Overview

Add the two missing shared components through the stack's own path and make `Button` match the flat solid look, so the view has real primitives to import.

### Changes Required:

#### 1. New components

**File**: `src/components/ui/input.tsx`, `src/components/ui/alert.tsx` (generated)

**Intent**: Replace hand-rolled inputs and banners with the shadcn-owned versions.

**Contract**: Add with `npx shadcn add input alert` (`components.json` already configures `new-york`, `@/components/ui`). Do not run `shadcn init`. `Alert` gains `success` and `warning` variants alongside `default` and `destructive`, using `--success`, `--warning` and their foregrounds; its `destructive` variant reads `--destructive` and `--destructive-foreground`. `Alert` renders `role="alert"` for error and warning use; the status usage passes `role="status"` explicitly.

#### 2. Button

**File**: `src/components/ui/button.tsx`

**Intent**: Give `Button` a solid secondary look from tokens (no `bg-white/10`-style translucency, no blur) with a visible border and a hover step, and remove the literal `text-white`.

**Contract**: The destructive variant (`:14`) uses `text-destructive-foreground` instead of `text-white`. The look the view needs for Start, Copy, project buttons and Switch is expressed by an existing variant (`secondary` or `outline`) adjusted in place, not by a second Button or per-call class strings.

### Success Criteria:

#### Automated Verification:

- Lint and type check pass: `npm run lint`, `npx astro check`
- Build passes with the new components: `npm run build`
- `src/components/ui/` contains `button.tsx`, `input.tsx`, `alert.tsx`: `ls src/components/ui`
- No hex literal or `text-white` remains in `src/components/ui/`: `grep -rnE "#[0-9a-fA-F]{3,8}|text-white" src/components/ui` returns no matches

#### Manual Verification:

- A throwaway render of each new variant (default, destructive, success, warning alert; input; every Button variant used) on the dark page is legible; nothing is committed for it (the kitchen sink in Phase 3 replaces it)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: View migration and kitchen sink

### Overview

Extract the workspace card into a props-driven component, move it onto tokens and components, and add the dev-only kitchen sink that renders it from fixtures.

### Changes Required:

#### 1. Extracted card

**File**: `src/components/WorkspaceCard.astro` (new)

**Intent**: Hold the markup and client script of the card so the real page and the kitchen sink render identical output.

**Contract**: Props are the values the page already computes: `unavailable`, `bannerError`, `bannerStatus`, `currentTimer`, `projects`, `token`, `startAction` and `workspaceUrl`, plus the switch-form values that `timer-switch-rounding` Phase 3 introduced (`switchAction`, and the filtered project list). The component contains the three states (unavailable, default form, tracking) and the private-link block, and owns the copy and local-time `<script>` currently at `[token].astro:171-194`. It takes no data-loading responsibility.

#### 2. Workspace page

**File**: `src/pages/w/[token].astro`

**Intent**: Keep all loading, headers, redirects and status codes exactly as they are; delegate rendering to the card.

**Contract**: Frontmatter (`:1-69`, plus whatever Phase 3 of `timer-switch-rounding` added) is unchanged. The template becomes `<Layout><WorkspaceCard … /></Layout>`. Every `<input>`, `<button>`, banner `<p>` and color literal inside the card is replaced by `Input`, `Button`/`buttonVariants`, `Alert` and token classes (`bg-card`, `border-border`, `text-card-foreground`, `text-muted-foreground`, `text-gradient-brand`, …). The delete link keeps its route and text.

#### 3. Kitchen sink

**File**: `src/pages/dev/kitchen-sink.astro` (new)

**Intent**: One page showing every named state of the card at once, for the visual gate.

**Contract**: Returns `Astro.rewrite("/404")` unless `import.meta.env.DEV`, and sets `X-Robots-Tag: noindex`. Renders `WorkspaceCard` from fixtures, one per named state, side by side: default with projects, default with no projects (empty), tracking, error (`bannerError` set), status (`bannerStatus` set), unavailable, plus rows of component-level states for `Button`/`Input` (hover, focus, disabled, loading) and `Banner` (info, warning, error). Fixtures are static objects in the file; no database access.

### Success Criteria:

#### Automated Verification:

- Lint and type check pass: `npm run lint`, `npx astro check`
- Build passes: `npm run build`
- No color literal, `backdrop-blur` or `rounded-2xl` remains in the view or card: `grep -nE "#[0-9a-fA-F]{3,8}|(text|bg|border|from|to)-(white|black|blue|purple|red|emerald)|backdrop-blur|rounded-2xl" "src/pages/w/[token].astro" src/components/WorkspaceCard.astro` returns no matches (quote the bracketed path)
- Smoke still passes against a locally running dev server with a freshly reset database: `npm run smoke`
- Kitchen sink is dev-only: with the production build served (`npm run preview`), `GET /dev/kitchen-sink` returns 404

#### Manual Verification:

- The real workspace page at `/w/<token>` keeps the "before" screenshot's layout and hierarchy in the default and tracking states, including the switch form from `timer-switch-rounding`, with the intended delta: solid surfaces instead of glass, no blur, tighter corners
- Start, pick a project and Delete still work end to end through the real page
- `/dev/kitchen-sink` in dev renders every state listed in the Contract above

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: States, accessibility and gate

### Overview

Close the state and accessibility charges (C3, C4) on the migrated view and take the gate screenshots.

### Changes Required:

#### 1. States and accessibility in the card

**File**: `src/components/WorkspaceCard.astro`

**Intent**: Give the view the states and names it lacked.

**Contract**:
- Each input has a `<label>` (visually hidden with `sr-only` where the design has no visible label) or `aria-label`; the read-only link input is named.
- Error and status messages are `Alert` with `role="alert"` and `role="status"` respectively.
- Empty state: when `projects` is empty in the default state, a short muted line ("No projects yet") replaces the silent omission (`[token].astro:117`).
- Focus: every control shows a visible focus ring from `--ring`, including the Delete link (`focus-visible:` classes matching `Button`).
- Delete link: at least `text-sm` and `text-muted-foreground` at 4.5:1 or better, `hover:text-destructive`.
- Copy: `.catch` shows a short failure message in a live region ("Couldn't copy — select the link and copy it manually"), and the "Copied" label reverts after a short timeout.
- Unavailable state: a "Try again" link (`buttonVariants` on an `<a>` pointing to the current URL) under the message.
- Submit guard: forms disable their submit button in the `submit` handler and re-enable on a persisted `pageshow` (see Critical Implementation Details). This produces the real loading and disabled states.

#### 2. Kitchen sink covers the new states

**File**: `src/pages/dev/kitchen-sink.astro`

**Intent**: Make the gate show the new states.

**Contract**: Adds fixtures for the Copy states (idle, copied, failed) and the busy (disabled) submit button, and keeps a row per named state with its label.

#### 3. Gate evidence

**File**: `context/changes/workspace-ui-tokens/screenshots/`, `context/changes/workspace-ui-tokens/tokens.md`

**Intent**: Record the screenshots and measurements the review will read.

**Contract**: `after-kitchen-sink-desktop.png` (1280 px wide) and `after-kitchen-sink-mobile.png` (390 px wide), plus `after-workspace-desktop.png` / `after-workspace-mobile.png` of the real page. `tokens.md` gets a "Measured contrast" table (role pair, ratio, pass/fail) for body text, muted text, Delete link, alert text and the focus ring against their backgrounds, measured in the browser, not estimated. No baseline is updated; nothing is installed.

### Success Criteria:

#### Automated Verification:

- Lint and type check pass: `npm run lint`, `npx astro check`
- Build passes: `npm run build`
- Unit tests pass: `npm run test -- --run`
- Smoke passes against a locally running dev server with a freshly reset database: `npm run smoke`

#### Manual Verification:

- Kitchen-sink screenshots at desktop and one mobile width show all seven states: default, hover, focus, disabled, error, empty, loading
- Tabbing through the real workspace page shows a visible focus ring on every control, in DOM order, including the Delete links and Copy
- Contrast measured in the browser is at least 4.5:1 for text and at least 3:1 for the focus ring and control boundaries, recorded in `tokens.md`; anything below is fixed at the token layer, not in the view
- Submitting Start disables the button while the request is in flight, and using the browser Back button afterwards leaves it enabled
- With the clipboard blocked (or in an insecure context), Copy shows the failure message instead of nothing
- Reaching the page with the database unavailable (or the kitchen-sink "unavailable" fixture) shows the message and a working "Try again" link
- The mobile screenshot shows no horizontal scroll and no clipped controls

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to `/10x-impl-review`.

---

## Testing Strategy

### Unit Tests:

- No new unit tests. The work is styling and markup; there is no pure logic beyond the existing `src/lib` tests, which must keep passing.

### Integration Tests:

- `npm run smoke` after Phases 3 and 4 as a regression check that start, switch, and delete still work through the real routes.

### Visual gate:

- The kitchen-sink page screenshotted at desktop and one mobile width. No screenshot-test tooling exists in the repo and none is installed, so there are no baselines to update. The before/after screenshots are the delta explanation for review.

### Manual Testing Steps:

1. Open `/w/<token>` with no timer: start a new project by name, then pick an existing project.
2. Tab through the page; confirm focus is visible everywhere and Copy/Delete work by keyboard.
3. Click Copy with clipboard access denied; confirm the failure message.
4. Open `/dev/kitchen-sink`; confirm all seven states, at desktop width and at 390 px.
5. Open `/`, `/w/<bad-token>` (404) and a delete page; confirm no visual regressions from the dark `<html>` class.

## Performance Considerations

None expected: the new components render as static HTML with no client JS, and the only new script is a few lines in the card.

## Migration Notes

The kitchen-sink route ships in the Workers bundle and answers 404 outside development. The `.dark` class on `<html>` changes the body background on every page; the four existing pages paint their own cosmic wrapper on top, so no visible change is expected. If a page shows a light strip, fix it at the token layer.

## References

- Related research: `context/changes/workspace-ui-tokens/research.md`
- In-flight overlap: `context/changes/timer-switch-rounding/plan.md:202-206`
- Token source: `src/styles/global.css:6-111`
- Existing component: `src/components/ui/button.tsx:7-50`
- Lessons: `context/foundation/lessons.md` (Vite cache warm-up)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Tokens

#### Automated

- [ ] 1.1 Lint and type check pass: `npm run lint`, `npx astro check`
- [ ] 1.2 Unit tests pass: `npm run test -- --run`
- [ ] 1.3 No hex color literal remains in the token file or shared banner

#### Manual

- [ ] 1.4 "Before" screenshots of the real workspace page (desktop and one mobile width) exist and were taken before the CSS edit
- [ ] 1.5 `tokens.md` lists every new and changed role with raw value, `oklch` value and the source line
- [ ] 1.6 Index, 404 and delete pages look the same as before at a glance apart from tighter corners
- [ ] 1.7 With `SUPABASE_URL` blanked, the config warning banner renders with themed colors on the dark page
- [ ] 1.8 The token file has no translucent surface roles

### Phase 2: Components

#### Automated

- [ ] 2.1 Lint and type check pass: `npm run lint`, `npx astro check`
- [ ] 2.2 Build passes with the new components: `npm run build`
- [ ] 2.3 `src/components/ui/` contains `button.tsx`, `input.tsx`, `alert.tsx`
- [ ] 2.4 No hex literal or `text-white` remains in `src/components/ui/`

#### Manual

- [ ] 2.5 A throwaway render of each new variant on the dark page is legible

### Phase 3: View migration and kitchen sink

#### Automated

- [ ] 3.1 Lint and type check pass: `npm run lint`, `npx astro check`
- [ ] 3.2 Build passes: `npm run build`
- [ ] 3.3 No color literal, `backdrop-blur` or `rounded-2xl` remains in the view or card
- [ ] 3.4 Smoke still passes against a locally running dev server with a freshly reset database
- [ ] 3.5 Kitchen sink is dev-only: `GET /dev/kitchen-sink` returns 404 on the production build

#### Manual

- [ ] 3.6 The real workspace page keeps the "before" layout in the default and tracking states, with solid surfaces and tighter corners
- [ ] 3.7 Start, pick a project and Delete still work end to end through the real page
- [ ] 3.8 `/dev/kitchen-sink` in dev renders every state listed in the Contract

### Phase 4: States, accessibility and gate

#### Automated

- [ ] 4.1 Lint and type check pass: `npm run lint`, `npx astro check`
- [ ] 4.2 Build passes: `npm run build`
- [ ] 4.3 Unit tests pass: `npm run test -- --run`
- [ ] 4.4 Smoke passes against a locally running dev server with a freshly reset database

#### Manual

- [ ] 4.5 Kitchen-sink screenshots at desktop and one mobile width show all seven states
- [ ] 4.6 Tabbing through the real workspace page shows a visible focus ring on every control
- [ ] 4.7 Measured contrast is at least 4.5:1 for text and 3:1 for the focus ring and control boundaries, recorded in `tokens.md`
- [ ] 4.8 Submitting Start disables the button in flight, and Back leaves it enabled
- [ ] 4.9 With the clipboard blocked, Copy shows the failure message
- [ ] 4.10 The unavailable state shows the message and a working "Try again" link
- [ ] 4.11 The mobile screenshot shows no horizontal scroll and no clipped controls
