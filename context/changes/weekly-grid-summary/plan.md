# Weekly Grid Summary (S-06) Implementation Plan

## Overview

Build the weekly grid summary page (roadmap S-06, PRD FR-006): a new,
navigable, read-only view at the user's workspace showing time logged that
week laid out exactly as Project/Task/Type/Work Type × Mon–Sun, with
15-minute-rounded daily totals, ready to copy into the company timesheet.

## Current State Analysis

`time_entries` already carries everything the grid needs —
`project_name`, `task`, `type`, `work_type`, `started_at`, `ended_at` — all
denormalized/snapshotted onto each row at entry-creation time by
`start_timer`/`switch_timer`
(`supabase/migrations/20260922150000_projects_and_timer.sql:94`,
`20260923120000_switch_timer.sql:88`). No schema changes are needed.

No aggregation, rounding, or date-bucketing logic exists anywhere in `src/`
today. The rounding rule itself was already decided by S-03
(`context/foundation/roadmap.md:119`, resolved 2026-09-23): round each
project's tracked time *per day*, not per individual segment, always up to
the next 15-minute increment — implementation was explicitly deferred here
because the Mon–Sun day-boundary/timezone question was still open. That
question is now resolved (see Key Discoveries).

The single existing workspace page (`src/pages/w/[token].astro`) renders
one `WorkspaceCard` component (timer + project list + link management) and
has no table/grid UI. No `<Table>` or grid component exists anywhere in the
codebase. Every existing API route
(`src/pages/api/w/[token]/timer/{start,stop,switch}.ts`,
`projects/[projectId]/delete.ts`) follows a strict POST-form→303-redirect
(PRG) pattern with independent per-request link-token re-derivation
(`isWellFormedToken` → `findLinkByToken`, never trusting the
`stopper_link` cookie for authorization) — this plan's new page reuses that
same auth pattern, since it's the codebase's only precedent for handling a
tokenized route.

### Key Discoveries:

- **Timezone/day-boundary: UTC.** Postgres's session timezone defaults to
  UTC with no override anywhere in `supabase/config.toml`
  (confirmed by a comment in
  `supabase/migrations/20260925120000_purge_time_entries.sql:9`: "Supabase
  sessions default to UTC"). All `time_entries`/`projects` timestamp
  columns are `timestamptz`. Mon–Sun day boundaries for this grid are
  computed in UTC, using `Date.UTC`/`getUTC*` accessors — never local
  `Date` getters — matching the one existing precedent for date-bucketing
  in this codebase (`src/lib/workspace-headings.ts:25-29`).
- **No date/timezone library is installed** (`date-fns`/`dayjs`/`luxon`
  all absent from `package.json`). Existing precedent
  (`timer-flag.ts`, `workspace-headings.ts`) is vanilla `Date` millisecond
  arithmetic — this plan follows that convention rather than adding a
  dependency.
- **Rounding order matters.** The resolved S-03 rule rounds the *summed*
  raw minutes for a (day, row) cell once — it does NOT round each raw
  segment individually before summing. Per-segment rounding silently
  overstates hours (this exact distinction is named in
  `context/foundation/test-plan.md`'s Risk Response Guidance for Risk #5).
  See Critical Implementation Details.
- **Supabase-touching wrappers in this codebase have no dedicated unit
  test file** (`src/lib/timer.ts` has none, despite `timer-flag.ts` and
  `workspace-headings.ts` — both pure — each having a `.test.ts`
  sibling). This plan follows that same split: pure aggregation/rounding
  logic gets a `.test.ts` file; the thin Supabase fetch wrapper does not,
  and is verified manually/via the page instead.

## Desired End State

A person can open a new grid page from their workspace, see the current
UTC week's time laid out as Project/Task/Type/Work Type rows × Mon–Sun
day columns with 15-minute-rounded totals (including the still-running
timer's live elapsed time), navigate to any past week whose entire 7-day
span is still within the 3-month retention window (FR-008), and read the
table directly — no copy-to-clipboard affordance, per the interview
decision.

**Verification**: `npx vitest run src/lib/weekly-grid.test.ts` passes;
loading `/w/[token]/grid` for a link with seeded multi-week, multi-project
data (including a midnight-spanning segment and a mid-week project-name
edit) renders the correct rows and totals, in both light and dark theme.

## What We're NOT Doing

- No copy-to-clipboard button — on-screen table only, per interview
  decision.
- No per-viewer timezone handling — UTC only.
- No incomplete-data banner — superseded by restricting navigation to
  whole weeks entirely within the 3-month retention window, so no
  reachable week is ever partially purged.
- No zero-hour/empty-project rows — only (Project, Task, Type, Work Type)
  combinations with at least one logged minute that week appear.
- No new date/timezone npm dependency — vanilla `Date`/`Date.UTC` math,
  matching existing codebase convention.
- No S-05 (time-corrections) work — separate roadmap slice.
- No pgTAP-style deliberate-break test coverage for this feature — that is
  `test-plan.md` §3's own separate Phase 2 ("Weekly grid rounding &
  aggregation"), sequenced to land alongside or after this plan via its
  own `/10x-new` → `/10x-research` → `/10x-plan` → `/10x-implement` chain,
  not part of this change.
- No schema/migration changes — `time_entries` already carries every
  needed column.

## Implementation Approach

Pure aggregation/rounding logic lives in its own testable module
(Phase 1), fed by a thin Supabase query module (Phase 2), rendered by a
new SSR Astro page reusing the existing tokenized-route auth pattern and
design-token system (Phase 3), then wired into the existing workspace and
registered for visual QA (Phase 4). No new API/JSON route is introduced —
this is a read-only page, so it follows the same direct-SSR-read pattern
the existing workspace page already uses, not the PRG pattern that exists
only for the app's mutation routes.

## Critical Implementation Details

- **Round the cell, not the segment.** For each (day, Project/Task/Type/
  Work Type) bucket, sum every contributing segment's raw minutes first
  (including any midnight-split portion — see below), THEN round that one
  summed value up to the next 15-minute increment. Rounding each
  contributing segment individually before summing silently overstates
  the daily total — this is the exact anti-pattern
  `test-plan.md`'s Risk Response Guidance for Risk #5 names.
- **Midnight split happens before rounding, in UTC.** A segment whose
  `[started_at, ended_at)` interval crosses a UTC day boundary must be
  split at that boundary into two raw-minute portions — one credited to
  each day — before either day's cell is rounded. Use `Date.UTC`/`getUTC*`
  accessors throughout; a local-time split would silently reintroduce the
  timezone question this plan resolved.
- **The live open entry needs an explicit "now".** The currently-running
  timer's `ended_at` is `null`; its elapsed-so-far portion must be
  computed against a `now` value passed as a parameter (never read
  internally via `Date.now()`), so the aggregation function stays pure and
  testable with fixed clock values — matching the pattern
  `dev/kitchen-sink.astro` already uses to pin the clock for stable
  screenshots.

## Phase 1: Aggregation & rounding core logic

### Overview

A pure, unit-tested function that turns raw `time_entries`-shaped rows for
one UTC week into day-bucketed, rounded, grouped grid rows.

### Changes Required:

#### 1. Pure aggregation module

**File**: `src/lib/weekly-grid.ts`

**Intent**: Given raw entries and a week's UTC start, produce grid rows
grouped by the full (Project, Task, Type, Work Type) tuple — never
collapsing or overwriting historical values, per the interview decision —
each with 7 day-bucketed, 15-minute-rounded totals, omitting any row whose
weekly total across all 7 days is zero.

**Contract**: The function signature is load-bearing for Phases 2 and 3,
so it's specified explicitly:

```ts
interface RawWeekEntry {
  projectName: string;
  task: string | null;
  type: string;
  workType: string;
  startedAt: string; // ISO timestamptz
  endedAt: string | null; // null = still running
}

interface GridRow {
  projectName: string;
  task: string | null;
  type: string;
  workType: string;
  // index 0 = Monday .. index 6 = Sunday, minutes rounded up to 15
  dailyMinutes: [number, number, number, number, number, number, number];
}

function buildWeeklyGrid(
  entries: RawWeekEntry[],
  weekStartUtc: Date, // UTC Monday 00:00:00.000
  nowUtc: Date, // for crediting the still-open entry's elapsed time
): GridRow[];
```

Row ordering: alphabetical by `projectName` (matching `listProjects`'s
existing `order("name")` convention).

#### 2. Unit tests

**File**: `src/lib/weekly-grid.test.ts`

**Intent**: Cover, at minimum: a segment entirely within one day; a
segment spanning a UTC midnight boundary (split correctly, each day
rounded independently — not the segment rounded once then split); two
segments in the same (day, row) cell whose raw minutes sum before
rounding (proving cell-level, not segment-level, rounding); a still-open
entry credited up to a fixed `nowUtc`; two entries for the same project
with different `task`/`type`/`work_type` producing two distinct rows; a
row with zero total minutes across the week omitted from the result;
alphabetical row ordering.

### Success Criteria:

#### Automated Verification:

- `npx vitest run src/lib/weekly-grid.test.ts` passes, covering every case
  listed above

#### Manual Verification:

- Hand-trace one midnight-spanning example (e.g. a segment 23:30 Mon–00:45
  Tue UTC) against the function's output and confirm the split minutes
  match hand calculation

---

## Phase 2: Weekly-grid data access

### Overview

Fetch the raw entries `buildWeeklyGrid` needs for a given week, and
determine which weeks are navigable under the 3-month retention window.

### Changes Required:

#### 1. Retention-window helper (pure)

**File**: `src/lib/weekly-grid-query.ts`

**Intent**: Compute the oldest UTC Monday whose entire 7-day span is still
within FR-008's 3-month retention window, so Phase 3 can hide/disable
"previous week" navigation once reached — resolving the interview's
correction (restrict navigation rather than show an incomplete-data
banner) by construction, so no partially-purged week is ever reachable.

**Contract**: `earliestNavigableWeekStart(nowUtc: Date): Date` — returns
the UTC Monday 00:00 of the oldest week whose Sunday-end is still `>=`
`nowUtc` minus 3 months. Pure function; gets its own `.test.ts` alongside
`weekly-grid.test.ts`'s conventions.

#### 2. Entry fetch

**File**: `src/lib/weekly-grid-query.ts`

**Intent**: Fetch every `time_entries` row for a link that overlaps the
given UTC week — including the currently-open entry (`ended_at is null`)
and any entry whose span crosses into the week from an adjacent day.
Follows this codebase's existing Supabase-wrapper convention
(`src/lib/timer.ts`, `src/lib/projects.ts`): a thin function with no
dedicated unit test, verified instead via Phase 3's manual check.

**Contract**: `fetchWeekEntries(linkId: string, weekStartUtc: Date): Promise<RawWeekEntry[]>`
— queries `time_entries` where `link_id = linkId` and the entry overlaps
`[weekStartUtc, weekStartUtc + 7 days)`, ordered by `started_at`. Maps
Supabase rows to the `RawWeekEntry` shape Phase 1 defined.

### Success Criteria:

#### Automated Verification:

- `npx vitest run src/lib/weekly-grid-query.test.ts` passes for
  `earliestNavigableWeekStart`
- `npm run build` passes (typecheck covers `fetchWeekEntries`'s Supabase
  query shape)

#### Manual Verification:

- Using the Supabase Studio SQL editor or a scratch script against a
  hand-seeded week of test data (including a currently-open entry and a
  week-boundary-spanning entry), confirm `fetchWeekEntries` returns
  exactly the expected rows

---

## Phase 3: Grid page, route, and UI

### Overview

A new SSR page rendering the grid, with UTC-week navigation restricted to
the retention window.

### Changes Required:

#### 1. Grid page

**File**: `src/pages/w/[token]/grid.astro`

**Intent**: Render the weekly grid for a tokenized link, reusing the
existing auth pattern (`isWellFormedToken` → `findLinkByToken` → 404/503,
same security headers as `src/pages/w/[token].astro:17-18`) and design
tokens (`PageCard`, `--card`/`--border`/`--muted-foreground` per
`tokens.md`). Accepts the viewed week via a query param, defaulting to the
current UTC week when absent.

**Contract**: URL shape `/w/[token]/grid?week=<N>`, where `N` is the number
of whole weeks before the current UTC week (`0` = current week, `1` = last
week, and so on) — not an absolute calendar/ISO week number, which would
need a year anchor and disagrees with itself across a year boundary.
Malformed, negative, or out-of-range values fall back to the current week.
Table columns: Project (with Task - Type - Work Type as a subtitle line) |
Mon | Tue | Wed | Thu | Fri | Sat | Sun. "Previous week" link omitted once
`earliestNavigableWeekStart` is reached; "next week" link omitted once the
viewed week is the current week. Uses `buildWeeklyGrid` +
`fetchWeekEntries` from Phases 1–2; passes `new Date()` as `nowUtc` at
request time.

#### 2. Empty-week state

**File**: `src/pages/w/[token]/grid.astro`

**Intent**: When `buildWeeklyGrid` returns zero rows (no time logged that
week), render a clear empty-state message rather than a headerless empty
table, consistent with `WorkspaceCard.astro`'s existing pattern of
distinct named states (idle/tracking/error/unavailable).

**Contract**: Reuse the existing `Alert`/`AlertDescription` components
(`src/components/ui/alert.tsx`) for the empty-state message, matching
`WorkspaceCard.astro`'s banner conventions.

### Success Criteria:

#### Automated Verification:

- `npm run build` passes (typecheck + Astro build for the new page)
- `npm run lint` passes for the new file

#### Manual Verification:

- Load `/w/[token]/grid` for a link with seeded multi-week data: table
  renders correct headers/rows; week navigation works; "previous week" is
  absent at the 3-month boundary; "next week" is absent on the current
  week; zero-time rows are omitted; the live open entry's elapsed time
  appears in today's total; the midnight-spanning entry is split across
  the correct two days; a project edited mid-week shows as two distinct
  rows with the correct historical Task/Type/Work Type on each; empty-week
  state renders correctly for a week with no entries
- Verify in both light and dark theme (per `lessons.md`'s manual-testing
  convention)

---

## Phase 4: Wiring, kitchen-sink registration, and visual QA

### Overview

Make the grid reachable from the main workspace, and register it for the
project's established screenshot-based visual QA convention.

### Changes Required:

#### 1. Link from the main workspace page

**File**: `src/components/WorkspaceCard.astro`

**Intent**: Add a visible link/button to `/w/[token]/grid` so a user can
reach the grid from their normal workspace — the Vision names "week's end"
as when they lean on this hardest, so the link should be easy to find
without cluttering the timer/project-list flow they use continuously
through the day.

**Contract**: One new link element within the existing card layout,
styled with existing `Button` variants (`src/components/ui/button.tsx`) —
no new component needed for this piece.

#### 2. Kitchen-sink registration

**File**: `src/pages/dev/kitchen-sink.astro`

**Intent**: Register the grid's distinct states for manual, screenshot-
verified review, following the existing `cardStates`-array convention
(`kitchen-sink.astro:37-49`) and the pinned-clock pattern used to keep
screenshots stable.

**Contract**: Add states for: empty week, populated week (including a
multi-row Task/Type/Work Type variant and a still-running live entry),
and the week at the earliest-navigable boundary (previous-week link
absent).

### Success Criteria:

#### Automated Verification:

- `npm run build` and `npm run lint` pass with the new link and
  kitchen-sink states

#### Manual Verification:

- Screenshot each new kitchen-sink state in both light and dark theme
- Confirm the new workspace-page link correctly navigates to
  `/w/[token]/grid`

---

## Testing Strategy

### Unit Tests:

- `src/lib/weekly-grid.test.ts` — rounding order, midnight split, live
  entry, row grouping/omission (Phase 1)
- `src/lib/weekly-grid-query.test.ts` — retention-window boundary
  computation (Phase 2)

### Manual Testing Steps:

1. Seed a link with entries spanning at least 3 weeks, including one
   midnight-spanning segment, one currently-open entry, and one project
   edited mid-week (different `task`/`type`/`work_type` on later entries).
2. Load `/w/[token]/grid`, verify the current week's rows/totals and the
   live entry's contribution.
3. Navigate to the two prior weeks, verify correct data and that
   navigation stops at the retention boundary.
4. Verify light and dark theme rendering, and the empty-week state for a
   week with no logged time.

## Migration Notes

Not applicable — no schema changes; this plan reads existing
`time_entries`/`projects` columns only.

## References

- Roadmap: `context/foundation/roadmap.md` S-06
- PRD: `context/foundation/prd.md` FR-006, FR-001
- Rounding-rule decision: `context/archive/2026-09-23-timer-switch-rounding/plan.md`
- Denormalization design: `context/archive/2026-09-22-first-timer-start/plan.md`
- Existing tokenized-route auth pattern: `src/pages/w/[token].astro:17-52`
- Existing pure-function/test-file convention: `src/lib/timer-flag.ts`,
  `src/lib/workspace-headings.ts`
- Design tokens: `context/archive/2026-09-24-workspace-ui-tokens/tokens.md`,
  `src/styles/global.css`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Aggregation & rounding core logic

#### Automated

- [x] 1.1 `npx vitest run src/lib/weekly-grid.test.ts` passes, covering every case listed above — b7c9199

#### Manual

- [x] 1.2 Hand-trace one midnight-spanning example against the function's output and confirm the split minutes match hand calculation — b7c9199

### Phase 2: Weekly-grid data access

#### Automated

- [x] 2.1 `npx vitest run src/lib/weekly-grid-query.test.ts` passes for earliestNavigableWeekStart — ad89fe3
- [x] 2.2 `npm run build` passes (typecheck covers fetchWeekEntries's Supabase query shape) — ad89fe3

#### Manual

- [x] 2.3 Using Supabase Studio or a scratch script against hand-seeded data, confirm fetchWeekEntries returns exactly the expected rows — ad89fe3

### Phase 3: Grid page, route, and UI

#### Automated

- [x] 3.1 `npm run build` passes (typecheck + Astro build for the new page)
- [x] 3.2 `npm run lint` passes for the new file

#### Manual

- [x] 3.3 Load /w/[token]/grid for a link with seeded multi-week data and verify headers/rows, navigation, boundary behavior, live entry, midnight split, mid-week project edit, and empty-week state — 0bebd4d
- [x] 3.4 Verify in both light and dark theme — 0bebd4d (structural check: markup uses only design-system tokens, same as the rest of the app; no live dark-mode toggle exists yet to screenshot against)

### Phase 4: Wiring, kitchen-sink registration, and visual QA

#### Automated

- [x] 4.1 `npm run build` and `npm run lint` pass with the new link and kitchen-sink states — f1ebc14

#### Manual

- [ ] 4.2 Screenshot each new kitchen-sink state in both light and dark theme — blocked: no browser/screenshot tool available in this session. Verified structurally instead (dev server + curl): all three new states (`empty week`, `populated week (multi-row + live entry)`, `earliest navigable week (no Previous link)`) render with correct rows/labels/nav in `/dev/kitchen-sink`'s HTML, and every token the new markup uses (`--card`, `--card-foreground`, `--muted-foreground`, `--border`, `--heading`) is already defined in both the `:root` and `.dark` layers of `src/styles/global.css` (no new token introduced). Note: this app's `.dark` layer is itself documented as inactive and never visually verified project-wide (`context/archive/2026-09-24-workspace-ui-tokens/tokens.md`: "the `.dark` layer ... is applied nowhere"), so an actual dark-theme screenshot isn't obtainable by toggling anything in the running app today. Needs the user's own visual confirmation (light theme at minimum) to close this row.
- [x] 4.3 Confirm the new workspace-page link correctly navigates to /w/[token]/grid — f1ebc14. Verified end-to-end against the running dev server and local Supabase: created a real link via POST /api/links, loaded /w/<token>, confirmed the rendered "View weekly grid" link's href is exactly /w/<token>/grid (matching the current link's own token), then fetched that exact URL and got a 200 with the grid page's expected content.
