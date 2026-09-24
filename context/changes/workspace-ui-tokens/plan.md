# Workspace UI Tokens Implementation Plan

## Overview

Make the workspace view (`src/pages/w/[token].astro`) read semantic tokens and repo components instead of literal colors and hand-rolled controls. The look was changed by the user on 2026-09-24 (chosen from `screenshots/palette-light-gray.png`; a dark navy first draft and a blue-page second draft, `palette-options.png`, were rejected as too dark and too blue): a light-gray page with white solid cards, dark-gray primary buttons (Start, Switch), bordered secondary buttons (Copy, Delete), orange headings, a blue focus ring, no glass, and small corners (2px controls, 3px cards). The tokens and components are extended inside the existing Tailwind v4 + shadcn system; nothing is initialized twice. The view is then audited against the seven states and gated with a kitchen-sink page screenshotted at desktop and one mobile width.

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

The workspace view and the shell around it (`Layout`) take every color, radius and state from tokens in `global.css`, and every control from `components/ui`. Changing a token in `:root` changes the screen. The workspace shows a white card on a light-gray page with orange headings, dark-gray primary buttons, bordered secondary buttons, solid surfaces instead of translucent glass, and 2px control / 3px card corners; keyboard focus is visible, every control has an accessible name, errors are announced, and each of the seven states (default, hover, focus, disabled, error, empty, loading) can be seen at once on `/dev/kitchen-sink` in development. Verify with the screenshots in `context/changes/workspace-ui-tokens/screenshots/` and the measured contrast values recorded in `tokens.md`.

### Key Discoveries:

- `@theme inline` already publishes by reference (`var(--x)`), which is the correct split; the work is adding roles and mapping values, not restructuring (`global.css:75-111`).
- The palette now lives in `:root` (the app has one look). `@custom-variant dark` and the `.dark` layer stay as the stock shadcn set and are unused.
- `Button` already has `focus-visible:ring-[3px] focus-visible:ring-ring/50` and `disabled:opacity-50` (`button.tsx:8`), so adopting it brings those states with it.
- The Astro React integration is present (`astro.config.mjs:4,12`) and no page uses `client:`; `Input`, `Alert` and `Button` render as static HTML with no hydration and no client JS.
- `scripts/smoke.mjs` drives the API over HTTP and does not depend on workspace markup, so it stays a valid regression check.

## What We're NOT Doing

- No `shadcn init`, no second palette, no light/dark theme toggle. The app has one look, in `:root`; the `.dark` layer is the stock shadcn set and is applied nowhere.
- Restyling `index.astro`, `404.astro` and `delete.astro` was first deferred; the user decided on 2026-09-24 that **all pages adopt the light-gray look**, so they are restyled in Phase 5 (their routes, redirects and logic are untouched).
- No `Card` component (the repeated card wrapper stays a token-based class string in `WorkspaceCard.astro`).
- Until Phase 5 lands, index, 404 and delete keep their dark navy look (`bg-cosmic`, kept as a legacy utility) and their translucent cards; only their radii shrink with the tokens.
- No shared Banner: `Banner.astro` and its use in `Layout.astro` are removed (user decision, 2026-09-24), so charge C5 is closed by removal. `src/lib/config-status.ts` loses its only consumer and is left in place, flagged as dead code for a follow-up.
- No layout reordering, notably not moving the "Your private link" block (`[token].astro:143-164`). Layout is judged after the view is built from tokens, in the `/10x-impl-review` loop.
- No shared "Temporarily unavailable" component for `delete.astro`; its duplicate copy (`delete.astro:51-55`) is deferred.
- No new timer behavior, no stop action, no changes to routes or the database. The one `src/lib` addition is the daily heading list and its pure function (Phase 3).
- No screenshot-test tooling installed, and no baselines.

## Implementation Approach

Fix the contract before the pixels: tokens first (Phase 1), then the components that read them (Phase 2), then move the one view onto both while extracting it into a props-driven component so a kitchen sink can render the real markup (Phase 3), then add the states and accessibility the view lacked and take the gate screenshots (Phase 4), and finally restyle the other three pages on the same shared parts and delete the legacy dark utility (Phase 5). Values come from the Tailwind v4 palette, chosen by the user on 2026-09-24 from a mock, so the source line is "light-gray page, white cards, dark-gray primary buttons, bordered secondary buttons, orange headings and a blue focus ring, chosen by the user on 2026-09-24 from mocks (`screenshots/palette-light-gray.png`), no external preset"; the raw values go into `context/changes/workspace-ui-tokens/tokens.md` before the CSS is edited.

## Critical Implementation Details

- **Token layering (Tailwind v4):** put values only in `:root` / `.dark` and publish them through `@theme inline` as `var(--x)`. Do not write raw colors into `@theme inline`; that is the classic dark-mode break. New roles need a value in both `:root` and `.dark`.
- **Astro + React components:** `Button` with `asChild` cannot wrap an Astro element. For a link that must look like a button (the retry link), put `buttonVariants({ variant })` on an `<a>`.
- **Submit guard:** disable the submit button inside the form's `submit` event handler (the submit buttons have no `name`/`value`, and pick-list forms carry the name in a hidden input, so no data is lost). Re-enable on `pageshow` when `event.persisted` is true, otherwise a back-navigation restores a disabled button from the back/forward cache.
- **Kitchen sink is not a production page:** `src/pages/dev/kitchen-sink.astro` must return a 404 (`Astro.rewrite("/404")`) unless `import.meta.env.DEV`, and set the same `X-Robots-Tag: noindex` header the other pages set. It ships in the Workers bundle, so the guard is the only protection.
- **Dev server:** if `npx astro dev` reports "failed to start" after adding components or dependencies, follow `context/foundation/lessons.md`: run `npx astro check` once to warm Vite's cache, then start dev again.

## Phase 1: Tokens

### Overview

Express the chosen palette (light-gray page, white cards, dark-gray buttons, orange headings) and the two radii as roles in `global.css`, and remove the shared banner. No view markup changes yet, so the pages keep their current look until Phase 3 moves the workspace onto the tokens; only the corner radii change, on every page at once.

### Changes Required:

#### 1. Token deposit and "before" evidence

**File**: `context/changes/workspace-ui-tokens/tokens.md` (new), `context/changes/workspace-ui-tokens/screenshots/` (new)

**Intent**: Record the raw values and their source before editing CSS, and capture the current look so the visual delta can be explained later.

**Contract**: `tokens.md` lists each role with its source (a Tailwind palette value, or the literal it replaces), the `oklch` value, and the line "Values: light-gray page, white cards, dark-gray primary buttons, bordered secondary buttons, orange headings and a blue focus ring, chosen by the user on 2026-09-24 from mocks (`screenshots/palette-light-gray.png`), no external preset." Screenshots `before-workspace-desktop.png` and `before-workspace-mobile.png` (default state, real page), the tracking-state pair, and the delete, 404 and landing pages are taken before any CSS change.

#### 2. Token layer

**File**: `src/styles/global.css`

**Intent**: Express the look as roles so screens can read `bg-card`, `text-card-foreground`, `text-heading`, `bg-input`, `border-border`, and so on.

**Contract**:
- Values live in `:root` (one look), Tailwind gray scale. `--background` and `--background-end` are the light-gray page (gray-100 to gray-200) and `--foreground` is gray-900 text on it; `--card` and `--popover` are white with gray-900 text; `--field` (new, the fill of form fields) is white and `--input` (their border, as in shadcn) is gray-500 so a field is visible on the card; `--secondary` and `--muted` are gray-100 (bordered with `--border` gray-300 in Phase 2), `--accent` gray-200, `--muted-foreground` gray-600; `--primary` is gray-800 with white text (Start, Switch); `--ring` is blue-600; `--heading` (new) is orange-700.
- New roles in both layers, published in `@theme inline`: `--success`, `--warning`, `--destructive-foreground`, `--heading`, `--field` and `--background-end`, with a `-foreground` where a text color is needed.
- The `.dark` layer is restored to the stock shadcn values plus the new roles; it is unused (no `dark` class is applied). `Layout.astro` gets no class.
- No glass: every surface role in the active layer is a solid color (no alpha channel); views must not use `backdrop-blur`.
- Radii: `--radius` is 2px (controls) and a new `--radius-card` is 3px. `@theme inline` maps `--radius-sm`, `-md` and `-lg` to `--radius` and `-xl` and `-2xl` to `--radius-card`, so every `rounded-lg` control is 2px and every `rounded-xl` / `rounded-2xl` card is 3px, including on the pages that are not restyled.
- `bg-cosmic` keeps its name and its old dark navy look (rewritten in `oklch`, no hex) as a legacy utility for index, 404 and delete, whose white-on-glass text would be unreadable on the light page. The workspace stops using it in Phase 3 and uses `bg-background`; Phase 5 restyles the other pages and deletes the utility. No `#hex` literal remains in the file.
- `--ring` is chosen to be at least 3:1 against `--card` (measured in Phase 4).

#### 3. Banner removed

**File**: `src/components/Banner.astro` (deleted), `src/layouts/Layout.astro`

**Intent**: The config-warning strip is not needed (user decision, 2026-09-24), so charge C5 is closed by removal instead of tokenization.

**Contract**: Delete `Banner.astro`. `Layout.astro` no longer imports it or `missingConfigs` and renders only `<slot />` in the body. `src/lib/config-status.ts` now has no consumer and is left in place, flagged as dead code.

### Success Criteria:

#### Automated Verification:

- Lint and type check pass: `npm run lint`, `npx astro check`
- Unit tests pass: `npm run test -- --run`
- No hex color literal remains in the token file: `grep -nE "#[0-9a-fA-F]{3,8}" src/styles/global.css` returns no matches
- `Banner.astro` is gone and nothing references it: `grep -rn "Banner" src` returns no matches

#### Manual Verification:

- "Before" screenshots of the real workspace page (desktop and one mobile width) exist in the change folder and were taken before the CSS edit
- `tokens.md` lists every new and changed role with its source, `oklch` value and the source line
- Index, 404 and delete pages look the same as before at a glance apart from the smaller corners (they keep their dark navy page and translucent cards until a follow-up change)
- The active layer (`:root`) has no translucent surface roles: `--card`, `--secondary`, `--input` and `--popover` have no alpha channel

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

- A throwaway render of each new variant (default, destructive, success, warning alert; input; every Button variant used) on the light-gray page and on a white card is legible; nothing is committed for it (the kitchen sink in Phase 3 replaces it)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: View migration and kitchen sink

### Overview

Extract the workspace card into a props-driven component, move it onto tokens and components, and add the dev-only kitchen sink that renders it from fixtures.

### Changes Required:

#### 1. Extracted card

**File**: `src/components/WorkspaceCard.astro` (new), `src/components/PageCard.astro` (new)

**Intent**: Hold the markup and client script of the card so the real page and the kitchen sink render identical output.

**Contract**: Props are the values the page already computes: `unavailable`, `bannerError`, `bannerStatus`, `currentTimer`, `projects`, `token`, `startAction` and `workspaceUrl`, plus the switch-form values that `timer-switch-rounding` Phase 3 introduced (`switchAction`, and the filtered project list). The component contains the three states (unavailable, default form, tracking) and the private-link block, and owns the copy and local-time `<script>` currently at `[token].astro:171-194`. It takes no data-loading responsibility. `WorkspaceCard` is built on a new shared `PageCard.astro`: the full-height `bg-background` page wrapper that centers a `rounded-xl border border-border bg-card p-8 text-card-foreground shadow-sm` card, with a `max-w` prop, so Phase 5 reuses it on the other pages.

#### 2. Workspace page

**File**: `src/pages/w/[token].astro`

**Intent**: Keep all loading, headers, redirects and status codes exactly as they are; delegate rendering to the card.

**Contract**: Frontmatter (`:1-69`, plus whatever Phase 3 of `timer-switch-rounding` added) is unchanged. The template becomes `<Layout><WorkspaceCard … /></Layout>`. Every `<input>`, `<button>`, banner `<p>` and color literal inside the card is replaced by `Input`, `Button`/`buttonVariants`, `Alert` and token classes (`bg-card`, `border-border`, `text-card-foreground`, `text-muted-foreground`, `text-heading`, `rounded-xl` for the card, …). The page wrapper uses `bg-background` instead of `bg-cosmic`. Start and Switch use the default (dark-gray primary) `Button`; Copy and each project's Delete use the bordered secondary variant, the Delete as `buttonVariants({ variant: "secondary", size: "sm" })` on the existing `<a>`. The four action buttons (Start, Switch, Delete, Copy) share one fixed width (about 84px, e.g. `w-21` or `w-[84px]`) with centered text, so the buttons line up in one column down the card. The delete link keeps its route and text.

#### 3. Kitchen sink

**File**: `src/pages/dev/kitchen-sink.astro` (new)

**Intent**: One page showing every named state of the card at once, for the visual gate.

**Contract**: Returns `Astro.rewrite("/404")` unless `import.meta.env.DEV`, and sets `X-Robots-Tag: noindex`. Renders `WorkspaceCard` from fixtures, one per named state, side by side: default with projects, default with no projects (empty), tracking, error (`bannerError` set), status (`bannerStatus` set), unavailable, plus rows of component-level states for `Button`/`Input` (hover, focus, disabled, loading). Fixtures are static objects in the file; no database access.

#### 4. Daily heading

**File**: `src/lib/workspace-headings.ts` (new), `src/lib/workspace-headings.test.ts` (new), `src/components/WorkspaceCard.astro`

**Intent**: Replace the fixed "Your workspace" heading with one funny heading pair per day (user decision, 2026-09-24), the same all day and different the next day, so the joke wears off less.

**Contract**:
- `workspace-headings.ts` exports a fixed, shuffled list of six `{ idle, tracking }` pairs and a pure `headingForDate(date: Date)`. It reads the year, month and day with the Date's **local** getters (on the server that is UTC), takes the day number `Math.floor(Date.UTC(y, m, d) / 86400000)` and returns `headings[dayNumber % 6]`, so the same day always gives the same pair and consecutive days never repeat.
- The six pairs (idle / tracking): "Where did the day go?" / "Right here. Don't blink."; "Friday-you will thank you" / "Friday-you says thanks"; "Tick. Tock. Pick a project." / "Tick. Tock. Still going."; "Ready, set, bill." / "Billing in progress"; "No accounts. No judgment." / "No judgment. Just minutes."; "Time flies. Let's catch it." / "Caught it. Hold tight."
- `WorkspaceCard` renders the workspace `<h1>` from `headingForDate(new Date())` on the server, showing `idle` when no timer runs and `tracking` when one does. Its existing client script then recomputes the pair from the viewer's local date and replaces the text only if it differs, the same pattern as the started-at time. A `headingIndex` prop (used by the kitchen sink) pins the pair and turns the client correction off, so screenshots are stable.
- The "Temporarily unavailable" state keeps its own heading; nothing else is rotated.
- `workspace-headings.test.ts` covers: the same date twice gives the same pair; two consecutive dates give different pairs; N consecutive dates cycle through all six pairs; a fixed date gives a fixed expected pair; every pair has non-empty idle and tracking text.

### Success Criteria:

#### Automated Verification:

- Lint and type check pass: `npm run lint`, `npx astro check`
- Build passes: `npm run build`
- No color literal, `backdrop-blur` or `rounded-2xl` remains in the view or card: `grep -nE "#[0-9a-fA-F]{3,8}|(text|bg|border|from|to)-(white|black|blue|purple|red|emerald)|backdrop-blur|rounded-2xl" "src/pages/w/[token].astro" src/components/WorkspaceCard.astro` returns no matches (quote the bracketed path)
- Smoke still passes against a locally running dev server with a freshly reset database: `npm run smoke`
- Heading rotation unit tests pass: `npm run test -- --run src/lib/workspace-headings.test.ts`
- Kitchen sink is dev-only: with the production build served (`npm run preview`), `GET /dev/kitchen-sink` returns 404

#### Manual Verification:

- The real workspace page at `/w/<token>` keeps the "before" screenshot's layout and hierarchy in the default and tracking states, including the switch form from `timer-switch-rounding`, with the intended delta: a white card on the light-gray page, dark-gray primary buttons, bordered secondary buttons (Copy, Delete), solid surfaces instead of glass, orange headings, smaller corners
- Start, pick a project and Delete still work end to end through the real page
- `/dev/kitchen-sink` in dev renders every state listed in the Contract above
- The workspace heading is today's pair (idle when no timer runs, tracking line while one runs), stays the same after a reload, and the kitchen sink shows a fixed pair

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
- Delete: a bordered secondary-style small button (same look as Copy), text at 4.5:1 or better, `hover:text-destructive`.
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

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to Phase 5.

---

## Phase 5: Other pages

### Overview

User decision (2026-09-24): every page adopts the light-gray look. Restyle the landing, 404 and delete pages onto the same tokens and shared parts as the workspace, then delete the temporary dark `bg-cosmic` utility. Routes, redirects, headers and page logic are untouched.

### Changes Required:

#### 1. Landing, 404 and delete pages

**File**: `src/pages/index.astro`, `src/pages/404.astro`, `src/pages/w/[token]/projects/[projectId]/delete.astro`

**Intent**: Give each page the same look as the workspace, using the shared parts instead of hand-rolled glass classes.

**Contract**: Each page uses `PageCard` (from Phase 3) instead of its own `bg-cosmic … bg-white/10 backdrop-blur-xl` divs. Headings use `text-heading` (the blue-purple gradient is gone) and body copy `text-muted-foreground`. Buttons come from `Button` / `buttonVariants`: the landing "Create my private link" is the default (dark-gray primary) variant, replacing `bg-purple-600` (`index.astro:45-50`); on the delete page "Confirm delete" is the destructive variant and "Cancel" is a secondary `<a>`. The landing error `<p>` (`index.astro:36`) becomes a destructive `Alert` with `role="alert"`. The Turnstile container is rendered with `data-theme="light"`. The duplicated "Temporarily unavailable" copy on the delete page stays duplicated (deferred).

#### 2. Legacy utility removed

**File**: `src/styles/global.css`

**Intent**: No page uses the dark navy look any more, so the temporary utility goes.

**Contract**: Delete `@utility bg-cosmic` and its comment; `grep -rn "bg-cosmic" src` returns no matches. The `tokens.md` legacy note is removed.

### Success Criteria:

#### Automated Verification:

- Lint and type check pass: `npm run lint`, `npx astro check`
- Build passes: `npm run build`
- No legacy or literal styling remains in the pages, styles or components: `grep -rnE "bg-cosmic|backdrop-blur|rounded-2xl|(text|bg|border|from|to)-(white|black|blue|purple|red|emerald)" src/pages src/styles src/components` returns no matches
- Smoke passes against a locally running dev server with a freshly reset database: `npm run smoke`

#### Manual Verification:

- Landing, 404 and delete pages render as a white card on the light-gray page with orange headings and the shared button styles, at desktop and at 390px, with no horizontal scroll
- Creating a link from the landing page in a browser (dummy Turnstile) and confirming a project delete still work end to end
- The Turnstile widget is readable on the light page

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
5. Open `/`, `/w/<bad-token>` (404) and a delete page; confirm they look unchanged apart from the smaller corners.

## Performance Considerations

None expected: the new components render as static HTML with no client JS, and the only new script is a few lines in the card.

## Migration Notes

The kitchen-sink route ships in the Workers bundle and answers 404 outside development. The four existing pages paint their own `bg-cosmic` wrapper, which stays the old dark navy gradient (legacy); the workspace moves to the light page in Phase 3, and index, 404 and delete keep their dark look until Phase 5. If a page shows a light strip, fix it at the token layer.

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

- [x] 1.1 Lint and type check pass: `npm run lint`, `npx astro check`
- [x] 1.2 Unit tests pass: `npm run test -- --run`
- [x] 1.3 No hex color literal remains in the token file
- [x] 1.9 `Banner.astro` is gone and nothing references it

#### Manual

- [x] 1.4 "Before" screenshots of the real workspace page (desktop and one mobile width) exist and were taken before the CSS edit
- [x] 1.5 `tokens.md` lists every new and changed role with its source, `oklch` value and the source line
- [x] 1.6 Index, 404 and delete pages look the same as before at a glance apart from the smaller corners
- [x] 1.8 The active layer (`:root`) has no translucent surface roles

### Phase 2: Components

#### Automated

- [ ] 2.1 Lint and type check pass: `npm run lint`, `npx astro check`
- [ ] 2.2 Build passes with the new components: `npm run build`
- [ ] 2.3 `src/components/ui/` contains `button.tsx`, `input.tsx`, `alert.tsx`
- [ ] 2.4 No hex literal or `text-white` remains in `src/components/ui/`

#### Manual

- [ ] 2.5 A throwaway render of each new variant on the light-gray page is legible

### Phase 3: View migration and kitchen sink

#### Automated

- [ ] 3.1 Lint and type check pass: `npm run lint`, `npx astro check`
- [ ] 3.2 Build passes: `npm run build`
- [ ] 3.3 No color literal, `backdrop-blur` or `rounded-2xl` remains in the view or card
- [ ] 3.4 Smoke still passes against a locally running dev server with a freshly reset database
- [ ] 3.5 Kitchen sink is dev-only: `GET /dev/kitchen-sink` returns 404 on the production build
- [ ] 3.9 Heading rotation unit tests pass

#### Manual

- [ ] 3.6 The real workspace page keeps the "before" layout in the default and tracking states, with solid surfaces and tighter corners
- [ ] 3.7 Start, pick a project and Delete still work end to end through the real page
- [ ] 3.8 `/dev/kitchen-sink` in dev renders every state listed in the Contract
- [ ] 3.10 The workspace heading is today's pair, stable across a reload, and the kitchen sink shows a fixed pair

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

### Phase 5: Other pages

#### Automated

- [ ] 5.1 Lint and type check pass: `npm run lint`, `npx astro check`
- [ ] 5.2 Build passes: `npm run build`
- [ ] 5.3 No legacy or literal styling remains in the pages, styles or components
- [ ] 5.4 Smoke passes against a locally running dev server with a freshly reset database

#### Manual

- [ ] 5.5 Landing, 404 and delete pages render as a white card on the light-gray page at desktop and 390px
- [ ] 5.6 Creating a link from the landing page and confirming a project delete work end to end in a browser
- [ ] 5.7 The Turnstile widget is readable on the light page
