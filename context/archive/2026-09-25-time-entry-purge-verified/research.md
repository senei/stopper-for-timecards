---
date: 2026-09-25T09:43:00+02:00
researcher: Claude (claude-sonnet-5)
git_commit: b2e18b39d8b8217b69519fe81ba184a7311e1cde
branch: time-entry-purge-verified
repository: x10-dev--curse (Stopper for Timecards)
topic: "S-08: what does re-pointing the purge worker at the real time_entries model actually require, and how is it verified?"
tags: [research, codebase, purge-job, time_entries, job_runs, supabase, pgTAP, S-08, FR-008]
status: complete
last_updated: 2026-09-25
last_updated_by: Claude (claude-sonnet-5)
---

# Research: S-08 purge worker vs the real time_entries model

**Date**: 2026-09-25T09:43:00+02:00
**Git Commit**: b2e18b39d8b8217b69519fe81ba184a7311e1cde (worktree clean at research time, plus untracked `change.md`)
**Branch**: time-entry-purge-verified

## Research Question

Roadmap S-08 says the purge worker "targets a placeholder table" and must be "re-pointed at the real entry model and verified end to end in production, including that projects are untouched" (`context/foundation/roadmap.md:173-183`). The Lane 1 goal (`context/foundation/parallel-goals.md:71-73`) adds: keep `projects` untouched, add a pgTAP test (entries older than 90 days deleted, newer entries and all projects survive), and verify a manual scheduled run writes a `job_runs` row with status `success`. What does the code look like today, what actually needs to change, and what is decisive for the plan?

## Summary

- **The premise "re-point the worker" is largely stale.** On the inspected path (`workers/purge-job/src/index.ts`, whole file, 37 lines) the worker names only `time_entries`, `started_at`, and `job_runs`. It does not reference the `project` column that migration `20260922150000` dropped, nor any `projects` table. So the current worker code needs zero column changes to match the real schema; the "placeholder" language is in the *migration comment* (`20260918082739…sql:4-8`), not in the worker.
- **Projects cannot be touched by the worker as written.** The only table it deletes from is `time_entries` (`index.ts:17`). `time_entries.project_id` is a FK *to* `projects` with no `ON DELETE` clause (`20260922150000…sql:42`), so deleting entries never cascades to a project; the direction of the FK protects the parent.
- **What is genuinely missing is verification, not re-pointing.** Among the four files in `supabase/tests/database/` (`delete_project`, `private_links`, `projects_and_timer`, `switch_timer`), none tests the purge; the only `job_runs` reference is an RLS check (`private_links.test.sql:43-54`). `scripts/smoke.mjs` has no purge or `job_runs` reference. The only recorded purge verification is the 2026-09-18 run against an empty placeholder table (`rows_affected: 0`, `context/deployment/deploy-plan.md:174,204`).
- **A pgTAP test cannot exercise the worker's delete as it exists.** The delete is a PostgREST call from TypeScript (`index.ts:17`), not a SQL function. To test "older than 90 days deleted, newer kept, projects survive" in pgTAP the plan must either (a) extract the delete into a `security definer` SQL function the worker calls (matching the `start_timer` / `switch_timer` pattern), or (b) test an SQL statement that duplicates the worker's predicate. This is the central design choice for the plan.
- **Several correctness gaps in the worker are visible and relevant to "verified"** (see Detailed Findings): 90 days is not "3 calendar months"; the delete has no row cap and no check against open entries; the `job_runs` insert result is unchecked; and the run is only recorded at the end, so a crash before the insert leaves no row.
- **Not established from the repo:** whether the deployed purge Worker and the remote Supabase schema currently match `main`. Production verification needs a live check (see Open Questions).

## Detailed Findings

### Worker code (`workers/purge-job/`)

- Retention constant: `PURGE_AFTER_DAYS = 90` (`workers/purge-job/src/index.ts:9`); cutoff is `now - 90 * 24h` as an ISO string (`index.ts:15`).
- The delete: `supabase.from("time_entries").delete({ count: "exact" }).lt("started_at", cutoff)` (`index.ts:17`). Filter is on `started_at` only. It does not look at `ended_at`, `link_id`, or any project column.
- Outcome logging: one `job_runs` insert after the delete with `job_name: "purge_time_entries"`, `started_at`, `finished_at`, `status` (`success` or `error`), `rows_affected: count ?? 0`, `error_message` (`index.ts:21-28`). The insert's own `error` is not read (`index.ts:21` assigns nothing), so a failed log write is silent. No `running` row is written up front even though the table permits `status = 'running'` (`20260918082739…sql:29`), so a Worker that dies between the delete and the insert leaves no trace in `job_runs`.
- `console.error` fires only when the delete errors (`index.ts:30-35`); the comment there states free-tier logs are not persisted and `job_runs` is the durable record.
- Cron: `"0 3 * * *"` (daily 03:00 UTC) with observability enabled (`workers/purge-job/wrangler.jsonc:7-12`). The worker is a separate Worker (`name: stopper-for-timecards-purge`, `wrangler.jsonc:3`), with its own secrets store (`context/deployment/deploy-plan.md:171`).
- The worker has no `package.json` of its own; `@supabase/supabase-js` comes from the root `package.json:25`. The root `tsconfig.json` includes `**/*`, so `astro check` type-checks this file too.

### Schema the worker runs against

- `time_entries` was created as a "MINIMAL PLACEHOLDER" (`supabase/migrations/20260918082739…sql:4-16`) with an index on `started_at` (`:18`) and on `link_id` (`:19`). Migration `20260922150000` dropped only the `project` column (`:37`) and added `project_id` (FK to `projects`), `project_name`, `task`, `type`, `work_type` (`:41-46`), a `link_id` FK to `links` (`:48-50`), and a partial unique index allowing at most one row per `link_id` with `ended_at is null` (`:57-59`). The `started_at` index that the purge predicate relies on is not dropped by any statement in that file.
- `projects` has `link_id uuid not null references links (id)` (`:15`) and no relationship that the purge touches.
- `job_runs` (`20260918082739…sql:24-32`) has `status` constrained to `('running','success','error')`, `rows_affected integer`, and an index on `(job_name, started_at desc)` (`:34`).
- RLS is enabled with no policies on `links`, `access_log`, `time_entries`, `job_runs` (`20260921120000_private_links.sql:44-47`). The service-role key used by the worker bypasses RLS, which the archived private-link plan states explicitly (`context/archive/2026-09-21-private-link-access/plan.md:332`).

### Interaction with neighbouring slices

- **S-09 (delete-project, archived):** deleting a project with any `time_entries` row (open or closed) fails with SQLSTATE `23503` (`supabase/tests/database/delete_project.test.sql:29-60`). Its plan noted the "unused project" success path is reachable in the shipped app only once S-08 purges old entries (`context/archive/2026-09-23-delete-project/plan-brief.md:57`). So after S-08's purge runs, a project whose entries have all aged out becomes deletable, which is consistent with PRD FR-009 and NFR "project definitions persist indefinitely" (`context/foundation/prd.md:82,92`).
- **PRD wording:** FR-008 says "older than 3 months" (`prd.md:81`); the NFR says entries are "retained for at least 3 months before they may be purged" (`prd.md:91`). With a fixed 90-day cutoff, the retained span is shorter than 3 calendar months for some month combinations (a 3-month span can be 92 days, e.g. July to October). The "at least" wording therefore sits uneasily with `PURGE_AFTER_DAYS = 90`. Whether 90 days is acceptable is a product decision, not something the code can settle.
- **Open running entries:** the predicate filters only on `started_at`, so an entry whose `started_at` is over 90 days old and whose `ended_at` is still null would be deleted. Under the one-open-entry-per-link index (`20260922150000…sql:57-59`) such a row can exist only if a timer has been left running that long; S-04 (`timer-stop-and-flags`) adds a flag for suspiciously long timers, which may reduce but not eliminate the case.

### Test and CI coverage

- pgTAP tests run in CI via `npx supabase test db` (`.github/workflows/ci.yml:43-44`); the smoke job runs `npm run smoke` against a local Supabase (`ci.yml:52-58`). Neither builds or runs the Worker.
- Existing tests follow one pattern: `begin; … create extension if not exists pgtap …; select plan(n); …; finish(); rollback;` with fixed, non-colliding UUIDs per file (e.g. `switch_timer.test.sql:1-13` uses `…0004`/`…0005`; `delete_project.test.sql` uses `…0002`/`…0003`; `projects_and_timer.test.sql` uses `…0001`). A new purge test needs its own distinct IDs.
- Tests can only call SQL, so the Worker's `scheduled()` path (TypeScript) is verified by other means: the deploy plan's local method was `wrangler dev --config wrangler.jsonc --test-scheduled` plus `curl …/cdn-cgi/local/scheduled` (`deploy-plan.md:173`), and reading `job_runs` through REST (`:174`).

### Infra constraints recorded earlier

- `context/foundation/infrastructure.md:57` warns the purge runs in a cron Worker with a CPU-time ceiling and that a single invocation could time out if the entries table grows before the query is optimized, with no built-in retry; `:105` makes `job_runs` the mitigation for silent failure; `:89` classes any change to the Cron Trigger schedule as human-reviewed.
- This slice's own roadmap entry lists no unknowns or blockers (`roadmap.md:180-181`) and prerequisite S-02 is done (`parallel-goals.md:12`).

## Code References

- `workers/purge-job/src/index.ts:9` - `PURGE_AFTER_DAYS = 90`
- `workers/purge-job/src/index.ts:15` - cutoff computed in the Worker, not in SQL
- `workers/purge-job/src/index.ts:17` - the only delete: `time_entries` where `started_at < cutoff`
- `workers/purge-job/src/index.ts:21-28` - `job_runs` insert (result unchecked)
- `workers/purge-job/wrangler.jsonc:7-9` - daily 03:00 UTC cron
- `supabase/migrations/20260918082739_phase_b_c_purge_and_access_log.sql:4-34` - placeholder `time_entries`, `job_runs`
- `supabase/migrations/20260922150000_projects_and_timer.sql:37-59` - real `time_entries` columns, FKs, open-entry index
- `supabase/migrations/20260921120000_private_links.sql:44-47` - RLS with no policies on `time_entries`, `job_runs`
- `supabase/tests/database/delete_project.test.sql:29-60` - FK protects projects that have entries
- `supabase/tests/database/private_links.test.sql:43-54` - only existing `job_runs` reference in tests (RLS)
- `context/foundation/prd.md:81,91,92` - FR-008 and retention NFRs
- `context/deployment/deploy-plan.md:159-174,204` - how Phase B was built and verified (empty table)

## Architecture Insights

- The app's convention for anything with an invariant is a `security definer` SQL function granted only to `service_role`, tested in pgTAP (`start_timer`, `switch_timer`; `create_link`). The purge is the exception: its logic lives in TypeScript, so the "no test proves it" gap follows from that choice. Moving the delete into a function would put it under the same testing pattern; leaving it in the Worker keeps the change smaller but means pgTAP can only cover a copy of the predicate.
- All data access is service-role-only with RLS and no policies, so the worker needs no new grants for `time_entries`/`job_runs` on the inspected path.
- The purge is intentionally a separate Worker with separate secrets; anything the plan changes about the worker must be deployed with `wrangler deploy --config wrangler.jsonc` from `workers/purge-job/` (`deploy-plan.md:177`) and is not covered by Cloudflare Builds for the main app as far as this repo shows.

## Historical Context (from prior changes)

- `context/deployment/deploy-plan.md:170` - the worker was written against the placeholder table and verified with `rows_affected: 0` on 2026-09-18; that claim ("a manual run produces a `job_runs` success row") is supported for the empty-table case only, and says nothing about deleting real rows.
- `context/archive/2026-09-23-delete-project/plan.md:33` - S-09 explicitly kept the purge worker out of scope. `git log -- workers` lists three commits: `57fc5e6` (Phase B, initial), `e59845d` (private-link-access p1; a 1-insertion/4-deletion edit to `workers/purge-job/src/index.ts`, content not inspected, so it is not established here what it changed), and `d090e58` (whitespace/`eslint-disable` cleanup in the generated `worker-configuration.d.ts` only). No commit since `e59845d` touches the worker's `src/`.
- `context/archive/2026-09-21-private-link-access/plan.md:332` - RLS enablement was assessed as not affecting the purge worker.
- No prior `context/changes/**` or `context/archive/**` folder is named for S-08; nothing there records a purge design decision beyond the above.

## Related Research

- `context/archive/2026-09-23-first-timer-start-audit/research.md` - FK and `access_log` findings relevant to S-10, not to S-08.

## Open Questions

1. **Where should the delete live?** SQL `security definer` function called by the worker (testable in pgTAP, matches repo pattern, changes the worker call) vs keep the PostgREST delete and test a duplicated predicate. Needs a plan decision.
2. **90 days vs 3 calendar months.** Keep `PURGE_AFTER_DAYS = 90`, or compute a calendar-month cutoff (`now() - interval '3 months'`) to honour the PRD's "at least 3 months"? Product decision; the Lane 1 goal text already says "older than 90 days".
3. **Open entries older than the cutoff:** delete them, or restrict the predicate to closed entries (`ended_at is not null`) or key on `ended_at`/`started_at`? Not specified by the PRD.
4. **Failure recording:** should the worker check the `job_runs` insert error and/or write a `running` row first so a crash is detectable? Related to `infrastructure.md:105`.
5. **Batching:** is a single unbounded delete acceptable given `infrastructure.md:57`, at this app's scale (10-user cap per `prd.md:78`)? Not measured.
6. **Production state is unverified here.** Not established from the repo: whether the remote Supabase has migrations through `20260923120000` applied, whether the deployed `stopper-for-timecards-purge` Worker is the current code, and whether its Cron Trigger is active. "Verify in production" needs a live check (`npx supabase migration list`, `wrangler deployments list --config wrangler.jsonc`, a manually triggered scheduled run, then reading `job_runs`), which involves the user's remote accounts and should be human-approved.
7. **How to verify the Worker's `scheduled()` path in CI or locally:** the deploy plan's `wrangler dev --test-scheduled` route exists, but nothing runs it automatically; whether the plan should add a scripted local check (e.g. a smoke-style script seeding old and new rows through the service role, invoking the scheduled route, and asserting counts and the `job_runs` row) is open.
