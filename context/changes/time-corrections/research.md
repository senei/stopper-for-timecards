---
date: 2026-10-05T11:14:00+02:00
researcher: Claude (agent run for senei web)
git_commit: 081e063ab04da57dfbe25286a12461ee0b4638e9
branch: main
repository: x10-dev--curse
topic: "How does the app store, display and change logged time today, and what must a feature to correct logged time (edit or delete a closed time entry) build on or respect?"
tags: [research, codebase, time_entries, timer, weekly-grid, purge, corrections, FR-005, S-05]
status: complete
last_updated: 2026-10-05
last_updated_by: Claude (agent run for senei web)
---

# Research: What a time-correction feature (S-05, FR-005) builds on and must respect

**Date**: 2026-10-05T11:14:00+02:00
**Researcher**: Claude (agent run for senei web)
**Git Commit**: 081e063ab04da57dfbe25286a12461ee0b4638e9
**Branch**: main
**Repository**: x10-dev--curse

## Research Question

How does the app store, display and change logged time today, and what exists that a feature to correct logged time (edit or delete a closed time entry, for end-of-day or start-of-next-day fixes) would build on or must respect?

Scope: local inspection by one researcher, no sub-agents (the relevant code is about 30 files). Read in full or in the cited ranges: the `supabase/migrations/` files named below, `src/lib/{timer,timer-flag,weekly-grid,weekly-grid-query,weekly-grid-retention,projects,log,status-messages,project-name}.ts`, `src/pages/w/[token].astro`, `src/pages/w/[token]/grid.astro`, `src/pages/w/[token]/projects/[projectId]/delete.astro`, `src/pages/api/w/[token]/{timer/stop,timer/switch,delete-account,projects/[projectId]/delete}.ts`, `src/components/{WorkspaceCard,WeeklyGridView}.astro`, test file inventories, and `context/foundation/{lessons,prd,roadmap,parallel-goals,test-plan,test-stack}.md`. Not read in full: `scripts/smoke.mjs` (keyword grep only), `src/pages/api/w/[token]/regenerate.ts`, most of `workers/purge-job`, the pgTAP bodies other than headers and case lists.

## Summary

1. **There is no way today to edit or delete a time entry, and no UI lists individual entries.** The only writers of `time_entries.ended_at` are `switch_timer` and `stop_timer`, both at `now()` (`supabase/migrations/20260923120000_switch_timer.sql:174`, `20260927120000_stop_timer.sql:229`); the only deletes of entries are `purge_time_entries` (`20260925120000_purge_time_entries.sql:30-32`) and `delete_account` (`20260928120000_delete_account.sql:79`). The workspace shows only the running timer and a project list (`src/components/WorkspaceCard.astro:109-212`); the weekly grid shows aggregated per-day cells with no entry ids or clock times (`src/components/WeeklyGridView.astro:67-79`). A correction feature therefore needs a new surface that lists entries (with their ids) and new write paths.
2. **15-minute rounding is not done in the database functions.** `start_timer`, `switch_timer` and `stop_timer` store exact `now()` timestamps and do no rounding. Rounding happens only at read time in `buildWeeklyGrid`: per (row, UTC day) cell, raw milliseconds are summed first and rounded up once to the next 15 minutes (`src/lib/weekly-grid.ts:28-31`, `82-91`). A correction that edits raw `started_at`/`ended_at` (or deletes an entry) is rounded correctly by the existing grid with no change to that code; a correction that stored pre-rounded values would double-apply or distort the PRD rule ("summed first and then rounded once", `context/foundation/prd.md:98`).
3. **Entries are chained but nothing enforces it.** Switch closes the old entry and opens the next at the same `now()` inside one transaction, so a normal day has gap-free, overlap-free segments (`20260923120000_switch_timer.sql:174-191`, checked by `supabase/tests/database/timer_guardrails.test.sql` case 1, line 22). No CHECK constraint ties `ended_at` to `started_at`; the only constraints on `time_entries` are the FKs and the partial unique index on one open entry per link (`20260922150000_projects_and_timer.sql:48-59`). Editing or deleting one closed entry can therefore create a gap, an overlap, `ended_at <= started_at`, or an overlap with the running entry, all without a database error. The grid tolerates overlap (it sums both) and skips `endMs <= startMs` (`src/lib/weekly-grid.ts:59`), so bad data would silently overstate or drop hours.
4. **Each entry carries a snapshot of its project's fields.** `time_entries` stores `project_id` plus a copy of `project_name`, `task`, `type`, `work_type` made at creation (`20260922150000_projects_and_timer.sql:41-46`), and the grid groups by the snapshot, not the live project (`src/lib/weekly-grid.ts:34-36`). Re-attributing an entry to another project must copy that project's current name/task/type/work_type into the entry, as `start_timer`/`switch_timer` do (`20260923120000_switch_timer.sql:176-191`), otherwise the grid row and `project_id` disagree.
5. **Retention and project-deletion rules interact with corrections.** `purge_time_entries` deletes closed entries whose `started_at < now() - interval '3 months'` (`20260925120000_purge_time_entries.sql:30-32`); the grid hides weeks that straddle the cutoff (`src/lib/weekly-grid-retention.ts:207-215`). An edit that moves `started_at` before the cutoff makes the entry purge-eligible at the next purge run. Project deletion is blocked by the `time_entries.project_id` FK (no cascade; `23503` mapped to `ProjectInUseError`, `src/lib/projects.ts:237-241`), so deleting the last entry of a project makes that project deletable and changing an entry's `project_id` can free the old project. This matches PRD FR-009 ("only when it has no logged time entries", `context/foundation/prd.md:82`) but changes a past week's grid, which FR-009's rationale calls out as the thing being protected.
6. **A route and page pattern to copy exists, with several enforced conventions.** Every `/api/w/[token]/...` mutation: `isWellFormedToken` then `findLinkByToken` (503 on lookup failure, rewrite to `/404` on null), then the action, then a `303` redirect with a `?status=`/`?error=` code, plus an `ALL` handler returning 405 (`src/pages/api/w/[token]/timer/stop.ts:249-284`, `projects/[projectId]/delete.ts:16-58`). Scoping is by `link_id` taken from the token, never from the URL's resource id (`delete.ts:12-15`, `src/lib/projects.ts:199-207`). Confirmation pages are GET pages with a POST form and `Referrer-Policy: strict-origin` (`projects/[projectId]/delete.astro:72-74`); the strongest variant is a server-checked typed phrase (`delete-account.ts:36-49`).
7. **The product constraint is "safety net, not a substitute".** The PRD's FR-005 text is "User can add corrections to logged time, at end of day or start of the next day" with the resolution that corrections are the safety net for missed live tracking, not a replacement (`context/foundation/prd.md:74-75`); the roadmap risk repeats it (`context/foundation/roadmap.md:145`). Neither the PRD nor the roadmap defines whether "add" means edit boundaries, add a missing entry, delete an entry, or all three, nor how "end of day or start of the next day" is enforced (see Open Questions).
8. **The long-running-timer flag from S-04 currently has no correction destination.** The warning only says stopping or switching "records all of that time" (`src/components/WorkspaceCard.astro:115-122`); the S-04 research left "what can the user do when flagged" to S-05 (`context/archive/2026-09-25-timer-stop-and-flags/research.md:133`, Open Question 3).

## Detailed Findings

### Schema and migrations (time_entries, projects)

- `time_entries` base: `id`, `link_id`, `project` (later dropped), `started_at timestamptz not null`, `ended_at timestamptz` nullable, `created_at` (`20260918082739_phase_b_c_purge_and_access_log.sql:9-16`); indexes on `started_at` and `link_id` (lines 18-19). The migration's own comment says corrections were expected later: "Needs to be reconciled/extended (task, type, work_type columns; corrections; project references)" (lines 4-8).
- S-02 added `project_id uuid not null references projects(id)`, `project_name text not null`, `task text`, `type text not null default 'Regular'`, `work_type text not null default ''`, the `link_id` FK, an index on `project_id` and the unique partial index `time_entries_link_id_open_idx on (link_id) where ended_at is null` (`20260922150000_projects_and_timer.sql:41-59`). There is no `updated_at`, no `corrected` marker and no audit table.
- `projects`: `id`, `link_id` FK, `name`, `task`, `type` default `'Regular'`, `work_type` default `''`, `created_at`; unique index on `(link_id, lower(name))` (`20260922150000_projects_and_timer.sql:13-29`). Project name/task/type are not editable anywhere in the app (the S-02 plan lists editing them as out of scope, `context/archive/2026-09-22-first-timer-start/plan-brief.md:34`).
- RLS is enabled on `time_entries` and `projects` with no policies, so only the service role reads or writes (`20260921120000_private_links.sql:44-47`, `20260922150000_projects_and_timer.sql:31`). All app access is through `adminOrThrow()` (`src/lib/timer.ts:64`), so link scoping is application-enforced (`.eq("link_id", ...)`), not database-enforced; a new function or query that forgets the `link_id` predicate would cross people's data.
- Convention for multi-step writes: a `security definer` plpgsql function with `set search_path = public`, a per-link advisory lock `hashtext('public.timer:' || link_id)`, `revoke ... from public, anon, authenticated; grant ... to service_role`, and `P0001` for a missing precondition (`20260927120000_stop_timer.sql:209-236`). `delete_account` was corrected in review to use the same `public.timer:` key (`20260928130000_delete_account_timer_lock.sql:22`); `regenerate_link` uses its own key (`20260926120000_regenerate_link.sql:31`). A correction function that changes entry boundaries should take the `public.timer:` key so it serializes with start/switch/stop; the latest migration timestamp is `20260928130000`, so a new one must sort after it, and existing migrations are never edited (`context/foundation/parallel-goals.md:60`, cited in the S-04 research).

### Timer RPCs and rounding

- `start_timer` and `switch_timer` set `started_at` to `now()` and switch also sets the old entry's `ended_at = now()` (`20260923120000_switch_timer.sql:140-143`, `174`, `189-191`); `stop_timer` sets `ended_at = now()` (`20260927120000_stop_timer.sql:229`). A grep of the three migration files for `15`, `round` and `interval` finds no rounding; the rounding exists only in `src/lib/weekly-grid.ts`. (The change request's phrase "RPC functions and their rounding to 15 minutes" does not match the code: the RPCs do not round.)
- All three return the same four columns (`entry_id`, `project_id`, `project_name`, `started_at`), validated by `parseTimerRow` (`src/lib/timer.ts:28-56`). `NoActiveTimerError` (`P0001`) and `TimerAlreadyRunningError` (`23505`) are the typed errors (`src/lib/timer.ts:12-26`). A new correction RPC returning a different shape (for example `ended_at`) needs its own parser, as the S-04 research noted.
- `getCurrentTimer` reads only the open entry (`src/lib/timer.ts:118-147`). There is no function that lists closed entries.
- `src/lib/timer-flag.ts`: `LONG_RUNNING_TIMER_HOURS = 12`; `isTimerFlagged` and `elapsedWholeHours` use elapsed duration only, no time zone (`src/lib/timer-flag.ts:1-3`, `15-26`, `31-34`). The flag is derived at render and not stored (`WorkspaceCard.astro:56-58`).

### Weekly grid and retention window

- `fetchWeekEntries(linkId, weekStartUtc)` selects entries that overlap the UTC week, including the open one, ordered by `started_at`, and selects no `id` column (`src/lib/weekly-grid-query.ts:111-123`). `RawWeekEntry` has no id (`src/lib/weekly-grid.ts:1-8`). A correction list for a week needs either a new query that selects `id` or a widened one.
- `buildWeeklyGrid`: groups by JSON of (projectName, task, type, workType); splits a segment at UTC midnight; adds raw ms per (day, row); rounds up per cell with `Math.ceil(ms / 900000) * 15`; omits all-zero rows; sorts by project name; an open entry is credited up to `nowUtc` (`src/lib/weekly-grid.ts:46-98`). Unit tests pin these rules (`src/lib/weekly-grid.test.ts:21`, `153`, `169`, `234`).
- Days and weeks are UTC (`context/foundation/prd.md:98`; `utcMondayOf`, `src/lib/weekly-grid-retention.ts:168-174`). Any "end of day" / "start of next day" boundary a correction feature uses is therefore a UTC day unless the plan chooses otherwise; the browser already converts the running timer's start to local time in a client script (`WorkspaceCard.astro:322-331`), so a local-time edit form would mix two clocks.
- Retention in the grid: `earliestNavigableWeekStart` returns the first Monday on or after `now - 3 calendar months`, so a week that straddles the cutoff is not reachable (`src/lib/weekly-grid-retention.ts:182-215`); `grid.astro` falls back to the current week for an out-of-range `?week=` (`src/pages/w/[token]/grid.astro:47-60`). Mismatch to watch: the purge compares `started_at` (per entry, `20260925120000...:30-32`), the grid compares weeks, so an entry can be gone while its week is still navigable only if it started before the cutoff, which the week rule already excludes for a whole week.
- `grid.astro` and the workspace page follow the page conventions: `Referrer-Policy: strict-origin`, `Cache-Control: no-store`, `X-Robots-Tag: noindex`, malformed-token rewrite to `/404`, `503` "Temporarily unavailable" view on lookup or read failure with `logError(...)` (`grid.astro:19-87`, `[token].astro:161-211`). The grid page deliberately does not call `logAccess` (`grid.astro:66-68`).

### Workspace page and WorkspaceCard

- The page passes `startAction`, `switchAction`, `stopAction`, banner codes and the project list to `WorkspaceCard` (`src/pages/w/[token].astro:213-233`). The card has two branches (running timer, or idle with a project list and per-project Delete link, `WorkspaceCard.astro:109-213`) and fixed sections for the weekly grid link, the private link, Regenerate and Delete-all (`215-258`).
- The card has no list of today's or yesterday's entries and shows no stop time. A "yesterday's open timer" situation is visible only as the running timer's start time and the 12-hour warning (`WorkspaceCard.astro:111-122`).
- The inline client script disables a form's submit on submit, converts the start time to local time, and re-enables buttons on bfcache restore (`WorkspaceCard.astro:311-356`); a new form inside the card inherits the double-submit guard only if it sits inside `[data-workspace-card]`.
- Banner text lives in `src/lib/status-messages.ts` (`ERROR_*`, `STATUS_*` constants plus two lookup maps, `status-messages.ts:1-27`); unknown error codes show the generic message, unknown status codes show nothing. A new outcome (corrected, deleted entry, invalid time range) needs new constants and map entries; tests exist in `src/lib/status-messages.test.ts`.

### API routes: confirmation, CSRF/Origin, link scoping

- Project delete: `GET /w/[token]/projects/[projectId]/delete` shows "Delete <name>? This can't be undone." with Confirm and Cancel; `POST /api/w/[token]/projects/[projectId]/delete` does the work (`delete.astro:132-144`, `delete.ts:16-58`). The POST itself does not re-check any confirmation (the confirm step is the page the form lives on); account delete additionally requires the typed phrase on the server (`delete-account.ts:47-49`).
- Other POST routes (`stop`, `switch`) have no confirmation step at all, and their request body is a form (`switch.ts:318-332`); a non-form body is treated as "no field" and refused (`switch.ts:319-332`, covered by `src/__tests__/timer-routes.test.ts:150`).
- Origin/CSRF: `astro.config.mjs` contains no `security` or `checkOrigin` setting (a grep for both words returns nothing), so Astro's default same-origin check for form POSTs applies (consistent with the lesson, `context/foundation/lessons.md:19-24`). Any page with a form must use `Referrer-Policy: strict-origin`, never `no-referrer`, or real browsers send `Origin: null` and get 403; curl and `scripts/smoke.mjs` set `Origin` themselves (`scripts/smoke.mjs:59`, `150-155`) and cannot catch it. New forms need a real-browser check.
- Link scoping: routes never trust a resource id from the URL; they resolve the link from the token and filter by `link_id` (`src/lib/projects.ts:199-207`, `236`); a mismatched id yields zero rows and a `404` rewrite (`delete.ts:51-53`). The ownership oracle for this is `src/lib/projects.integration.test.ts` (Oracle: "a person sees only their own projects and time", lines 6-40). A correction route keyed on an entry id must apply the same `link_id` filter and needs a two-person integration test. `isWellFormedId` (`src/lib/project-id.ts`) is the UUID check for ids; entry ids would need the same.
- The `stopper_link` cookie is never trusted for authorization (`stop.ts:245-248`).

### Logging

- `src/lib/log.ts` exposes `logError`, `logWarn`, `logInfo`; `LogContext` has `route`, `linkId`, `projectId`, `op`, `detail` and deliberately no token field (`log.ts:5-13`, `86-99`). There is no `entryId` field; a correction event that needs one would use `op`/`detail` or the plan would widen `LogContext` (and `src/lib/log.test.ts`).
- Existing event names follow `<noun>_<verb>[_<reason>]`: `timer_stop_failed`, `timer_stop_no_active`, `project_delete_in_use`, `project_delete_failed`, `account_delete_failed`, `page_week_entries_failed`, `link_lookup_failed`, `form_parse_failed` (greps of `src/`). Expected refusals use `logWarn`, failures `logError`, countable successes `logInfo` (only `link_created` and the creation-closed/full/busy events found use info/warn that way). Recent changes (`context/archive/2026-10-02-fix-silent-error-logging/`, `2026-10-05-signup-lifecycle-events/`) put weight on never swallowing errors silently; every `catch` in a new route should log.

### Tests that exist and where a correction feature's tests would sit

- Unit (vitest, colocated): `src/lib/weekly-grid.test.ts`, `weekly-grid-retention.test.ts`, `timer-flag.test.ts`, `status-messages.test.ts`, `project-id.test.ts`, `log.test.ts`.
- Route tests (mocked, `src/__tests__/`): `timer-routes.test.ts` runs `describe.each` over the start/switch/stop routes (503 on lookup failure, generic redirect and logged event on RPC failure, no logs on success; `timer-routes.test.ts:25-115`), plus race backstops (line 116); `delete-account-route.test.ts`, `links-route.test.ts`. A new correction route can be added to that table.
- Integration against a local Supabase stack, skipped without `.env` (`hasEnv`): `src/lib/projects.integration.test.ts`, `weekly-grid-query.integration.test.ts`, `links.integration.test.ts`, `src/__tests__/delete-account.integration.test.ts`, helpers `seedPerson`, `seedProject`, `cleanupSeeded` in `src/test/integration-db.ts` (exports `admin`, `hasEnv`, `seedPerson`, `seedProject`, `cleanupSeeded`; there is no helper to seed a time entry, `projects.integration.test.ts:15-25` inserts rows by hand).
- pgTAP in `supabase/tests/database/`: `projects_and_timer`, `switch_timer`, `stop_timer` (plan 15, fixed link ids `a0000000-0000-0000-0000-00000000000N`, N=6 and 7 taken by stop_timer), `timer_guardrails` (16; segment chaining, open-row index backstop), `purge_time_entries` (12), `delete_project` (12; case 3, line 44, shows a project with only closed entries is still protected by the FK), `delete_account`, `regenerate_link`, `private_links`, `anon_access`. A new correction function needs its own file with unused link ids and cases for ownership, ordering, overlap and purge-boundary behavior. Test-plan risk #2 (segments sum losslessly, "no gap and no overlap", `context/foundation/test-plan.md:80`) is the existing oracle a correction must not weaken.
- e2e (Playwright, `tests/e2e/`): `seed.spec.ts` (open link, start, stop), `delete-account.spec.ts`, `regenerate-link.spec.ts`; config has no auth project, each spec seeds its own link, and the run is local-only (`playwright.config.ts:24-27`, `context/foundation/test-stack.md`). A new form with a destructive or editing action fits the delete-account spec's shape (typed or confirm gate, real Origin, banner, bystander untouched, `afterEach` cleanup).

### PRD rules that bound the feature

- FR-005, rounding rule, UTC boundaries: `context/foundation/prd.md:74-75`, `98`. FR-008 and NFR: purge at 3 months, entries kept at least 3 months (`prd.md:81`, `91`). FR-009: project delete blocked while any logged time exists (`prd.md:82-83`). Access control: nobody sees another person's hours (`prd.md` Non-Goals, "No admin or manager view").
- The PRD's Socrates note on FR-005 sets the design intent: easy corrections could erode live tracking; "kept as-is" (`prd.md:75`). The parallel-goals goal for this lane requires the plan to state how corrections stay distinct from live tracking and how they interact with per-day 15-minute rounding, and covers "entries closed by stop_timer" (`context/foundation/parallel-goals.md:152`).

## Code References

- `supabase/migrations/20260922150000_projects_and_timer.sql:41-59` - snapshot columns, link_id FK, one-open-entry unique index
- `supabase/migrations/20260923120000_switch_timer.sql:150-196` - switch: close at now(), reopen; template for atomic multi-row writes
- `supabase/migrations/20260927120000_stop_timer.sql:209-236` - stop at now(); shared advisory lock key
- `supabase/migrations/20260925120000_purge_time_entries.sql:21-40` - 3-month purge of closed entries by started_at
- `supabase/migrations/20260928120000_delete_account.sql:55-89` and `20260928130000_delete_account_timer_lock.sql:22` - child-before-parent delete, lock key fix
- `src/lib/timer.ts:28-147` - RPC wrappers, typed errors, parser
- `src/lib/timer-flag.ts:1-34` - 12 h flag, derived
- `src/lib/weekly-grid.ts:28-98` - read-time rounding and bucketing
- `src/lib/weekly-grid-query.ts:111-161` - week overlap query, no id selected
- `src/lib/weekly-grid-retention.ts:168-215` - UTC Monday, 3-month cutoff, earliest navigable week
- `src/lib/projects.ts:157-245` - `ProjectInUseError` on FK 23503, link-scoped reads and delete
- `src/pages/api/w/[token]/timer/stop.ts:249-284` - route template
- `src/pages/api/w/[token]/projects/[projectId]/delete.ts:16-58` - id-in-URL route template
- `src/pages/api/w/[token]/delete-account.ts:36-49` - server-side typed-phrase check
- `src/pages/w/[token]/projects/[projectId]/delete.astro:72-144` - confirmation page template
- `src/pages/w/[token]/grid.astro:19-144` - week navigation page
- `src/components/WorkspaceCard.astro:109-258` - workspace sections; no entry list
- `src/lib/status-messages.ts:1-27` - banner constants and maps
- `src/lib/log.ts:5-13`, `86-99` - log context and levels
- `src/__tests__/timer-routes.test.ts:25-115`, `src/test/integration-db.ts` - route and integration test scaffolding
- `tests/e2e/delete-account.spec.ts:1-60` - e2e shape for a confirmed destructive action

## Architecture Insights

- Raw timestamps are the source of truth; every display is derived at read time (flag, local start time, grid rounding). A correction that edits raw timestamps keeps all existing derivations correct; a stored "corrected duration" would not.
- Multi-row invariants live in advisory-locked `security definer` functions, not in constraints; app code wraps them with typed errors. Following that pattern means corrections should be a SQL function (validating ownership, order, range and the retention window under the `public.timer:` lock), not several client-side updates.
- The database is deliberately constraint-light on time_entries (no check on `ended_at > started_at`, no overlap exclusion). Adding such constraints in a new migration would fail on existing rows if any violate them; lessons.md requires an explicit precondition check before destructive column changes (`context/foundation/lessons.md:12-17`), which is the analogous guard for a new CHECK or exclusion constraint.
- Entries are anonymous in the UI today. Entry ids become capability handles once exposed in URLs or forms; link scoping must hold on every read and write.
- Destructive actions use a separate confirm page; editing flows have no precedent (no existing edit form for any entity).

## Historical Context (from prior changes)

- `context/archive/2026-09-25-timer-stop-and-flags/research.md:133` and `plan-brief.md:23` - S-04 deliberately deferred correction to S-05 ("Corrections belong to S-05"); the flag prompt has no destination (supported by `WorkspaceCard.astro:115-122`).
- `context/archive/2026-09-22-first-timer-start/plan-brief.md:34`, `2026-09-23-timer-switch-rounding/plan.md:32`, `2026-09-28-weekly-grid-summary/plan.md:95` - each earlier plan lists S-05 corrections as out of scope.
- `context/archive/2026-09-28-weekly-grid-summary/plan.md:234` - the grid restricts navigation to full-retention weeks rather than showing partial data; corrections must stay inside that window to keep it true.
- `context/archive/2026-09-25-time-entry-purge-verified/` and `2026-09-23-delete-project/` - the purge and the FK-based project-delete block that a correction can interact with (not re-read in full; the migrations and `src/lib/projects.ts` were read directly).
- `context/archive/2026-09-29-testing-weekly-grid-rounding-aggregation/research.md` - oracle-based rounding tests; the "rounding rule" tests must keep passing unchanged.

## Related Research

- `context/archive/2026-09-25-timer-stop-and-flags/research.md` (S-04, source of the open "what happens when flagged" question).
- `context/archive/2026-09-28-weekly-grid-summary/` (grid and retention design).
- `context/archive/2026-09-29-testing-delete-account-guardrails/` (confirm-UX test patterns).

## Applicable lessons (`context/foundation/lessons.md`)

- Forms: `Referrer-Policy: strict-origin`, never `no-referrer`; submit every new form in a real browser (lessons.md:19-24).
- Migrations that restructure a column or add a constraint on a table that may hold rows need an explicit precondition check (lessons.md:12-17).
- Agent sessions starting `astro dev` need `ASTRO_DEV_BACKGROUND=1` and a wait for the "ready in" line (lessons.md:26-31); `wrangler dev` leftovers must be killed if the purge Worker is exercised (lessons.md:61-66).
- Fresh worktree: `npm ci`, `npx astro sync` before lint; run lint once in the last code phase (lessons.md:40-45, 54-59). Parallel DB lanes need their own Supabase stack slot (lessons.md:47-52; lane 5 is this change, `parallel-goals.md:147`).
- Record how manual Progress rows were verified (lessons.md:33-38).

## Open Questions

For the user to decide during `/10x-plan` (none blocked this research; conservative defaults noted):

1. **Which operations count as "corrections"?** Edit start and/or end of a closed entry, change an entry's project, delete an entry, add a missing entry, or a subset. PRD says only "add corrections" (`prd.md:74`). Conservative default: edit the end time (and start time) of a closed entry, and delete a closed entry; no manual add of an entry from nothing.
2. **How is "at end of day or start of the next day" enforced?** Options: an edit window (only entries that started today or yesterday, UTC), or a looser rule bounded only by the 3-month retention. The strict window keeps corrections distinct from reconstruction (roadmap risk); the day is UTC unless the plan changes it (`prd.md:98`). Conservative default: today and yesterday (UTC) only.
3. **Can the running (open) entry be corrected?** For example the forgotten timer flagged at 12 h: set its end to an earlier time and stop. This is the S-04 deferral (`timer-stop-and-flags/research.md:133`). Conservative default: correct closed entries only; "stop the running timer at an earlier time" is left as a separate plan decision.
4. **Neighbour handling.** When an entry's end moves earlier, does the gap stay, does the next entry's start move (preserving the no-gap, no-overlap chain of test-plan risk #2), or is overlap/gap simply refused or allowed? Conservative default: refuse any result that overlaps another entry or the running timer, and allow gaps.
5. **Time zone for entering times.** The form's clock times: UTC (matches grid and purge) or the browser's local time (matches how the running timer's start is shown, `WorkspaceCard.astro:322-331`). Conservative default: UTC with the zone labelled, or a client-side conversion; needs a decision.
6. **Confirmation UX for delete and for a large edit.** Separate confirm page like project delete, typed phrase like account delete, or none for edits. No precedent for an edit form.
7. **Audit/marker.** Whether a corrected entry is marked (new column, such as `corrected_at`) for later review; the schema has none and the grid would not show it. Conservative default: none for MVP unless the plan wants the live-tracking-discipline guard measured.
8. **Retention edge.** Whether to refuse an edit that moves `started_at` before the 3-month cutoff (otherwise the entry is purged at the next run, `20260925120000...:30-32`), and whether editing an entry in a week the grid no longer shows is allowed.
9. **Project re-attribution.** If included, whether it copies the target project's current snapshot (as switch does), and what happens to a project that loses its last entry (it becomes deletable, consistent with FR-009).
10. **Log context.** Whether to add an `entryId` field to `LogContext` (`log.ts:5-13`) or use `op`/`detail`.
11. **Not verified in this research.** No pgTAP, unit or e2e suite was run (not requested). The purge Worker calls the SQL function `purge_time_entries` (`workers/purge-job/src/index.ts:33`), so the function's `ended_at is not null` filter (`20260925120000_purge_time_entries.sql:31`) applies; the S-04 research note that the Worker deletes without that condition (its Open Question 7) is superseded by S-08. The rest of the Worker file was not read.
