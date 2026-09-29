# Testing weekly grid rounding & aggregation Implementation Plan

## Overview

Close the gaps in test protection for risk #5 ("the weekly grid shows wrong per-day rounded totals or the wrong Mon–Sun boundary", `context/foundation/test-plan.md` §2) — test-plan §3 Phase 2. The grid (S-06) is already built with 12 passing unit tests, so this is a gap-filling phase: one likely rounding bug driven test-first, a set of oracle-derived boundary and edge unit cases, and one integration test for the previously untested `fetchWeekEntries` overlap query.

## Current State Analysis

- `buildWeeklyGrid` (`src/lib/weekly-grid.ts:39-97`) groups by the (Project, Task, Type, Work Type) tuple, splits segments at UTC day bounds, sums raw minutes per (row, day) and rounds each cell once, up, to 15 minutes. It has 7 unit tests (`src/lib/weekly-grid.test.ts`) and `earliestNavigableWeekStart` has 5 (`src/lib/weekly-grid-retention.test.ts`); all 12 pass.
- Raw minutes are accumulated as floating point (`weekly-grid.ts:64-70`). In JS, 45 × 20 s (= exactly 15 min) sums to `15.000000000000009`, which `Math.ceil` turns into 30 instead of 15 (research Summary #4; reproduced with plain arithmetic, not yet through `buildWeeklyGrid`).
- `fetchWeekEntries` (`src/lib/weekly-grid-query.ts:20-33`) has no test. It imports `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` from `astro:env/server` (`src/lib/supabase-admin.ts:2`), which plain vitest cannot resolve. `vitest.config.ts` includes every `src/**/*.test.{ts,tsx}` and has no DB tests today.
- Helpers in `src/pages/w/[token]/grid.astro:41-119` are untested and stay that way (decided below).

### Key Discoveries:

- Oracle for rounding: per day, per row, always up to the next 15 min (`context/foundation/roadmap.md:119`). The PRD says "nearest" (`prd.md:98`); the user chose the roadmap rule as the oracle.
- The UTC Mon–Sun boundary is a plan decision (`context/changes/weekly-grid-summary/plan-brief.md`, Key Decisions); the roadmap still lists the timezone as open (`roadmap.md:157`).
- `time_entries` requires a real `project_id` (FK to `projects`) and `link_id` (FK to `links`) (`supabase/migrations/20260922150000_projects_and_timer.sql:41-52`); at most one open entry per link (`:56-58`), so open-entry cases each need their own link.
- pgTAP is not the right layer for the overlap query: the filter is a PostgREST builder call, so a pgTAP test would only exercise a copy of the predicate (mirror-implementation anti-pattern).

## Desired End State

Every rounding and boundary rule that the roadmap and the UTC decision state is pinned by a test whose expected values are written out from the rule, not from the code. Breaking `buildWeeklyGrid`'s rounding, splitting, or grouping, or breaking the `fetchWeekEntries` overlap filter, turns a test red. The float-sum bug is fixed. `test-plan.md` §6 documents the pattern and §3 Phase 2 is marked complete.

## What We're NOT Doing

- Not changing the rounding rule to "nearest" (oracle is always-up). The PRD wording at `prd.md:98` is left as is and flagged in the cookbook.
- Not deciding the timezone question. UTC boundary tests are labeled as documenting the current decision.
- Not extracting or testing the helpers inside `grid.astro` (`utcMondayOf`, `parseViewedWeekStart`, `toWeekParam`, `formatMinutes`); recorded as a known gap.
- Not adding pgTAP tests for the overlap query, and not adding a Stryker config or CI gate (ad hoc use only).
- Not covering e2e / real-browser rendering of the grid (test-plan §3 Phase 4) or the retention purge job (already covered by `purge_time_entries.test.sql`).

## Implementation Approach

Cheapest test with real signal per gap. Pure logic → vitest unit tests. The one SQL-backed rule → an integration test that calls the real `fetchWeekEntries` against the local Supabase stack, gated so the default `npm test` still needs no database. Phase 1 uses `/10x-tdd` (its first red test is nameable in one sentence); Phase 2 uses `/10x-implement` because most cases will pass immediately against current code and only prove protection through a deliberate-break check; Phases 3–4 use `/10x-implement` (environment/scaffolding and docs).

## Phase 1: Float-sum rounding bug (test-first)

### Overview

First failing test: "exactly 15 minutes made of many fractional-minute segments rounds to 15, not 30". Then a minimal fix.

### Changes Required:

#### 1. Regression test

**File**: `src/lib/weekly-grid.test.ts`

**Intent**: Add a parameterized (`it.each`) case: N contiguous segments of equal length on one day, total exactly 15 minutes, expected daily minutes `15`. Cases: 45 × 20 s, 90 × 10 s, 30 × 30 s (the last is a control that already passes).

**Contract**: Uses the existing `entry()` helper and `WEEK_START`/`NOW` constants; expected value `[15, 0, 0, 0, 0, 0, 0]` is from the roadmap rule, not from running the code. Must be observed red before the fix. (Observed: only the 45 x 20 s case is red; 90 x 10 s sums to just under 15 in floats and passes as a control.)

#### 2. Minimal fix

**File**: `src/lib/weekly-grid.ts`

**Intent**: Stop accumulating fractional minutes as floats so exact quarter-hour totals cannot be nudged over the boundary by rounding error.

**Contract**: `buildWeeklyGrid`'s signature and output shape (`GridRow[]`, `dailyMinutes` in whole minutes, multiples of 15) do not change. Internally, per-(row, day) totals are accumulated in integer milliseconds and rounded once with integer math (ms → next 15-minute multiple → minutes).

### Success Criteria:

#### Automated Verification:

- The new cases fail before the fix and pass after: `npx vitest run src/lib/weekly-grid.test.ts`
- All 12 existing tests still pass: `npx vitest run src/lib/weekly-grid.test.ts src/lib/weekly-grid-retention.test.ts`

#### Manual Verification:

- Read the two failing assertion messages captured before the fix and confirm they show 30 vs expected 15 (proves the test can fail for the right reason).

---

## Phase 2: Boundary and edge unit cases

### Overview

Add the oracle-derived gaps G1 and G3–G9 from the research to `weekly-grid.test.ts`. Most pass immediately; protection is proven by breaking production code and seeing red.

### Changes Required:

#### 1. Rounding boundaries (G1)

**File**: `src/lib/weekly-grid.test.ts`

**Intent**: One `it.each` over (duration → expected minutes): 15 min → 15, 60 min → 60, 15 min 1 s → 30, 1 s → 15.

**Contract**: Expected values from the always-round-up rule (`roadmap.md:119`); 0 stays 0 (row omitted, already covered).

#### 2. Day and week boundaries, documenting UTC (G3, G4, G5, G6)

**File**: `src/lib/weekly-grid.test.ts`

**Intent**: In a `describe` whose title and comments say "documents the current UTC day/week boundary decision, not a proven product rule", add: (a) Sun 2026-09-27 23:50 → Mon 09-28 00:10 with week starting 09-21 credits only Sunday (`[0,0,0,0,0,0,15]`), and with week starting 09-28 credits only Monday (`[15,0,0,0,0,0,0]`); (b) a segment ending exactly at Tue 00:00 puts nothing on Tuesday; (c) a segment ending exactly at the week start yields no rows; (d) a stale segment Mon 22:00 → Thu 01:10 yields `[120, 1440, 1440, 75, 0,0,0]`; (e) an open entry from Mon 23:50 with `nowUtc` Tue 00:10 yields `[15, 15, …]`, and `nowUtc` before `startedAt` yields no rows.

**Contract**: Literal expected arrays derived by hand from the UTC bounds and the round-up rule; no `Date` local getters in test setup.

#### 3. Grouping and per-row rounding (G7, G8, G9)

**File**: `src/lib/weekly-grid.test.ts`

**Intent**: (a) `task: null` and `task: ""` produce two distinct rows; (b) identical tuples merge across non-adjacent segments even with another row between them (10 + 10 min on one day → one row, 30); (c) two different rows each with 10 min on the same day show 15 each (rounding is per row and day, not shared); (d) zero-length and negative-length entries add nothing.

**Contract**: (a)/(c) may be parameterized with `it.each` if they share a property; each test must detect a distinct regression.

#### 3b. Deliberate-break check

**Intent**: For each new group, temporarily break the matching production line in a worktree-only edit (never staged): round per segment, drop the day split, key rows by project name only, share rounding across rows, use `>=` for the skip guard. Confirm the group goes red, then restore.

**Contract**: Follows the deliberate-break pattern in `test-plan.md` §6.2; nothing in production code is left changed by this step.

### Success Criteria:

#### Automated Verification:

- All unit tests pass: `npx vitest run src/lib/weekly-grid.test.ts src/lib/weekly-grid-retention.test.ts`
- Default suite still passes with no database: `npx vitest run`

#### Manual Verification:

- Each new test group was seen red under its deliberate break and green after restoring (recorded in the commit body).
- Read the new test names and confirm the UTC-boundary group is worded as "current decision", not "correct".

---

## Phase 3: Integration test for `fetchWeekEntries`

### Overview

A gated integration test that runs the real `fetchWeekEntries` against the local Supabase stack, so a regression in the overlap filter is caught (a mock or pgTAP copy would not catch it).

### Changes Required:

#### 1. Integration test harness

**File**: `vitest.config.ts`, new `vitest.integration.config.ts`, new stub for `astro:env/server`, `package.json`

**Intent**: Keep the default `npm test` database-free while allowing one opt-in integration run.

**Contract**: Default config excludes `src/**/*.integration.test.ts`. A separate config includes only those files and aliases `astro:env/server` to a small stub exporting `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `process.env`. New script `test:integration` runs it. Tests skip (not fail) with a clear message when either env var is missing.

#### 2. Overlap-query test

**File**: new `src/lib/weekly-grid-query.integration.test.ts`

**Intent**: Seed one `links` row and the required `projects` row per case, insert `time_entries` rows, call `fetchWeekEntries(linkId, weekStart)` and assert which entries come back. Clean up seeded rows afterward.

**Contract**: Expected results from the plan-brief rule "entries overlapping the UTC week are returned": returned — entry fully inside the week; entry starting Sunday of the previous week and ending inside the viewed week; entry starting inside and ending after the week end; open entry (`ended_at null`) started inside the week. Not returned — entry ending exactly at week start; entry starting exactly at week end; another link's entry inside the week (scoping). Rows come back ordered by `started_at`. One link per open-entry case (unique open-entry index). Deliberate-break: change `.lt`/`.gt` or drop the `.or` clause in `weekly-grid-query.ts` in a worktree-only edit and confirm red, then restore.

### Success Criteria:

#### Automated Verification:

- Default suite passes with no database and no env vars: `npx vitest run`
- Integration suite passes against local Supabase: `npm run test:integration` (env from `supabase status -o env`, with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set)
- Integration suite skips with a clear message when env vars are absent: `npm run test:integration` with the vars unset
- Lint passes (run once, in the last code phase): `npm run lint`

#### Manual Verification:

- Deliberate-break of the overlap filter turns the integration suite red, and restoring turns it green.
- Confirm `supabase status` shows this worktree's stack before running (per lessons.md on shared local stacks) and that no seeded rows remain afterward.

---

## Phase 4: Cookbook and rollout-status sync

### Overview

Record the patterns and the state so later phases reuse them.

### Changes Required:

#### 1. Test-plan cookbook and status

**File**: `context/foundation/test-plan.md`

**Intent**: Fill §6.4 (and §6.1 for the unit pattern) with: the oracle-first rounding case shape, the `it.each` boundary pattern, the "documents current UTC decision" framing, and the gated integration harness (how to run it, why not pgTAP for PostgREST filters). Update §3 row 2 goal text (grid is built) and status to `complete` once phases 1–3 are done; note the PRD "nearest" vs roadmap "up" wording gap and the untested `grid.astro` helpers as known gaps; mark the integration gate ad hoc in §4.

**Contract**: Edits only §3 row 2, §4 (gate wording for integration), and §6; no change to §1–§2 risk strategy.

#### 2. Selective mutation check

**Intent**: Run Stryker once, ad hoc, scoped to `src/lib/weekly-grid.ts`, review surviving mutants, and add assertions only for those that would harm a user; ignore cosmetic ones.

**Contract**: No committed Stryker config or CI gate; result summarized in the phase commit body. (Observed: Stryker 10.0.0 + vitest-runner reported 0/64 killed on vitest 5.0.1, an invalid result; recorded in test-plan §6.4 instead of triaging.)

### Success Criteria:

#### Automated Verification:

- Whole unit suite still passes: `npx vitest run`

#### Manual Verification:

- `test-plan.md` §3 row 2 shows `complete` with the change folder, and §6 has the new cookbook entries.
- Surviving Stryker mutants on `weekly-grid.ts` were each triaged (killed with a new assertion, or ignored as equivalent/cosmetic).

---

## Testing Strategy

### Unit Tests:

- Rounding boundaries and the float-sum regression; per-row/day rounding; UTC day and week splitting; grouping identity; invalid input.

### Integration Tests:

- `fetchWeekEntries` overlap and scoping against the local Supabase stack, opt-in via `npm run test:integration`.

### Manual Testing Steps:

1. Deliberate-break each new group and confirm red, then restore.
2. Run the integration suite against the local stack and against no env.

## Performance Considerations

None: pure in-memory aggregation over at most one week of one person's entries.

## Migration Notes

None: no schema or data changes.

## References

- Related research: `context/changes/testing-weekly-grid-rounding-aggregation/research.md`
- Rounding oracle: `context/foundation/roadmap.md:119`
- Pure core and tests: `src/lib/weekly-grid.ts`, `src/lib/weekly-grid.test.ts`
- Query under test: `src/lib/weekly-grid-query.ts:20-33`
- Deliberate-break pattern: `context/foundation/test-plan.md` §6.2

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Float-sum rounding bug (test-first)

#### Automated

- [x] 1.1 The new exact-15-minute cases fail before the fix and pass after: `npx vitest run src/lib/weekly-grid.test.ts` — b09a520
- [x] 1.2 All 12 existing tests still pass: `npx vitest run src/lib/weekly-grid.test.ts src/lib/weekly-grid-retention.test.ts` — b09a520

#### Manual

- [x] 1.3 The captured failing assertion messages show 30 vs expected 15 — b09a520

### Phase 2: Boundary and edge unit cases

#### Automated

- [x] 2.1 All unit tests pass: `npx vitest run src/lib/weekly-grid.test.ts src/lib/weekly-grid-retention.test.ts` — 5ffecac
- [x] 2.2 Default suite still passes with no database: `npx vitest run` — 5ffecac

#### Manual

- [x] 2.3 Each new test group was seen red under its deliberate break and green after restoring — 5ffecac
- [x] 2.4 The UTC-boundary group is worded as "current decision", not "correct" — 5ffecac

### Phase 3: Integration test for `fetchWeekEntries`

#### Automated

- [x] 3.1 Default suite passes with no database and no env vars: `npx vitest run` — 388fd84
- [x] 3.2 Integration suite passes against local Supabase: `npm run test:integration` — 388fd84
- [x] 3.3 Integration suite skips with a clear message when env vars are absent — 388fd84
- [x] 3.4 Lint passes: `npm run lint` — 388fd84

#### Manual

- [x] 3.5 Deliberate-break of the overlap filter turns the integration suite red, and restoring turns it green — 388fd84
- [x] 3.6 `supabase status` confirmed for this worktree and no seeded rows remain afterward — 388fd84

### Phase 4: Cookbook and rollout-status sync

#### Automated

- [x] 4.1 Whole unit suite still passes: `npx vitest run` — ffb7864

#### Manual

- [x] 4.2 `test-plan.md` §3 row 2 shows `complete` and §6 has the new cookbook entries — ffb7864
- [x] 4.3 Surviving Stryker mutants on `weekly-grid.ts` were each triaged — ffb7864
