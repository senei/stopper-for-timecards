# Time Entry Purge Verified Implementation Plan

## Overview

Roadmap slice S-08 (FR-008): entries older than 3 months are purged automatically while projects stay. The purge worker already deletes from the real `time_entries` table, so this change is mostly about proving it. The delete moves into a tested SQL function with two rule changes agreed in planning (calendar 3-month cutoff, open entries never purged), and the worker gains a durable run log (`running` row, then finalised) so a crashed or failed run is visible.

## Current State Analysis

- The worker's only delete is `time_entries` where `started_at < now - 90 days`, sent as a PostgREST call from TypeScript (`workers/purge-job/src/index.ts:9,15,17`). It never references the `project` column dropped by `20260922150000_projects_and_timer.sql:37`, nor any `projects` table, so no column re-pointing is needed.
- Projects cannot be reached by that delete, and `time_entries.project_id` is an FK to `projects` with no `ON DELETE` clause (`20260922150000_projects_and_timer.sql:42`), so deleting entries never cascades upward.
- No pgTAP test or smoke check covers the purge (`supabase/tests/database/*`, `scripts/smoke.mjs`); the only recorded run is 2026-09-18 against an empty table, `rows_affected: 0` (`context/deployment/deploy-plan.md:174,204`).
- The `job_runs` insert result is unchecked (`index.ts:21-28`) and no `running` row is written first, although the table allows that status (`20260918082739_phase_b_c_purge_and_access_log.sql:29`).
- The delete matches rows on `started_at` alone, so an entry with `ended_at is null` and an old `started_at` would be deleted; PRD FR-008 says "older than 3 months" and the NFR says "retained for at least 3 months" (`context/foundation/prd.md:81,91`), which 90 days can undercut by up to 2 days.
- Full evidence: `context/changes/time-entry-purge-verified/research.md`.

## Desired End State

- `purge_time_entries()` exists in the database, granted only to `service_role`. It deletes closed entries whose `started_at` is before now minus 3 calendar months, returns the deleted count, and touches nothing else.
- The worker calls it via `rpc`, records every run in `job_runs` (`running` row first, finalised to `success` or `error`), and fails loudly if either write fails.
- A new pgTAP file proves the rule at its boundaries; the worker's scheduled path is proven locally end to end; production is verified by the user in Phase 3.
- Verify: `npx supabase test db` passes, `npm run lint`, `npx astro check` and `npm run build` pass, and a local scheduled run leaves a `job_runs` row with `status = 'success'` and a matching `rows_affected`.

### Key Discoveries:

- Existing convention for anything with an invariant is a `security definer` function, `revoke … from public, anon, authenticated`, `grant … to service_role`, with pgTAP privilege checks (`20260923120000_switch_timer.sql:94-95`, `switch_timer.test.sql:134-148`). The purge follows it.
- The worker calls `admin.rpc(...)` and checks `response.error` elsewhere in the app (`src/lib/timer.ts:65-68`); the worker uses supabase-js directly, no shared helper.
- Test files use fixed, non-colliding UUIDs (`…0001` to `…0005` for links, `b…0001`/`b…0002` for projects are taken); the new test needs its own.
- Tests run in one transaction, so `now()` is constant inside a test; an entry set to exactly `now() - interval '3 months'` sits exactly on the function's cutoff.
- One open entry per link is enforced by a partial unique index (`20260922150000_projects_and_timer.sql:57-59`); fixtures with an old open entry need their own link.

## What We're NOT Doing

- No change to the cron schedule (`workers/purge-job/wrangler.jsonc:7-9`); schedule changes are human-reviewed (`context/foundation/infrastructure.md:89`).
- No purging of `projects`, `links` or `access_log`; PRD says project definitions persist indefinitely (`prd.md:92`).
- No batching or row cap on the delete; unmeasured, and the app is capped at 10 users (`prd.md:78`).
- No alerting, stale-`running`-row cleanup or dashboard for `job_runs`; a stuck `running` row is simply visible when someone reads the table.
- No synthetic old rows in production to force a real deletion there; that would need a test link, which permanently uses one of the 10 slots. Deletion is proven by pgTAP and the local end-to-end run; production proves the deployed path runs and records `success`.
- No smoke-script or CI job that runs the Worker; Phase 2 verification is a manual local run.
- Ageing by `ended_at`, and purging abandoned open entries, are declined (planning decisions); S-04's long-timer flag is the route for those.
- Not deploying, pushing or archiving in the `/goal` lane; Phase 3 is run by the user.

## Implementation Approach

Database contract first (cheap to review, proven by pgTAP), then the worker on top of it, then production. The retention rule lives in SQL so the test and production run the same code; the worker becomes a thin scheduler that owns run logging. Rule changes agreed in planning: cutoff is `now() - interval '3 months'` (calendar months, not 90 days), strict less-than so an entry exactly on the cutoff is kept, and only entries with `ended_at is not null` are eligible. Accepted consequence: a timer left open past the cutoff and stopped later becomes eligible immediately and is deleted at the next scheduled run; flagging such timers is S-04's job, not this change's.

## Critical Implementation Details

- **Timing & lifecycle**: production rollout order is migration, then worker deploy. The old worker still works against the new schema, but the new worker calls a function that does not exist until the migration is applied.
- **State sequencing**: the `running` row is inserted before the purge is called. If that insert fails, the run aborts before deleting anything, so no data is ever purged without a record.
- **Month arithmetic**: `timestamptz - interval '3 months'` uses the session time zone for the month step; Supabase sessions default to UTC. Compute the cutoff in one place inside the function, and have the test build its fixtures with the same expression rather than hard-coded dates.

## Phase 1: Purge function and pgTAP proof

### Overview

Add the database function that owns the retention rule and prove it with pgTAP, before touching the worker.

**Worktree prerequisites (Phases 1–2):** this worktree has no `node_modules`, so run `npm ci` first; Docker must be running and local Supabase started with `npx supabase start`. No `.env` is needed for the build (every env field in `astro.config.mjs:19-24` is optional).

### Changes Required:

#### 1. Purge function migration

**File**: `supabase/migrations/20260925120000_purge_time_entries.sql` (new; the lane's `20260925…` prefix per `context/foundation/parallel-goals.md:60`)

**Intent**: Add `purge_time_entries()` which deletes eligible entries and returns how many were deleted, following the `switch_timer` pattern. Never edit an existing migration.

**Contract**: `purge_time_entries() returns integer`, `language plpgsql`, `security definer`, `set search_path = public`. Deletes from `public.time_entries` only, where `ended_at is not null and started_at < now() - interval '3 months'`. No arguments. `revoke execute … from public, anon, authenticated; grant execute … to service_role`. It does not read or write `projects` or `job_runs`. Header comment states the two rules (calendar 3 months, open entries kept), notes the accepted consequence that an old timer stopped later is purged at the next run, and cites PRD FR-008 and the NFR.

#### 2. pgTAP test

**File**: `supabase/tests/database/purge_time_entries.test.sql` (new)

**Intent**: Prove the retention rule and privileges, in the style of the neighbouring test files (transaction, `pgtap` extension, fixed IDs, rollback).

**Contract**: fixtures use link IDs `a0000000-…-000000000006` and `…007` and project IDs starting at `b0000000-…-000000000006`, distinct from existing files; fixture dates are built from `now() - interval '3 months'`, not literals. Named tests:
- a closed entry older than the cutoff is deleted
- a closed entry newer than the cutoff is kept
- a closed entry exactly on the cutoff is kept
- a closed entry one second older than the cutoff is deleted
- an open entry (`ended_at is null`) older than the cutoff is kept
- every project row still exists afterwards, including one whose only entries were purged
- the returned count equals the number of deleted entries, and a second call returns 0
- anon and authenticated cannot execute the function; service_role can

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly to a fresh local database: `npx supabase db reset`
- The pgTAP suite passes including the new purge test: `npx supabase test db`

#### Manual Verification:

- The migration deletes only from `time_entries` and never references `projects`, and its grants match the `switch_timer` pattern

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Worker on the function, with run logging

### Overview

Switch the worker to the function and record each run durably; verify the scheduled path end to end against local Supabase.

### Changes Required:

#### 1. Worker scheduled handler

**File**: `workers/purge-job/src/index.ts`

**Intent**: Remove the hard-coded 90-day cutoff and direct delete; call the database function, and make the `job_runs` log trustworthy: written before the purge, finalised after, every write checked.

**Contract**: `scheduled()` flow: (1) insert a `job_runs` row `{ job_name: "purge_time_entries", started_at, status: "running" }` selecting its `id`; if this fails, throw before any purge. (2) `supabase.rpc("purge_time_entries")`; on success the data is the deleted count. (3) update that row by `id` with `finished_at`, `status` (`success` or `error`), `rows_affected` (count, or 0 on error) and `error_message`; if the update fails, `console.error` and throw. (4) After recording an rpc error, `console.error` and throw so the invocation shows as failed in Cloudflare's cron events. The job name string `purge_time_entries` is unchanged so existing rows stay in one series. `PURGE_AFTER_DAYS` is deleted; the retention rule now lives only in the migration.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes, including the worker file: `npx astro check`
- Production build passes: `npm run build`

#### Manual Verification:

- Local end-to-end: with local Supabase seeded with an old closed entry, a recent closed entry, an old open entry and their projects, a scheduled run (`wrangler dev --config wrangler.jsonc --test-scheduled --port 8799` from `workers/purge-job/`, then the `/cdn-cgi/local/scheduled` route) returns outcome ok, deletes only the old closed entry, and leaves every other entry and every project
- That run leaves exactly one new `job_runs` row for `purge_time_entries` with `status = 'success'`, `finished_at` set and `rows_affected` equal to the number deleted, and no row stuck at `running`
- With an invalid `SUPABASE_SERVICE_ROLE_KEY` the scheduled run reports a failed outcome and deletes nothing
- With `purge_time_entries` dropped from the local database, a scheduled run reports a failed outcome, leaves one `job_runs` row with `status = 'error'` and a non-empty `error_message`, and leaves no row at `running` (then restore the database with `npx supabase db reset`)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Local run notes: `workers/purge-job/.dev.vars` is gitignored and not present in this worktree, so create it with **local** Supabase values only (`npx supabase status -o env`), never the production service-role key; seed rows through the local REST API with the service-role key as `scripts/smoke.mjs` does; on Windows, repeated `wrangler dev` restarts can leave orphaned `workerd.exe` processes holding the port (`deploy-plan.md:173`).

---

## Phase 3: Production rollout and verification (run by the user)

### Overview

Apply the migration, deploy the worker and confirm a real scheduled run. Human-run, from the **main checkout after the PR is merged**: only reviewed code reaches production, and the Supabase project link (gitignored `supabase/.temp`) exists in the main checkout, not in this worktree. The `/goal` lane stops before this phase (no deploy, no push), and remote database and Cloudflare changes need the user's approval.

### Changes Required:

#### 1. Rollout steps

**File**: none (operations on the remote Supabase project and the `stopper-for-timecards-purge` Worker)

**Intent**: Ship in the safe order and check that the deployed job records a successful run without touching projects.

**Contract**: run from the main checkout on the merged `main`. Order is fixed: `npx supabase db push` (migration first), then `npx wrangler deploy --config wrangler.jsonc` from `workers/purge-job/`. The cron trigger stays `0 3 * * *`. A run is triggered either by waiting for the next 03:00 UTC or by the local `--test-scheduled` route pointed at production values, as done on 2026-09-18 (`deploy-plan.md:173-174`). Verify by reading `job_runs` (newest row for `purge_time_entries`) through the Supabase REST API or SQL editor.

### Success Criteria:

#### Automated Verification:

_(none — this phase touches remote systems and is verified by the user)_

#### Manual Verification:

- `npx supabase migration list` shows `20260925120000` applied both locally and remotely after `npx supabase db push`
- `npx wrangler deploy --config wrangler.jsonc` from `workers/purge-job/` exits 0 and the Cron Trigger `0 3 * * *` is still registered on the Worker
- A production scheduled run adds a newest `job_runs` row for `purge_time_entries` with `status = 'success'`, `finished_at` set and an integer `rows_affected` (0 is expected while no entry is older than 3 months), with no row left at `running`
- The production `projects` row count is the same before and after that run

**Implementation Note**: The `/goal` lane is done at the end of Phase 2. Run this phase yourself, then archive with `/10x-archive` on `main` after merge.

---

## Testing Strategy

### Unit Tests:

- pgTAP `purge_time_entries.test.sql` as listed in Phase 1: boundary (exactly on cutoff kept, one second older deleted), closed vs open, projects survive, count and idempotence, privileges.

### Integration Tests:

- Local scheduled run against local Supabase (Phase 2 manual criteria), covering the worker, the rpc, and the `running` to `success` log lifecycle.
- No CI job runs the Worker; CI runs pgTAP (`.github/workflows/ci.yml:43-44`) and will run the new test file automatically.

### Manual Testing Steps:

1. Seed local rows (old closed, recent closed, old open, plus projects) via the local REST API.
2. Run the scheduled route and inspect `time_entries`, `projects` and `job_runs`.
3. Repeat with a bad service-role key and confirm a failed outcome and no deletion.

## Performance Considerations

The `time_entries_started_at_idx` index (`20260918082739…sql:18`) still exists after the S-02 migration, so the cutoff predicate can use it. Single unbatched delete is accepted at this scale (see "What We're NOT Doing"); the infrastructure risk of a cron CPU ceiling (`infrastructure.md:57`) is unchanged and unmeasured.

## Migration Notes

Additive migration only (new function); no existing rows or tables change. The old worker keeps working against the new schema, so rollback of the worker is a redeploy of the previous version; the function can be left in place or dropped by a later migration.

## References

- Related research: `context/changes/time-entry-purge-verified/research.md`
- Lane goal and collision rules: `context/foundation/parallel-goals.md:69-73`
- Roadmap item: `context/foundation/roadmap.md:173-183`
- PRD: `context/foundation/prd.md:81,91,92`
- Similar implementation: `supabase/migrations/20260923120000_switch_timer.sql`, `supabase/tests/database/switch_timer.test.sql`
- Previous worker verification: `context/deployment/deploy-plan.md:159-174,204`

## Loose Ends

Recorded after the implementation review (2026-09-25, `reviews/impl-review.md`, APPROVED). None of these change the plan's scope or Progress rows.

- **Phase 3 was run on 2026-09-25 (rows 3.1 to 3.4, confirmed by the user).** From the main checkout after PR #11 merged (`24d8c42`): `npx supabase db push` applied three migrations, not one (`20260922150000`, `20260923120000` and `20260925120000`; production still had the S-02/S-03 schema pending, and its `time_entries` was empty, so the column changes were data-safe). `wrangler deploy` published Worker version `8660b555-1aa4-42d9-9394-533fa3c9fbda` with the cron `0 3 * * *` intact. One run was triggered from a local copy of the code against production (`--test-scheduled`, as on 2026-09-18): `job_runs` went from 8 to 9 rows, the new row is `success` with `rows_affected = 0`, none stuck at `running`. Production had 0 projects and 0 time entries before and after, so the "projects unchanged" check (3.4) is trivial until real data exists. The deployed Worker's own 03:00 UTC cron run was not yet observed at the time of writing.
- **Archive after merge.** `/10x-archive` on `main` is what flips the roadmap's S-08 item; per `context/foundation/parallel-goals.md` no lane edits `roadmap.md` before that, so it still says `proposed`.
- **The shared local Supabase may no longer have this migration.** All worktrees share one local instance (`project_id = "10x-astro-starter"` in `supabase/config.toml`), and another lane's `db reset` removed `purge_time_entries` from it. Restore it with `npx supabase db reset` from this branch, or use a scratch copy of `supabase/` with its own `project_id` and ports, which is how the Phase 2 manual checks were run without collisions.
- **Local-only files left out of every commit.** `.claude/settings.local.json` (session permission grants). `workers/purge-job/.dev.vars` (gitignored; holds only the local demo key and points at a Supabase instance that has since been stopped, so repoint or delete it before reusing it, and never copy a production key into a worktree).
- **Slow, fragile commands on a fresh worktree.** `npm ci` is required first; `npx astro sync` must run before lint (CI does this at `.github/workflows/ci.yml:19`) and hung for about 20 minutes here; a cold `npm run lint` took about 15 minutes. The `delete-account` lane's plan runs lint once in its last code phase for the same reason; this plan already does (criterion 2.1).
- **Lessons not yet recorded** in `context/foundation/lessons.md` (use `/10x-lesson`): worktrees share one local Supabase through `project_id`, so a reset in one lane breaks the others; lint needs `astro sync` first and is very slow on a fresh worktree; `psql`-applied function changes may not reach PostgREST's schema cache until `notify pgrst, 'reload schema'`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Purge function and pgTAP proof

#### Automated

- [x] 1.1 Migration applies cleanly to a fresh local database: `npx supabase db reset` — c02c6ca
- [x] 1.2 The pgTAP suite passes including the new purge test: `npx supabase test db` — c02c6ca

#### Manual

- [x] 1.3 The migration deletes only from `time_entries` and never references `projects`, and its grants match the `switch_timer` pattern — c02c6ca

### Phase 2: Worker on the function, with run logging

#### Automated

- [x] 2.1 Linting passes: `npm run lint` — 1aa7c96
- [x] 2.2 Type checking passes, including the worker file: `npx astro check` — 1aa7c96
- [x] 2.3 Production build passes: `npm run build` — 1aa7c96

#### Manual

- [x] 2.4 Local end-to-end: with local Supabase seeded with an old closed entry, a recent closed entry, an old open entry and their projects, a scheduled run (`wrangler dev --config wrangler.jsonc --test-scheduled --port 8799` from `workers/purge-job/`, then the `/cdn-cgi/local/scheduled` route) returns outcome ok, deletes only the old closed entry, and leaves every other entry and every project — 1aa7c96
- [x] 2.5 That run leaves exactly one new `job_runs` row for `purge_time_entries` with `status = 'success'`, `finished_at` set and `rows_affected` equal to the number deleted, and no row stuck at `running` — 1aa7c96
- [x] 2.6 With an invalid `SUPABASE_SERVICE_ROLE_KEY` the scheduled run reports a failed outcome and deletes nothing — 1aa7c96
- [x] 2.7 With `purge_time_entries` dropped from the local database, a scheduled run reports a failed outcome, leaves one `job_runs` row with `status = 'error'` and a non-empty `error_message`, and leaves no row at `running` (then restore the database with `npx supabase db reset`) — 1aa7c96

### Phase 3: Production rollout and verification (run by the user)

#### Manual

- [x] 3.1 `npx supabase migration list` shows `20260925120000` applied both locally and remotely after `npx supabase db push`
- [x] 3.2 `npx wrangler deploy --config wrangler.jsonc` from `workers/purge-job/` exits 0 and the Cron Trigger `0 3 * * *` is still registered on the Worker
- [x] 3.3 A production scheduled run adds a newest `job_runs` row for `purge_time_entries` with `status = 'success'`, `finished_at` set and an integer `rows_affected` (0 is expected while no entry is older than 3 months), with no row left at `running`
- [x] 3.4 The production `projects` row count is the same before and after that run
