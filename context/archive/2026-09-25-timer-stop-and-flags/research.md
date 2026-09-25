---
date: 2026-09-25T09:45:13+02:00
researcher: senei web
git_commit: b2e18b39d8b8217b69519fe81ba184a7311e1cde
branch: timer-stop-and-flags
repository: x10-dev--curse
topic: "S-04 timer-stop-and-flags: what exists to build 'stop the timer' and 'flag a suspiciously long timer' on, and what is still undecided"
tags: [research, codebase, timer, time_entries, switch_timer, WorkspaceCard, S-04]
status: complete
last_updated: 2026-09-25
last_updated_by: senei web
---

# Research: S-04 timer-stop-and-flags — what exists, and what is still undecided

**Date**: 2026-09-25T09:45:13+02:00
**Researcher**: senei web
**Git Commit**: b2e18b39d8b8217b69519fe81ba184a7311e1cde (working tree clean apart from `context/changes/timer-stop-and-flags/`)
**Branch**: timer-stop-and-flags
**Repository**: x10-dev--curse

## Research Question

Roadmap slice S-04 (FR-004): the user can stop the timer for the day, and a timer running "suspiciously long" is flagged with a prompt to correct it. What in the codebase does this build on (data model, `switch_timer` pattern, TypeScript wrappers, API routes, workspace UI, tests), what constraints do prior changes and lessons impose, and which questions remain open for `/10x-plan`?

Scope: local inspection only (no sub-agents; the relevant code is about a dozen files). Inspected: `src/lib/timer.ts`, `src/pages/api/w/[token]/timer/{start,switch}.ts`, `src/pages/w/[token].astro`, `src/components/WorkspaceCard.astro`, `src/pages/dev/kitchen-sink.astro` (grep only), `src/lib/status-messages.ts`, the `time_entries`/`start_timer`/`switch_timer` migrations, `supabase/tests/database/switch_timer.test.sql`, `scripts/smoke.mjs` (keyword grep of the whole file, full read of lines 205–329), `workers/purge-job/src/index.ts`, `context/foundation/{prd,roadmap,test-plan,lessons,parallel-goals}.md`, and the archived S-02/S-03 plans and briefs.

## Summary

- **No stop path exists.** A grep for `ended_at =` and `ended_at:` across `src/`, `workers/`, `supabase/migrations/` and `scripts/` finds one write, in `switch_timer` (`supabase/migrations/20260923120000_switch_timer.sql:73`). `src/lib/timer.ts` exports `startTimer`, `switchTimer` and `getCurrentTimer` only.
- **The stop function is a strict subset of `switch_timer`.** It needs the same advisory lock, the same open-entry lookup with `P0001` when none is open, and the same `update … set ended_at = now()`, minus the find-or-create-project and insert half. `NoActiveTimerError` already exists (`src/lib/timer.ts:19-25`) and its docstring names only `switch_timer`, so it can be reused.
- **The database already guarantees one open entry per link** (partial unique index, `20260922150000_projects_and_timer.sql:57-59`), so "preserving the one-open-entry invariant" for stop needs no new constraint: closing the open row can only reduce the open count.
- **The flag needs no schema change.** The page already loads `currentTimer.startedAt` on every render (`src/pages/w/[token].astro:55`) and sends `Cache-Control: no-store` (line 17), so elapsed time can be computed at render. The only question is where the threshold lives and how it is defined (see Open Questions 1–2).
- **The flag's "prompt to correct" has no destination yet.** The correction feature is S-05 (`roadmap.md:136-146`, prerequisites S-03 and S-04), so S-04 can prompt but not correct. This is the most consequential open point (Open Question 3).
- **The user-owned unknown is real but non-blocking.** The threshold is listed as `Owner: user. Block: no` (`roadmap.md:131-132`).

## Detailed Findings

### Data model (`time_entries`)

- Base table: `id`, `link_id`, `started_at timestamptz not null`, `ended_at timestamptz` (nullable), `created_at` (`supabase/migrations/20260918082739_phase_b_c_purge_and_access_log.sql:9-16`). S-02 replaced the placeholder `project` column with `project_id`, `project_name`, `task`, `type`, `work_type` (`20260922150000_projects_and_timer.sql:37-46`).
- No CHECK constraint relates `ended_at` to `started_at`: a case-insensitive search for `check (` across all five files in `supabase/migrations/` matches only two lines, `job_runs.status` (`20260918082739…:29`) and `access_log.outcome` (`20260918082739…:47`). The search does not catch a differently spelled inline `check(` or a trigger, and the two migrations that only mention `time_entries` in passing (`20260921120000_private_links.sql`, `20260922100433_access_log_link_fk.sql`) were not read line by line. Inference, not verified: a stop function that sets `ended_at = now()` should not produce `ended_at < started_at` in normal operation, since `started_at` was also set by `now()` in an earlier transaction; a database clock stepping backwards is the one case not ruled out.
- One open entry per link: unique index on `(link_id) where ended_at is null` (`20260922150000…:57-59`). The archived S-02 plan states the intent as a "database-level guarantee" (`context/archive/2026-09-22-first-timer-start/plan.md:44`).
- Timestamps are stamped by `now()` inside the SQL function, not by the client (`switch_timer` line 73; `start_timer` line 41 of the S-03 migration). A stop function following the pattern gets the same property.

### `switch_timer` is the template (`20260923120000_switch_timer.sql`)

- Signature and posture: `language plpgsql`, `security definer`, `set search_path = public` (lines 49-54).
- Serialization: `pg_advisory_xact_lock(hashtext('public.timer:' || p_link_id::text))` (line 63). S-03 generalized this key so `start_timer` and `switch_timer` share it (comment lines 1-6, `start_timer` line 25). A `stop_timer` that takes the same key serializes against both; a different key would let a stop race a switch.
- No-open-entry behavior: `raise exception 'no active timer to switch' using errcode = 'P0001'` (lines 69-71).
- Close: `update public.time_entries set ended_at = now() where id = v_open_id` (line 73).
- Return shape: `table (entry_id uuid, project_id uuid, project_name text, started_at timestamptz)` (line 50). A stop function has to choose its return shape (see Open Question 5).
- Grants: `revoke execute … from public, anon, authenticated; grant execute … to service_role` (lines 94-95).
- Latest migration timestamp on this branch is `20260923120000`; `parallel-goals.md:60` assigns `20260927…` to this lane. Existing migrations must not be edited (`parallel-goals.md:60`).

### TypeScript layer (`src/lib/timer.ts`)

- `NoActiveTimerError` (lines 19-25) is thrown by `switchTimer` when Postgres code is `P0001` (lines 88-89). In this file, `switchTimer` maps every `P0001` to it, without inspecting the message.
- `TimerAlreadyRunningError` (lines 12-17) is the model the goal cites for typed errors; it is start-only (`23505`, line 67).
- `parseTimerRow(fnName, data)` (lines 28-55) is the shared row validator, extracted in S-03 review finding F4 (`context/archive/2026-09-23-timer-switch-rounding/reviews/impl-review.md:80-88`), whose stated rationale was exactly that "the next RPC wrapper (S-04 stop)" would otherwise add a third copy. It requires all four of `entry_id`, `project_id`, `project_name`, `started_at`. A stop function returning that same four-column shape reuses it unchanged; any extra column (such as `ended_at`) requires extending the validator or a separate parser.
- `CurrentTimer` is `{ projectId, projectName, startedAt } | null` (line 9); `getCurrentTimer` selects the open row (lines 98-127).

### API routes (`src/pages/api/w/[token]/timer/`)

- `start.ts` and `switch.ts` share one skeleton: well-formed token check → `rewrite("/404")`; `findLinkByToken` (503 on failure, `rewrite("/404")` if not found); form-body validation; call; `redirect(…, 303)`; `ALL` returns 405 with `Allow: POST` (`switch.ts:12-59`, `start.ts:13-60`).
- `switch.ts:46-50` treats `NoActiveTimerError` as a silent redirect to the workspace ("race backstop, not a primary path"). A stop route has no request body (no project name), so the body-parsing and `isValidProjectName` block (`switch.ts:32-41`) does not apply; the same silent-redirect handling of "nothing to stop" is the consistent choice.
- The docstrings state the cookie is never trusted for authorization; the link is re-derived from the URL token (`switch.ts:8-11`).
- Neither `start.ts` nor `switch.ts` calls `logAccess` (inspected in full). A grep for `logAccess(` across `src/` finds three call sites, all in `src/pages/w/[token].astro` (lines 41, 44, 47), plus its definition at `src/lib/access-log.ts:15`; no API route logs access.

### Workspace page and card

- `[token].astro` computes `startAction` and `switchAction` (lines 61-62) and passes them to `WorkspaceCard` (lines 75-76). A stop route would need a `stopAction` alongside.
- `WorkspaceCard.astro` while tracking (lines 99-141): a "Currently tracking … started at HH:MM" line, then the switch section. There is no elapsed-time display and no stop control in this block. When `currentTimer` is null it renders the start form and project list (lines 142-183), so a successful stop returns the page to the start state with no further UI work.
- Start time is rendered in UTC on the server and rewritten to local time by the client script (lines 61-66, 271-280); the daily heading follows the same "server guesses in UTC, browser corrects" pattern (lines 50-52, 282-290). This is the only existing precedent for a time-dependent server/client split.
- The client script disables a form's submit button on `submit` for every `form` in the card (lines 260-269), so a stop form inherits double-submit protection without new code.
- `WorkspaceCard` is also rendered by `src/pages/dev/kitchen-sink.astro`, which has a "tracking" state (line 38) and passes `switchAction: "/dev/kitchen-sink"` in its shared props (line 29). A required new prop such as `stopAction` would have to be added there too (`astro check` would otherwise fail; not run here).
- `status-messages.ts` maps `?error=` and `?status=` codes to banner text (lines 1-19); today only `STATUS_PROJECT_DELETED` exists. A "timer stopped" banner is possible but nothing requires it.

### Tests

- pgTAP: `supabase/tests/database/switch_timer.test.sql` uses `begin; … rollback;` (lines 1, 152), fixed link ids `a0000000-…0004` and `…0005` (lines 11-13), `throws_ok` on `P0001` for no open timer (lines 78-83), and grant checks for `anon`/`authenticated`/`service_role` (lines 133-148). Its header comment says ids `…001`–`…003` belong to the other two test files (lines 7-10).
- Smoke: `scripts/smoke.mjs` runs the timer checks only when `SMOKE_SUPABASE_URL` and `SMOKE_SERVICE_ROLE_KEY` are set (skip message at line 154). The switch block ends at line 316 with "Acme Widgets" still running (lines 298-308), so a stop check appended inside the same gated block starts from a known running timer. It has a `timeEntries()` helper returning `all`/`open`/`closed` (lines 241-250) and a `request()` that returns response text (used at lines 274-275).
- Test-plan risks R-01 to R-04 are recorded in `context/foundation/test-plan.md`; none is about stopping or flagging. A case-insensitive grep of that file for `stop|long-running|flag|threshold|R-0[0-9]` matched only the "Stopper" project name (line 2), the R-0x identifiers, and one incidental "flag" in R-02's source line (line 24). S-04 therefore has no pre-declared risk entry.

### Prior decisions and constraints

- **Requirement text.** FR-004: "User can stop the timer, ending time tracking for the day; a timer running suspiciously long (e.g. past end of day) is flagged for correction rather than silently accruing hours" (`context/foundation/prd.md:72`). NFR: "Starting or stopping a timer is perceived as instantaneous" (`prd.md:89`), which a single POST-and-redirect matches.
- **Roadmap.** Outcome "stop the timer for the day and is prompted to correct a timer that has been running suspiciously long"; unknown: threshold, owner user, non-blocking; risk: "touches the same timer logic as S-03" (`roadmap.md:123-134`).
- **Deferred to this slice by earlier plans.** S-02 hid the pick UI while a timer runs "until switch (S-03) or stop (S-04) exist" (`context/archive/2026-09-22-first-timer-start/plan-brief.md:23`). S-03 listed "Stopping the timer or flagging long-running ones (S-04)" and "Any elapsed-time … display" as out of scope (`context/archive/2026-09-23-timer-switch-rounding/plan-brief.md:38-39`).
- **Time-zone question is open elsewhere.** The Mon–Sun/day boundary time zone is an unresolved S-06 unknown (`roadmap.md:156-157`), and the per-day rounding rule is deferred to S-06 for the same reason (`roadmap.md:119`). Any threshold phrased as "past end of day" depends on that answer; a duration threshold ("running longer than N hours") does not.
- **Lessons that apply** (`context/foundation/lessons.md`): a page with a form must use `Referrer-Policy: strict-origin`, never `no-referrer`, and every new form must be submitted in a real browser because smoke and curl set `Origin` themselves (lines 19-24; the workspace page already sets `strict-origin` at `[token].astro:16`); run `npx astro check` once before `astro dev` after config changes (lines 5-10). The migration-drop lesson (lines 12-17) does not apply, since this slice adds a function and drops nothing.
- **Sibling lanes.** `parallel-goals.md:61` names `src/pages/w/[token].astro` and `src/lib/timer.ts` as hot files touched by S-04, S-05, S-06 and S-07; edits should be small and additive.

## Code References

- `supabase/migrations/20260923120000_switch_timer.sql:49-95` — `switch_timer`: lock, open-entry lookup, `P0001`, `ended_at = now()`, grants; the template for `stop_timer`.
- `supabase/migrations/20260922150000_projects_and_timer.sql:57-59` — partial unique index, one open entry per link.
- `supabase/migrations/20260918082739_phase_b_c_purge_and_access_log.sql:9-16` — `time_entries` base columns including nullable `ended_at`.
- `src/lib/timer.ts:19-25, 28-55, 83-95, 98-127` — `NoActiveTimerError`, `parseTimerRow`, `switchTimer`, `getCurrentTimer`.
- `src/pages/api/w/[token]/timer/switch.ts:12-59` — route skeleton to copy for `stop.ts`.
- `src/pages/w/[token].astro:16-17, 55, 61-62, 68-78` — headers, the timer load, action URLs, card props.
- `src/components/WorkspaceCard.astro:99-141, 261-280` — tracking block (where a stop control and flag would go); submit-disable and time-localizing script.
- `src/pages/dev/kitchen-sink.astro:29, 38` — second consumer of `WorkspaceCard` props.
- `supabase/tests/database/switch_timer.test.sql:1-152` — pgTAP shape to mirror.
- `scripts/smoke.mjs:154, 241-250, 298-316` — gate, helper, and the end state a stop check can start from.
- `workers/purge-job/src/index.ts:9, 17` — 90-day purge keyed on `started_at`.
- `context/foundation/prd.md:72, 74, 89` — FR-004, FR-005, NFR.

## Architecture Insights

- **All timer writes go through service-role-only, security-definer SQL functions behind one per-link advisory lock**; TypeScript wrappers map Postgres error codes to typed errors; routes re-derive the link from the URL token and redirect with 303. A stop slice fits this shape without new patterns.
- **Race backstops are silent on the UI side.** Both existing routes redirect quietly on their "wrong state" errors, on the principle that the page already shows the true state (`switch.ts:46-50`, `start.ts:47-51`).
- **Structural prevention over special-casing.** S-03 excluded the running project from the switch list by id rather than handling same-project switches (`plan-brief.md:23`). The analogue for S-04: show the stop control only while a timer runs (the branch already exists at `WorkspaceCard.astro:99`).
- **Elapsed time and thresholds are new territory.** Nothing in `src` inspected computes a duration or holds a time-based constant; S-04 introduces the first one. `PURGE_AFTER_DAYS = 90` in the worker (`workers/purge-job/src/index.ts:9`) is the only named time constant in the code inspected, and it lives in a separate deployable.

## Historical Context (from prior changes)

- `context/archive/2026-09-22-first-timer-start/plan.md:33` — stop/flagging explicitly out of scope for S-02: **supported** (S-04 is the deferral target).
- `context/archive/2026-09-22-first-timer-start/plan.md:44, 66` — partial unique index as the one-open-entry guarantee: **supported**, still present at `20260922150000…:57-59`.
- `context/archive/2026-09-23-timer-switch-rounding/plan.md:9` — "`ended_at` … never used by any code path — nothing has ever closed an entry": **partially superseded**. It described the state before S-03; since `switch_timer` (`…:73`) exactly one path closes entries; there is still no stop.
- `context/archive/2026-09-23-timer-switch-rounding/plan-brief.md:39` — "no elapsed-time display": **still true** in `WorkspaceCard.astro:99-141`.
- `…/timer-switch-rounding/reviews/impl-review.md:86-88` — predicted a third copy of row validation at S-04: **superseded** by `parseTimerRow` (`src/lib/timer.ts:28-55`), which a same-shaped stop can reuse.
- `parallel-goals.md:58-65` — states migration prefix `20260927…` and hot-file guidance for this lane: **supported** by the file listing.

## Related Research

- `context/archive/2026-09-23-first-timer-start-audit/research.md` — audit of S-02 (mostly about deletion and FKs, relevant to S-10 rather than S-04). Not reread for this document.

## Open Questions

1. **Threshold value (user-owned, non-blocking per `roadmap.md:132`).** What counts as "suspiciously long"? No default exists in the code. The plan should propose one named constant and surface it in plan-review (`parallel-goals.md:88`).
2. **Threshold definition: elapsed duration vs. "past end of day".** FR-004 gives "past end of day" only as an example (`prd.md:72`). An elapsed-duration rule needs no time zone; an end-of-day rule needs the same time-zone decision S-06 has open (`roadmap.md:157`). Where the flag is evaluated (server at render, or the client script, since a page left open in a tab does not re-render) is also undecided.
3. **What can the user do when flagged?** S-05 (corrections) does not exist yet. With only S-04, "Stop" closes the entry at `now()`, which records the whole excess duration; letting the user stop at an earlier time is a correction and overlaps FR-005/S-05 (`prd.md:74`). The plan has to decide whether S-04's prompt is (a) a warning plus the normal Stop, with correction left to S-05, or (b) a stop that accepts an end time, and how (b) avoids becoming S-05's job (the roadmap's stated S-05 risk: "must not become a substitute for live tracking", `roadmap.md:145`).
4. **Persistence of the flag.** Not answered by the code: whether the flag is purely derived (`now() − started_at > threshold`, nothing stored) or recorded on the entry. The inspected schema has no flag column; deriving avoids a migration column but means a stopped-late entry carries no marker for later review (relevant to S-05/S-06).
5. **`stop_timer` return shape.** Same four columns as `switch_timer` (reuses `parseTimerRow` unchanged) versus adding `ended_at` (needs validator changes). Not decided by anything inspected.
6. **Confirmation and feedback UX.** FR-002 rejected extra confirmation for starting (`prd.md:69`); nothing says whether Stop wants one, or a "stopped" banner (a `STATUS_*` code would fit `status-messages.ts:15-19`).
7. **Edge, out of scope but adjacent.** The purge worker deletes by `started_at < cutoff` with no `ended_at` condition (`workers/purge-job/src/index.ts:17`), so an open entry older than 90 days would also be purged; this is S-08's territory, noted only because a forgotten, never-stopped timer is exactly S-04's failure case.
