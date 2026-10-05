# Correct logged time at end of day or start of next day Implementation Plan

## Overview

S-05 (FR-005) gives a person a safety net for time they tracked wrongly: on a new Corrections page they can change the start or end time of a closed entry from today or yesterday, or delete such an entry. Nothing can be edited or deleted today, and no screen shows individual entries. A correction is one locked database function that edits the raw timestamps and refuses anything that would leave bad data (an unknown or foreign entry, the running entry, an entry outside today and yesterday, a future end, an end at or before the start, an overlap with another entry or the running timer). Because the app never stores rounded time, the weekly grid's read-time round-up (per project row and per UTC day, raw time summed first and rounded up once) stays correct with no change.

**How corrections stay distinct from live tracking (the roadmap risk):** they only reach today and yesterday (UTC), they only touch closed entries (the running timer is untouched), nothing can be added from scratch, and the page sits beside the weekly grid, not on the timer. A day that was never tracked cannot be rebuilt here. **How they interact with the per-day 15-minute rounding:** they do not. Corrections change raw `started_at` and `ended_at`; the grid still splits entries at UTC midnight, sums raw milliseconds per cell and rounds each cell up once, so a corrected entry rounds exactly as a live one would, and the rounding tests stay unchanged.

## Current State Analysis

The research (`context/changes/time-corrections/research.md`, 2026-10-05) answered what exists; this plan does not re-investigate it. Spot-checked against the code on 2026-10-05: no rounding or interval in the three timer migrations, no check or exclusion constraint on `time_entries`, and `Math.ceil(rawMs / 900000) * 15` as the only rounding (`src/lib/weekly-grid.ts:30`).

- `time_entries` (`supabase/migrations/20260922150000_projects_and_timer.sql:41-59`): `id`, `link_id` FK, `started_at`, `ended_at` (null while running), a snapshot of the project's `project_id`, `project_name`, `task`, `type`, `work_type`, and a partial unique index allowing one open entry per link. Its only writers of `ended_at` are `switch_timer` and `stop_timer`, both at `now()`; its only deleters are `purge_time_entries` (closed entries with `started_at` older than 3 months) and `delete_account`. RLS is on with no policies, so all access is the service role and link scoping is application-enforced.
- The pattern for multi-row writes is a `security definer` plpgsql function with `set search_path = public`, a per-link advisory lock `pg_advisory_xact_lock(hashtext('public.timer:' || p_link_id::text))`, `raise exception '…' using errcode = 'P0001'` for a missing precondition, and `revoke … from public, anon, authenticated; grant … to service_role` (`20260927120000_stop_timer.sql`). The latest migration timestamp is `20260928130000`; existing migrations are never edited.
- TypeScript wrappers (`src/lib/timer.ts`) call `admin.rpc(...)`, map `P0001` to a typed error and everything else through `dbError(op, error)`; list-style reads validate rows and throw on an unexpected shape (`src/lib/weekly-grid-query.ts`).
- Routes under `src/pages/api/w/[token]/…` check the token shape (rewrite to `/404`), look the link up (503 and `link_lookup_failed` on failure, rewrite to `/404` on null), act scoped by the looked-up `link_id` (never an id from the URL), log, redirect 303 with a `?status=` or `?error=` code, and export an `ALL` handler returning 405 (`timer/stop.ts`, `projects/[projectId]/delete.ts`). Pages set `Referrer-Policy: strict-origin`, `Cache-Control: no-store` and `X-Robots-Tag: noindex`, show a "Temporarily unavailable" 503 view on read failure and log (`grid.astro`, `projects/[projectId]/delete.astro`).
- The workspace card (`src/components/WorkspaceCard.astro:109-258`) shows only the running timer, a project list, a Weekly summary link, the private link and the Regenerate/Delete-all actions; its 12-hour warning (`:115-122`) has no destination for correcting time. The weekly grid query selects no entry id (`weekly-grid-query.ts:111-123`).
- Banner text lives in `src/lib/status-messages.ts` (`ERROR_*` and `STATUS_*` constants and two maps; unknown error codes show a generic message, unknown status codes show nothing). `LogContext` has `route`, `linkId`, `projectId`, `op`, `detail` and no `entryId` (`src/lib/log.ts:5-13`).
- Tests: route tests are mocked and table-driven (`src/__tests__/timer-routes.test.ts`); pgTAP files use fixed link ids (`a000…01`–`07`, `b000…01`–`09`, `c000…01`–`05` and `c000…a1` are taken) in `supabase/tests/database/`; integration tests need the local stack and have helpers `seedPerson`, `seedProject`, `cleanupSeeded` but none for a time entry (`src/test/integration-db.ts`); e2e specs seed their own link (`tests/e2e/delete-account.spec.ts` is the model for a confirm-gated action).
- Lessons that apply (`context/foundation/lessons.md`): every new form uses `Referrer-Policy: strict-origin`, never `no-referrer`, and is submitted in a real browser; lint runs once in the last code phase; start `astro dev` with `ASTRO_DEV_BACKGROUND=1`; give each database-touching lane its own stack slot; record how each manual Progress row was verified.

## Desired End State

- Two new database functions, `correct_time_entry(p_link_id, p_entry_id, p_started_at, p_ended_at)` and `delete_time_entry(p_link_id, p_entry_id)`, both taking the `public.timer:` lock and refusing with a stable code in the error message: `entry_not_found`, `entry_running`, `outside_window`, `in_future`, `bad_range`, `overlap`.
- A Corrections page at `/w/[token]/corrections` lists the person's entries from today and yesterday (UTC days, newest first, grouped by day); each closed entry has a form to change its start and end (UTC, labelled) and a link to a confirm page that deletes it; the running entry is shown read-only. A link to it sits beside the Weekly summary on the workspace card, and the 12-hour warning points to it.
- An edit saves directly from its form with a banner; a delete goes through a confirm page, as project delete does; both are POST routes under `/api/w/[token]/entries/[entryId]/`.
- Every outcome writes one structured log line (success, refusal with its reason, failure) with the link id and entry id, never the token; `LogContext` gains `entryId`.
- A person can never read, change or delete another person's entry, and a correction can never create an overlap, a negative or empty range, an end in the future, or a start before yesterday's UTC midnight.
- The weekly grid, rounding, purge, project deletion and the timer functions are unchanged and their tests pass untouched.

### Key Discoveries:

- Raw timestamps are the source of truth and every display is derived at read time (`weekly-grid.ts:28-98`, `timer-flag.ts`): editing raw `started_at`/`ended_at` is the only correction that keeps the grid correct.
- The database is constraint-light on `time_entries` (research §3); the function is therefore the only guard, and it must take the same lock as start, switch and stop so a correction cannot race them.
- The grid skips an entry whose end is not after its start and sums overlaps (`weekly-grid.ts:59`), so unvalidated edits would silently drop or double-count hours.
- Edits that start before the 3-month cutoff would be purged at the next run; the "yesterday" window makes that unreachable (the window start is always within a day or two of now), so no separate retention check is needed.
- Deleting the last entry of a project makes that project deletable (FR-009 protects a project only while it has logged time); this is consistent with FR-009 and is accepted, not guarded.

## What We're NOT Doing

- No adding an entry from nothing, no changing an entry's project (so no snapshot re-copy), and no correcting the running timer, including "stop at an earlier time"; a forgotten timer is stopped normally and then shortened on the Corrections page.
- No `corrected_at` column or any other schema change to `time_entries`; no new CHECK or exclusion constraint on it.
- No local-time input and no client-side time conversion: times are typed as UTC and labelled.
- No change to `weekly-grid.ts`, `weekly-grid-query.ts`, rounding, the purge function, `delete_project`, `delete_account` or the timer functions.
- No window wider than today and yesterday (UTC), and no separate retention check (the window already keeps edits far inside the 3 months).
- No change to the long-running-timer rule (12 hours); the warning only gains a pointer to the Corrections page.
- No new `access_log` outcome and no `logAccess` call on the Corrections page (the grid page does not call it either).
- No edit confirmation page (edits save directly; only delete confirms).

## Implementation Approach

Five steps, bottom up, so every layer is proven before the next one builds on it. Phase 1 adds the two database functions in one migration with a pgTAP file that proves every refusal and ownership. Phase 2 adds the TypeScript data layer (window helper, list query, wrappers, typed errors, `entryId` in the log context) with unit tests and an opt-in two-person integration test that also checks a corrected entry rounds once in the grid. Phase 3 adds the two POST routes, their banner codes and their route tests. Phase 4 adds the Corrections page, the delete confirm page and the links on the workspace card, with a real-browser check. Phase 5 adds the e2e spec and runs the whole set of checks the lane's goal names (lint, astro check, build, pgTAP, smoke). The migration must be applied to the database before the app code that calls it is deployed.

## Critical Implementation Details

- **State sequencing:** the correction must run as one function under the per-link `public.timer:` lock so it serializes with start, switch and stop; the validation order inside the function is fixed (see Phase 1) so tests can rely on which refusal wins when several apply.
- **User experience spec:** both new pages set `Referrer-Policy: strict-origin` (never `no-referrer`), `Cache-Control: no-store` and `X-Robots-Tag: noindex`. Time fields are `datetime-local` inputs prefilled with the entry's UTC time and labelled "(UTC)"; the page states once that times are UTC. The running entry is shown read-only with a short note, never as an editable row. The final banner and page wording is confirmed by the human in the Phase 4 manual check.
- **Debug & observability:** log `link.id` and `entryId`, never the token or the raw form value. Expected refusals are `logWarn` with `op` set to the refusal code; failures are `logError`; successes are `logInfo`.

## Phase 1: Database functions and pgTAP

### Overview

Add `correct_time_entry` and `delete_time_entry` in one migration, and prove every refusal and the ownership rule in pgTAP.

### Changes Required:

#### 1. The migration

**File**: `supabase/migrations/20261005120000_time_entry_corrections.sql` (new)

**Intent**: Make editing and deleting a closed entry a single atomic, locked, validated operation, so the application cannot create an overlap, an empty range or an entry outside the window.

**Contract**: two `security definer` plpgsql functions with `set search_path = public`, following `stop_timer` (alias every table reference because the return columns share names; `revoke execute … from public, anon, authenticated; grant execute … to service_role` for both). Both take `pg_advisory_xact_lock(hashtext('public.timer:' || p_link_id::text))` first. The window start is yesterday 00:00 UTC computed from `now()`. `correct_time_entry(p_link_id uuid, p_entry_id uuid, p_started_at timestamptz, p_ended_at timestamptz)` returns `table (entry_id uuid, started_at timestamptz, ended_at timestamptz)` and refuses, in this order, each as `raise exception '<code>' using errcode = 'P0001'`: `entry_not_found` (no row with that id and that link), `entry_running` (the row has no `ended_at`), `outside_window` (the row's current `started_at` is before the window start), `bad_range` (`p_ended_at <= p_started_at`), `outside_window` (`p_started_at` before the window start), `in_future` (`p_ended_at > now()`), `overlap` (another row of the same link has `started_at < p_ended_at` and `coalesce(ended_at, 'infinity') > p_started_at`, so touching boundaries are allowed and the running entry counts); otherwise it updates only `started_at` and `ended_at` of that row and returns it. `delete_time_entry(p_link_id uuid, p_entry_id uuid)` returns `uuid` and refuses `entry_not_found`, `entry_running` and `outside_window` (same rules and order), otherwise deletes the row and returns its id. No constraint is added to `time_entries`, so the lessons.md precondition rule for destructive column changes does not apply.

#### 2. The pgTAP file

**File**: `supabase/tests/database/time_entry_corrections.test.sql` (new)

**Intent**: Pin every refusal, the success paths and the privilege rule against the real database.

**Contract**: follow the structure of `stop_timer.test.sql` (`begin;`, pgTAP extension, `select plan(N);`, `rollback`), with fixed link ids `d0000000-0000-0000-0000-000000000001` and `…02` (unused by any other file; verify with a grep before committing). Seed entries directly, with timestamps built relative to `now()` and to the window start so the file does not depend on the time of day. Cases: an edit that shortens the end succeeds, returns the row, changes only `started_at` and `ended_at` (the snapshot columns are untouched) and leaves other rows alone; an edit of the start succeeds; a touching boundary (new end equal to the next entry's start) is allowed; a foreign link id gets `entry_not_found` and the row is unchanged; a running entry gets `entry_running`; an entry that started before the window gets `outside_window`; a new start before the window gets `outside_window`; an end in the future gets `in_future`; an end at or before the start gets `bad_range`; an overlap with a closed neighbour gets `overlap`; an overlap with the running entry gets `overlap`; a delete removes a closed in-window entry and returns its id; a delete with a foreign link id gets `entry_not_found` and the row survives; a delete of a running or out-of-window entry is refused; `anon` and `authenticated` have no execute privilege on either function while `service_role` does (`has_function_privilege`).

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly from scratch (use your own stack slot per `lessons.md`): `npx supabase db reset`
- The whole pgTAP suite passes, including the new file and the existing timer, purge and delete files: `npx supabase test db`
- Deliberate break: in a worktree-only edit, removing the overlap check from `correct_time_entry` turns the overlap cases red, and removing the `link_id` condition from the entry lookup turns the foreign-link cases red; both edits are reverted afterwards (`git diff --stat` lists only intended files)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for confirmation before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Data layer

### Overview

Add the TypeScript layer over the two functions: the window helper, the list query, the two wrappers with typed errors, and `entryId` in the log context.

### Changes Required:

#### 1. The time-entries module

**File**: `src/lib/time-entries.ts` (new)

**Intent**: One place that lists correctable entries and calls the two functions, mapping the database's refusal codes to typed errors, so routes and pages never parse database text.

**Contract**: `correctionWindowStart(now: Date): Date` returns yesterday 00:00 UTC. `interface CorrectableEntry { id: string; projectName: string; task: string | null; type: string; workType: string; startedAt: string; endedAt: string | null }`. `listCorrectableEntries(linkId: string, now?: Date): Promise<CorrectableEntry[]>` selects the columns above from `time_entries` with `.eq("link_id", linkId)` and `.gte("started_at", windowStart)`, newest first, throws `dbError("time entry list", error)` on a database error and throws on an unexpected row shape (as `weekly-grid-query.ts` does). `correctEntry(linkId, entryId, startedAt: Date, endedAt: Date)` calls `correct_time_entry` with ISO strings and returns `{ entryId, startedAt, endedAt }`; `deleteEntry(linkId, entryId)` calls `delete_time_entry` and returns the id. A `P0001` error whose message is one of the six codes throws `CorrectionRefusedError` (a class with a `reason` of type `CorrectionRefusal = "entry_not_found" | "entry_running" | "outside_window" | "in_future" | "bad_range" | "overlap"`); any other error, including an unknown `P0001` message, throws `dbError("correct_time_entry" | "delete_time_entry", error)` so the cause survives.

#### 2. Log context

**File**: `src/lib/log.ts`

**Intent**: Let a correction event name the entry it concerns.

**Contract**: `LogContext` gains an optional `entryId?: string`; serialization, the no-token rule and every other field are unchanged.

#### 3. A seed helper for time entries

**File**: `src/test/integration-db.ts`

**Intent**: The integration tests (and the Phase 5 e2e spec) need to create closed entries without inserting rows by hand each time.

**Contract**: export `seedTimeEntry(linkId, projectId, projectName, startedAt: Date, endedAt: Date | null)` that inserts one `time_entries` row through the service-role client, returns its id, and is covered by the existing `cleanupSeeded` (extend it to delete entries before projects and links if it does not already).

#### 4. Tests

**Files**: `src/lib/time-entries.test.ts` (new), `src/lib/log.test.ts` (extend), `src/lib/time-entries.integration.test.ts` (new)

**Intent**: Prove the mapping, the link scoping and the rounding interaction without a browser.

**Contract**: unit tests with the existing `adminOrThrow` mock pattern: `correctionWindowStart` at several instants including exactly 00:00 UTC; the list query applies the `link_id` and window predicates and orders newest first, maps rows to `CorrectableEntry`, and throws on an unexpected row and on a database error with the original error as `cause`; each of the six codes becomes a `CorrectionRefusedError` with that reason for both wrappers; an unknown `P0001` message and a non-`P0001` error become `dbError` with `cause`; the RPC receives the ids and ISO strings. `log.test.ts` asserts `entryId` is passed through and no other key is added. The integration test (skipped without the stack, gated like the other `*.integration.test.ts` files) seeds two people: a person corrects and deletes their own entry through the wrappers; the same call with the other person's link id is refused with `entry_not_found` and leaves the other person's rows unchanged; an overlap is refused; the list returns only the person's own in-window entries; and after a correction that moves an entry's end across a 15-minute boundary, `fetchWeekEntries` plus `buildWeeklyGrid` shows the cell rounded up once from the corrected raw time.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npx vitest run src/lib/time-entries.test.ts src/lib/log.test.ts`
- Integration test passes against the local stack (own slot): `npx vitest run --config vitest.integration.config.ts src/lib/time-entries.integration.test.ts`
- Whole suite stays green: `npx vitest run`
- Type checking passes: `npx tsc --noEmit`
- Changed files lint clean: `npx eslint src/lib/time-entries.ts src/lib/time-entries.test.ts src/lib/time-entries.integration.test.ts src/lib/log.ts src/lib/log.test.ts src/test/integration-db.ts`
- Deliberate break: in a worktree-only edit, removing the `.eq("link_id", …)` predicate from `listCorrectableEntries` turns the list unit test red, and mapping the `overlap` code to a generic `dbError` turns the refusal-mapping test red; both edits are reverted afterwards (`git diff --stat` lists only intended files)

---

## Phase 3: Routes

### Overview

Add the edit and delete POST routes with their banner codes, UTC form-field parsing and route tests.

### Changes Required:

#### 1. UTC time field parsing

**File**: `src/lib/utc-datetime.ts` (new)

**Intent**: Turn the form's `datetime-local` text into a UTC `Date` and back, in one tested place.

**Contract**: `parseUtcDateTimeLocal(value: unknown): Date | null` accepts only `YYYY-MM-DDTHH:mm` or `YYYY-MM-DDTHH:mm:ss`, reads it as UTC and returns `null` for anything else, including impossible calendar dates (for example `2026-02-30T10:00`); `formatUtcDateTimeLocal(iso: string): string` returns the `YYYY-MM-DDTHH:mm` form of a UTC instant for an input's value.

#### 2. Banner codes

**File**: `src/lib/status-messages.ts`

**Intent**: Give each correction outcome a visible message without adding any forgeable free-text.

**Contract**: new `ERROR_*` constants (`entry-time-invalid`, `entry-range`, `entry-overlap`, `entry-outside-window`, `entry-in-future`, `entry-running`) and `STATUS_*` constants (`entry-corrected`, `entry-deleted`) with map entries: "Enter both times as a UTC date and time." / "The end must be after the start." / "That time overlaps another entry or the running timer. Shorten the other one first." / "Only entries from today and yesterday (UTC) can be corrected." / "The end can't be in the future." / "Stop the running timer first; then you can correct it." / "Entry corrected." / "Entry deleted." The existing generic fallback for unknown error codes is unchanged. The final wording is confirmed by the human in Phase 4.

#### 3. The two routes

**Files**: `src/pages/api/w/[token]/entries/[entryId]/correct.ts` (new), `src/pages/api/w/[token]/entries/[entryId]/delete.ts` (new)

**Intent**: Apply a correction or a delete for the person whose link is in the URL, scoped by that link only.

**Contract**: both follow `projects/[projectId]/delete.ts`: a malformed token or entry id rewrites to `/404`; `findLinkByToken` failing logs `link_lookup_failed` and answers a body-less 503, a missing link rewrites to `/404`; the call to `correctEntry` / `deleteEntry` passes the looked-up `link.id`, never anything from the URL; an `ALL` handler returns 405 with `Allow: POST`. The correct route reads `startedAt` and `endedAt` from the form (a non-form body logs `form_parse_failed` and redirects with `entry-time-invalid`), parses both with `parseUtcDateTimeLocal` (a `null` redirects with `entry-time-invalid`), and on success logs `logInfo("entry_corrected", { route, linkId, entryId })` and redirects 303 to `/w/${token}/corrections?status=entry-corrected`. A `CorrectionRefusedError` writes `logWarn("entry_correction_refused", { route, linkId, entryId, op: reason })` (`entry_deletion_refused` in the delete route) and redirects 303 to `/w/${token}/corrections?error=<code>` with `overlap` → `entry-overlap`, `outside_window` → `entry-outside-window`, `in_future` → `entry-in-future`, `bad_range` → `entry-range`, `entry_running` → `entry-running`, while `entry_not_found` rewrites to `/404`. Any other error writes `logError("entry_correct_failed" | "entry_delete_failed", …, err)` and redirects with the generic `?error=1`. The delete route logs `entry_deleted` on success and redirects with `entry-deleted`. Routes are named `POST /api/w/[token]/entries/[entryId]/correct` and `…/delete` in the `route` field.

#### 4. Tests

**Files**: `src/lib/utc-datetime.test.ts` (new), `src/lib/status-messages.test.ts` (extend), `src/__tests__/entry-routes.test.ts` (new)

**Intent**: Pin the parsing, the banner text and every route outcome.

**Contract**: `utc-datetime.test.ts`: both accepted shapes, UTC interpretation, rejection of wrong shapes, impossible dates and non-strings, and the round trip through `formatUtcDateTimeLocal`. `status-messages.test.ts`: the new codes map to their exact text and an unknown code still gets the generic message. `entry-routes.test.ts` follows `timer-routes.test.ts` (mock `@/lib/links`, `@/lib/time-entries` and astro env as the other route tests do, with the real `CorrectionRefusedError` class): for both routes a malformed token or entry id rewrites to `/404`, a lookup failure gives 503 and `link_lookup_failed`, a missing link rewrites to `/404`, and the mocked function is always called with `link.id`; for the correct route a success redirects with `entry-corrected` and logs one `entry_corrected` line, an unparseable or missing time redirects with `entry-time-invalid` without calling the function, a non-form body logs `form_parse_failed`, each refusal reason maps to its code and logs one `entry_correction_refused` warn line with `op` set to the reason, `entry_not_found` rewrites to `/404`, and an unexpected error logs `entry_correct_failed` and redirects with `?error=1`; the delete route has the matching success, refusal and failure cases; across all cases no emitted line contains the token; both routes answer 405 to other methods.

### Success Criteria:

#### Automated Verification:

- Route and parsing tests pass: `npx vitest run src/__tests__/entry-routes.test.ts src/lib/utc-datetime.test.ts src/lib/status-messages.test.ts`
- Whole suite stays green: `npx vitest run`
- Type checking passes: `npx tsc --noEmit`
- Changed files lint clean: `npx eslint "src/pages/api/w/[token]/entries/[entryId]/correct.ts" "src/pages/api/w/[token]/entries/[entryId]/delete.ts" src/lib/utc-datetime.ts src/lib/utc-datetime.test.ts src/lib/status-messages.ts src/lib/status-messages.test.ts src/__tests__/entry-routes.test.ts`
- No `console` call or disable comment in the new routes: `grep -rnE "console\.|eslint-disable-next-line no-console" "src/pages/api/w/[token]/entries"` prints nothing
- Deliberate break: in a worktree-only edit, letting the correct route fall through to the generic failure for a `CorrectionRefusedError` turns the refusal cases red, and passing the entry id from the URL instead of `link.id` to `correctEntry` turns the link-scoping case red; both edits are reverted afterwards (`git diff --stat` lists only intended files)

---

## Phase 4: Pages and links

### Overview

Add the Corrections page, the delete confirm page and the links to them, and verify them in a real browser.

### Changes Required:

#### 1. The Corrections page

**File**: `src/pages/w/[token]/corrections.astro` (new)

**Intent**: Let a person see their entries from today and yesterday and fix a mistake, without making corrections as prominent as live tracking.

**Contract**: follows `grid.astro`: sets the three privacy headers (`Referrer-Policy: strict-origin`), rewrites a malformed token to `/404`, shows the "Temporarily unavailable" 503 view with `logError("page_link_lookup_failed", …)` when the link lookup fails and with `logError("page_entries_failed", { route, linkId }, err)` when `listCorrectableEntries` fails, and rewrites to `/404` for an unknown link. It renders a heading "Corrections", one sentence ("Fix a mistake from today or yesterday. Times are UTC."), a back link to the workspace, and the banner from `?error=` / `?status=` through `errorMessage` / `statusMessage`. Entries are grouped under a UTC date heading per day (newest first). Each closed entry shows the project name and has a `<form method="post">` to `/api/w/${token}/entries/${id}/correct` with two `datetime-local` inputs (`name="startedAt"`, `name="endedAt"`, `step="60"`, `required`, labels "Start (UTC)" and "End (UTC)", prefilled with `formatUtcDateTimeLocal`), a Save button, and a Delete link to `/w/${token}/corrections/${id}/delete`. A running entry is shown read-only ("Running since HH:MM UTC — stop the timer first to correct it"). With no entries it says so.

#### 2. The delete confirm page

**File**: `src/pages/w/[token]/corrections/[entryId]/delete.astro` (new)

**Intent**: Confirm an irreversible delete the way project delete does.

**Contract**: follows `projects/[projectId]/delete.astro`: privacy headers with `strict-origin`, malformed token or entry id rewrites to `/404`, 503 view on lookup or read failure with a log, and the entry is found by id in `listCorrectableEntries(link.id)` (absent, running or outside the window rewrites to `/404`). It shows "Delete this entry?", the project name and the UTC start and end, "This can't be undone.", a Confirm form posting to `/api/w/${token}/entries/${entryId}/delete` and a Cancel link back to the Corrections page.

#### 3. Links from the workspace

**File**: `src/components/WorkspaceCard.astro`

**Intent**: Make corrections reachable, and give the 12-hour warning somewhere to send the user.

**Contract**: a new section next to "Weekly summary" (same markup pattern, `border-t` block) with the heading "Corrections", one short sentence and a secondary-button link to `/w/${token}/corrections`; the long-running warning text gains a sentence pointing to the Corrections page (for example "…records all of that time; if that is too much, you can shorten it afterwards under Corrections.") with a link, and keeps `data-long-running-warning`. Nothing else in the card changes (the timer forms, the double-submit script and the other sections stay as they are).

### Success Criteria:

#### Automated Verification:

- Changed files lint clean: `npx eslint "src/pages/w/[token]/corrections.astro" "src/pages/w/[token]/corrections/[entryId]/delete.astro" src/components/WorkspaceCard.astro`
- Type checking passes: `npx tsc --noEmit`
- Whole suite stays green: `npx vitest run`

#### Manual Verification:

- With the local stack and the dev server (`ASTRO_DEV_BACKGROUND=1`) and a person with a few closed entries from today and yesterday, the Corrections page lists them grouped by UTC day with "(UTC)" labels, the running entry is read-only, and the workspace card links to the page
- In a real browser (not curl) an edit saves with the "Entry corrected." banner and the new times show on reload; an overlapping time, an end in the future and an end before the start each show their own message and change nothing; the weekly grid shows the corrected, rounded total
- In a real browser the delete link opens the confirm page, Confirm removes the entry with "Entry deleted.", Cancel changes nothing, and another person's entry id gives a 404
- The privacy headers are present on both pages (`Referrer-Policy: strict-origin`, `Cache-Control: no-store`, `X-Robots-Tag: noindex`), and the wording of the page, the banners and the warning sentence was read and approved

---

## Phase 5: e2e and final checks

### Overview

Prove the whole flow in a real browser and run every check the lane's goal names.

### Changes Required:

#### 1. The e2e spec

**File**: `tests/e2e/corrections.spec.ts` (new)

**Intent**: Pin the real-browser flow, including the `Origin` behaviour that curl and the smoke script cannot see.

**Contract**: modelled on `tests/e2e/delete-account.spec.ts`: each test seeds its own person and two closed entries from today with the Phase 2 helper (unique timestamp-suffixed names), and a bystander with an entry of their own; `afterEach` cleans up. Cases: opening the page lists the person's entries and not the bystander's; changing an entry's end saves with the "Entry corrected." banner and the new time after reload; an edit that overlaps the other entry shows the overlap message and leaves the times unchanged; the delete link opens the confirm page, Confirm removes the entry with "Entry deleted." and the bystander's entry survives; Cancel keeps the entry. Locators are role, label or text based; no `waitForTimeout`.

### Success Criteria:

#### Automated Verification:

- The new e2e spec passes (local stack in your own slot): `npx playwright test tests/e2e/corrections.spec.ts`
- The whole e2e suite stays green: `npx playwright test`
- Whole unit suite and types stay green: `npx vitest run` and `npx tsc --noEmit`
- Lint is clean (run once here, the last code phase; if it reports unresolved `import.meta.env` types, delete `node_modules/.cache/eslint/` and rerun per `lessons.md`): `npm run lint`
- Astro check passes: `npx astro check`
- Production build succeeds: `npm run build`
- The whole pgTAP suite passes: `npx supabase test db`
- The local smoke test passes (`ASTRO_DEV_BACKGROUND=1` per `lessons.md`): `npm run smoke:local -- --yes`
- Deliberate break: in a worktree-only edit, making the correct route redirect with the success code for a refusal turns the overlap e2e case red; the edit is reverted afterwards (`git diff --stat` lists only intended files)

---

## Testing Strategy

### Unit Tests:

- `correctionWindowStart`, the list query predicates and mapping, the six refusal mappings for both wrappers, unknown-error handling with `cause`, the UTC parser and formatter, the banner text, `entryId` in the log context.
- Routes: every outcome, the `link.id`-only scoping, the 404 rewrites, 503 on lookup failure, no token in any line, 405.

### Integration Tests:

- Opt-in, against the local stack: two people, ownership refused both ways, overlap refused, the list limited to own in-window entries, and a corrected entry rounding once in the weekly grid.
- pgTAP: every refusal in its fixed order, success paths, touching boundaries allowed, ownership, privileges.

### Manual Testing Steps:

1. Open the Corrections page with a few entries and edit one in a real browser; confirm the banner and the weekly grid total.
2. Try an overlapping time, a future end and an end before the start; confirm each message and that nothing changed.
3. Delete an entry through the confirm page; confirm Cancel changes nothing.
4. Start a timer, let the 12-hour warning logic be exercised through the kitchen-sink or a seeded old start, and confirm the warning links to the Corrections page.

## Performance Considerations

One indexed read per Corrections page view (entries of one link from yesterday's midnight), one locked function call per correction; no work on any other path. The advisory lock is per link, as for start, switch and stop.

## Migration Notes

One new migration (`20261005120000_time_entry_corrections.sql`) adding two functions; no table, column or constraint changes and no data changes, so existing rows are unaffected and there is nothing to back-fill. The migration must be applied to the database (`supabase db push`) before the app code that calls the functions is deployed, because the app deploy is automatic on merge to `main` and the database push is manual; until the migration is applied the new routes answer with the generic failure banner. To roll back, drop the two functions; the rest of the app does not depend on them. New log events: `entry_corrected`, `entry_deleted` (info), `entry_correction_refused`, `entry_deletion_refused` (warn), `entry_correct_failed`, `entry_delete_failed`, `page_entries_failed` (error).

## References

- Research: `context/changes/time-corrections/research.md`
- Roadmap item and risk: `context/foundation/roadmap.md` (S-05); PRD: `context/foundation/prd.md` (FR-005, the 15-minute rule, FR-008, FR-009)
- Function pattern to copy: `supabase/migrations/20260927120000_stop_timer.sql`; pgTAP pattern: `supabase/tests/database/stop_timer.test.sql`
- Route and page patterns: `src/pages/api/w/[token]/projects/[projectId]/delete.ts`, `src/pages/w/[token]/projects/[projectId]/delete.astro`, `src/pages/w/[token]/grid.astro`
- Route test pattern: `src/__tests__/timer-routes.test.ts`; e2e pattern: `tests/e2e/delete-account.spec.ts`; integration helpers: `src/test/integration-db.ts`
- Logger and events: `src/lib/log.ts`; banner codes: `src/lib/status-messages.ts`
- Lanes and slot rules: `context/foundation/parallel-goals.md` (Lane 5), `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database functions and pgTAP

#### Automated

- [x] 1.1 Migrations apply cleanly from scratch (own stack slot): `npx supabase db reset`
- [x] 1.2 The whole pgTAP suite passes, including the new file and the existing timer, purge and delete files: `npx supabase test db`
- [x] 1.3 Deliberate break: removing the overlap check turns the overlap cases red and removing the `link_id` condition turns the foreign-link cases red; both edits are reverted

### Phase 2: Data layer

#### Automated

- [ ] 2.1 Unit tests pass: `npx vitest run src/lib/time-entries.test.ts src/lib/log.test.ts`
- [ ] 2.2 Integration test passes against the local stack (own slot): `npx vitest run --config vitest.integration.config.ts src/lib/time-entries.integration.test.ts`
- [ ] 2.3 Whole suite stays green: `npx vitest run`
- [ ] 2.4 Type checking passes: `npx tsc --noEmit`
- [ ] 2.5 Changed files lint clean: `npx eslint src/lib/time-entries.ts src/lib/time-entries.test.ts src/lib/time-entries.integration.test.ts src/lib/log.ts src/lib/log.test.ts src/test/integration-db.ts`
- [ ] 2.6 Deliberate break: removing the `.eq("link_id", …)` predicate turns the list unit test red and mapping `overlap` to a generic `dbError` turns the refusal-mapping test red; both edits are reverted

### Phase 3: Routes

#### Automated

- [ ] 3.1 Route and parsing tests pass: `npx vitest run src/__tests__/entry-routes.test.ts src/lib/utc-datetime.test.ts src/lib/status-messages.test.ts`
- [ ] 3.2 Whole suite stays green: `npx vitest run`
- [ ] 3.3 Type checking passes: `npx tsc --noEmit`
- [ ] 3.4 Changed files lint clean: `npx eslint "src/pages/api/w/[token]/entries/[entryId]/correct.ts" "src/pages/api/w/[token]/entries/[entryId]/delete.ts" src/lib/utc-datetime.ts src/lib/utc-datetime.test.ts src/lib/status-messages.ts src/lib/status-messages.test.ts src/__tests__/entry-routes.test.ts`
- [ ] 3.5 No `console` call or disable comment in the new routes: `grep -rnE "console\.|eslint-disable-next-line no-console" "src/pages/api/w/[token]/entries"` prints nothing
- [ ] 3.6 Deliberate break: letting the correct route fall through to the generic failure for a refusal turns the refusal cases red and passing the URL's entry id instead of `link.id` turns the link-scoping case red; both edits are reverted

### Phase 4: Pages and links

#### Automated

- [ ] 4.1 Changed files lint clean: `npx eslint "src/pages/w/[token]/corrections.astro" "src/pages/w/[token]/corrections/[entryId]/delete.astro" src/components/WorkspaceCard.astro`
- [ ] 4.2 Type checking passes: `npx tsc --noEmit`
- [ ] 4.3 Whole suite stays green: `npx vitest run`

#### Manual

- [ ] 4.4 With the local stack and dev server, the Corrections page lists entries from today and yesterday grouped by UTC day with "(UTC)" labels, the running entry is read-only, and the workspace card links to the page
- [ ] 4.5 In a real browser an edit saves with the "Entry corrected." banner and the new times show on reload; an overlap, a future end and an end before the start each show their own message and change nothing; the weekly grid shows the corrected, rounded total
- [ ] 4.6 In a real browser the delete link opens the confirm page, Confirm removes the entry with "Entry deleted.", Cancel changes nothing, and another person's entry id gives a 404
- [ ] 4.7 The privacy headers are present on both pages, and the wording of the pages, the banners and the warning sentence was read and approved

### Phase 5: e2e and final checks

#### Automated

- [ ] 5.1 The new e2e spec passes: `npx playwright test tests/e2e/corrections.spec.ts`
- [ ] 5.2 The whole e2e suite stays green: `npx playwright test`
- [ ] 5.3 Whole unit suite and types stay green: `npx vitest run` and `npx tsc --noEmit`
- [ ] 5.4 Lint is clean: `npm run lint`
- [ ] 5.5 Astro check passes: `npx astro check`
- [ ] 5.6 Production build succeeds: `npm run build`
- [ ] 5.7 The whole pgTAP suite passes: `npx supabase test db`
- [ ] 5.8 The local smoke test passes: `npm run smoke:local -- --yes`
- [ ] 5.9 Deliberate break: making the correct route redirect with the success code for a refusal turns the overlap e2e case red; the edit is reverted
