<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Correct logged time at end of day or start of next day Implementation Plan

- **Plan**: context/changes/time-corrections/plan.md
- **Mode**: Deep (done inline by the reviewing agent, no sub-agent; verified against the code in the time-corrections worktree)
- **Date**: 2026-10-05
- **Verdict**: REVISE
- **Findings**: 1 critical, 4 warnings, 5 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | FAIL    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

Grounding: 14/14 paths ✓ (existing files the plan names; the new files correctly do not exist; pgTAP link ids `d0000000-…01`/`…02` are free, `a…01-07`, `b…01-09`, `c…01-05` and `c…a1` are the ones taken), 9/9 symbols ✓ (`Math.ceil(rawMs / …)` in `weekly-grid.ts:30`, `endMs <= startMs` skip at `:59`, lock key `public.timer:` in `stop_timer`, `P0001` mapping in `timer.ts`, `ERROR_*`/`STATUS_*` maps, `LogContext` without `entryId`, `seedPerson`/`seedProject`/`cleanupSeeded` with no time-entry helper, `ALL` 405 handler, WorkspaceCard warning at `:115-122`), brief↔plan ✓, Progress↔Phase ✓ (every success-criteria bullet has exactly one row: 3+6+6+7+9, Phase 4's four manual bullets are 4.4-4.7, no checkboxes inside phase blocks). Lane 5 goal ✓: the plan states how corrections stay distinct from live tracking and how they leave the per-day rounding untouched, and ends in lint, astro check, build, pgTAP and smoke. No claim about existing code was found to be false.

## Findings

### F1 — Every save truncates both times to the minute, so editing any entry that follows a switch is refused as an overlap

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 3 (correct route, `utc-datetime.ts`), Phase 4 (Corrections page form), Phase 5 (e2e seed)
- **Detail**: The form always submits both fields, prefilled by `formatUtcDateTimeLocal`, which returns `YYYY-MM-DDTHH:mm` with `step="60"`, so seconds and milliseconds of the stored timestamps are dropped on every save, including the field the person did not touch. `switch_timer` closes the old entry and opens the new one at the same `now()` (touching boundary with sub-second precision), and a stop followed by a start is the same shape. Editing only the end of the later entry resubmits its start truncated down to the minute, which is earlier than the previous entry's end, so `correct_time_entry` answers `overlap` for an edit that changed nothing about the start. A short entry (start 10:00:10, end 10:00:40) collapses to `start = end` and gets `bad_range` on any save. Even when accepted, the raw time silently changes and can move a cell across a 15-minute rounding boundary. The plan's tests (pgTAP, integration, e2e) all seed whole-minute timestamps, so none would go red.
- **Fix**: Make an unchanged field keep its stored instant. For example, put the original full-precision ISO values in hidden inputs and have the correct route use the original instant for any field whose submitted minute equals the original's minute (the function validates both values exactly as before, so a forged hidden value gains nothing). Seed the integration and e2e entries with non-zero seconds and a touching neighbour, and add a unit test for the keep-original rule.
  - Strength: Keeps `datetime-local` UI and step=60; no schema change; fixes both the spurious refusal and the silent change.
  - Tradeoff: Two more form fields and one rule in the route and its tests.
  - Confidence: HIGH — follows directly from `switch_timer` closing and opening at one `now()` and the plan's own overlap predicate (touching allowed only when exactly equal).
  - Blind spot: Not run in a browser; Safari and Firefox `datetime-local` formatting was not checked.
- **Decision**: PENDING

### F2 — `correct_time_entry` accepts NULL times; a NULL end would turn a closed entry back into a running one

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — migration contract and pgTAP cases
- **Detail**: The plan calls the function "the only guard" and says it refuses anything that would leave bad data, but every check is a comparison, and a comparison with NULL is not true. With `p_ended_at = null` none of `bad_range`, `in_future`, `overlap` fires and the update sets `ended_at = null`: a closed entry becomes a running timer (or fails on the one-open-entry unique index with a `23505` that maps to the generic error). `p_started_at = null` fails on the NOT NULL column as a generic error. The route parses and rejects nulls today, but the function is callable by any future caller and the pgTAP file would not notice.
- **Fix**: Raise `bad_range` first when either argument is null, and add a pgTAP case for each.
- **Decision**: PENDING

### F3 — A forgotten timer older than yesterday cannot be corrected, and a running entry older than the window is not shown

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Overview, Desired End State, Phase 1 (`outside_window` on the row's start), Phase 2 (`listCorrectableEntries`), Phase 4 (warning sentence)
- **Detail**: The window is judged on the row's `started_at`, and the list filters on the same value. The plan's stated workflow is "a forgotten timer is stopped normally and then shortened on the Corrections page", and the 12-hour warning will promise "you can shorten it afterwards". A timer left from Friday afternoon and stopped on Monday started three days ago, so it is refused with `outside_window` and the warning's promise is false. A still-running entry that started before yesterday is also absent from the list, so the page would not show the read-only "Running since" row at all, and the person gets no explanation. The 12-hour long-running flag can only be reached by a timer that is already at least half a day old, so this is the case the warning exists for.
- **Fix**: Decide the rule explicitly in the plan. Recommended: keep the window as is (it protects the 3-month purge and the "not a substitute for live tracking" boundary), fetch the running entry separately with `getCurrentTimer` so it is always shown read-only, and reword the warning so it does not promise a correction ("an entry from today or yesterday can be shortened afterwards under Corrections"). The alternative, anchoring the window on `ended_at`, lets a long entry be shortened but widens the window and needs its own purge check, so it is not recommended.
- **Decision**: PENDING

### F4 — The SQL window expression is not specified, and the SQL and TypeScript windows can disagree

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 contract ("yesterday 00:00 UTC computed from `now()`"), Phase 2 `correctionWindowStart`, brief risk list
- **Detail**: `date_trunc('day', now())` truncates in the session time zone, and `purge_time_entries` already carries a comment that its month arithmetic relies on "Supabase sessions default to UTC". If the session zone is not UTC, the database window and the TypeScript window differ by hours, not only at midnight, and the list would show entries the function refuses (or the reverse). The tests are written relative to the window start computed by the same expression, so they cannot detect this. The midnight race the brief mentions (page loaded at 23:59, submitted at 00:00:10, the database then refuses with the "today and yesterday" message) is acceptable, but the plan should say the message is the intended outcome and that the list/refusal boundary is `>=` / `<` on the same value.
- **Fix**: Give the exact expression in the contract, for example `(date_trunc('day', now() at time zone 'utc') - interval '1 day') at time zone 'utc'`, and add a pgTAP case that runs `set local timezone to 'Asia/Tokyo'` (or similar) and still gets the same refusals, plus a case with an entry starting exactly at the window start (allowed) and one microsecond before (refused).
- **Decision**: PENDING

### F5 — The "fixed validation order" is never pinned by a test, and two of the deliberate breaks leave most rules unguarded

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 pgTAP cases and deliberate break; Critical Implementation Details ("so tests can rely on which refusal wins")
- **Detail**: The plan says the order is fixed so tests can rely on it, but every listed pgTAP case triggers exactly one refusal, so reordering the checks stays green. Combined cases are missing: a running entry that also started before the window (`entry_running` must win), an end before the start that is also in the future (`bad_range` wins), a new start before the window with end before start (`bad_range` wins), a foreign running entry (`entry_not_found` must win, so existence is not leaked). The row-level and the new-start `outside_window` checks use the same code but sit at different positions, which a reader can mistake for a duplicate. The deliberate-break checks cover only `overlap` and the `link_id` condition, and the `link_id` break should be applied to both functions (the delete lookup has its own). No break exercises the window, `in_future` or `entry_running` rules.
- **Fix**: Add the combined cases above, name the two `outside_window` checks in the contract ("current row start" and "new start"), apply the `link_id` break to both functions, and add one break that drops the window check.
- **Decision**: PENDING

### F6 — Lint, type and astro checks are scheduled against the lessons and late for `.astro` files

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phases 2, 3, 4 (`npx eslint <files>` rows 2.5, 3.4, 4.1); Phase 5 (`npm run lint`, `astro check`)
- **Detail**: `lessons.md` says to run lint once, in the last code phase, because a cold type-aware run took 13 to 15 minutes in this repo; the plan runs `npx eslint` on changed files in three phases (with `projectService`, each is a type-aware program build) and the full lint again in Phase 5. `npx tsc --noEmit` does not check `.astro` files, so type errors in the two new pages and the card change first appear in Phase 5's `astro check`, after the manual browser check.
- **Fix**: Drop the per-phase eslint rows (or keep only the Phase 2 one for the new library file) and add `npx astro check` to Phase 4's automated rows.
- **Decision**: PENDING

### F7 — The e2e spec is date-fragile and covers few of the refusals

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 e2e contract
- **Detail**: "two closed entries from today" cannot be placed before `now()` in the first minutes after 00:00 UTC, and an edit whose end moves later may hit `in_future`. The spec covers the overlap refusal but not the foreign-entry 404, the future end, the end-before-start banner or the read-only running row; those are covered only by the manual rows 4.5 and 4.6 (which per `lessons.md` should be recorded as user-confirmed in the phase commit body, a step the plan does not mention).
- **Fix**: Seed relative to `now()` (for example now minus 3 h to minus 2 h and minus 2 h to minus 1 h, which stay inside the window at any time of day), with non-zero seconds (see F1), add a 404 case for the bystander's entry id, and note in Phase 4 that rows 4.4 to 4.7 are recorded in the commit body.
- **Decision**: PENDING

### F8 — Migration and deploy ordering note relies on an unverifiable claim, and the rollback note is inverted

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Implementation Approach (last sentence) and Migration Notes
- **Detail**: "The app deploy is automatic on merge to `main` and the database push is manual" is not visible in the repository: `.github/workflows/ci.yml` has no deploy job and no `supabase db push` (the README only documents `npx supabase db push`). If the deploy is a Cloudflare git integration, the claim may be true but it should be stated as an assumption with the owner confirming. The ordering itself (push first) is right, and the failure before the push is benign (PostgREST has no such function, which `dbError` maps to the generic banner, though the new workspace card link is already visible). The rollback advice, "drop the two functions", is backwards: with the app code still deployed, the routes would call missing functions; roll the app back first, then drop. After `db push`, a call right away can also fail until the PostgREST schema cache reloads.
- **Fix**: Add a merge checklist line: run `npx supabase db push` against the linked project and confirm both functions exist before merging; reword rollback to "revert the app first, then drop the functions"; mark the auto-deploy statement as an assumption to confirm.
- **Decision**: PENDING

### F9 — Wrapper result parsing is unspecified

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — `correctEntry` / `deleteEntry` contract
- **Detail**: `correct_time_entry` returns a table (an array of one row over RPC) and `delete_time_entry` returns a scalar uuid (a plain string). The plan says what the wrappers return but not that they validate the shape and throw on an unexpected one, as `timer.ts` `parseTimerRow` and `weekly-grid-query.ts` do, and the unit tests do not list a malformed-result case. Also, because `correct_time_entry`'s output columns `started_at`/`ended_at` share names with the table columns, any unaliased reference in the body (including the overlap subquery) is ambiguous; the plan mentions aliasing, and the first pgTAP run would show it, so this is only a reminder.
- **Fix**: State the validation in the contract and add a malformed-result unit case per wrapper.
- **Decision**: PENDING

### F10 — A correction can create a very long entry and can be blocked by legacy overlaps

- **Severity**: 👁 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Desired End State ("a correction can never create…"); Phase 1 contract
- **Detail**: The rules allow a start at yesterday 00:00 and an end at now, a single entry of up to 48 hours, with no warning, although the app flags a running timer at 12 hours. An already overlapping pair (not creatable through the app today, but nothing in the database forbids it) would make every edit of either entry refuse with `overlap`, even a shortening. Neither is a bug against the stated rules; both are unstated.
- **Fix**: State both as accepted, or add a maximum duration check (new code and message) if a long single entry is considered bad data.
- **Decision**: PENDING

## Answers to the review focus points

- (a) Validation order: the order itself is sound and deterministic (existence and ownership first, so a foreign id never leaks a state); gaps are F2 (NULL) and F5 (not pinned by tests, two checks share one code).
- (b) Bad data or another person's entry: ownership is safe (lookup by id and link inside the lock, `entry_not_found` for both unknown and foreign). Remaining ways to bad data: NULL end (F2), truncation changing untouched fields (F1), unbounded duration (F10).
- (c) SQL versus TypeScript window: boundary operators agree (`>=` in the list, `<` refused in the function), but the SQL expression is unspecified and session-timezone dependent (F4), and a running entry older than the window is not listed (F3).
- (d) False assumptions about existing code: none found. All named files, line ranges, helper names, the lock key, the `P0001` mapping, the rounding at `weekly-grid.ts:30`, the free pgTAP ids and the missing `seedTimeEntry` helper match the worktree (`cleanupSeeded` already deletes `time_entries` before `projects`, so the "extend it if it does not already" clause is a no-op).
- (e) Tests that would not go red: the seconds issue (F1), validation order (F5), the window and timezone (F4, F5), NULL arguments (F2).
- (f) Deploy ordering: F8.
