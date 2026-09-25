# Time Entry Purge Verified — Plan Brief

> Full plan: `context/changes/time-entry-purge-verified/plan.md`
> Research: `context/changes/time-entry-purge-verified/research.md`

## What & Why

Roadmap slice S-08 (FR-008): time entries older than 3 months are purged automatically while projects stay. The purge worker already exists, so the work is to make its rule testable and provable, tighten two rule gaps found in research, and make failed or crashed runs visible.

## Starting Point

The worker (`workers/purge-job/src/index.ts`) already deletes from the real `time_entries` table using `started_at` and a 90-day cutoff; it never touches projects and needs no column re-pointing. Nothing tests it, the only past run was against an empty table, and its `job_runs` write is unchecked.

## Desired End State

A `service_role`-only SQL function `purge_time_entries()` owns the rule and is covered by pgTAP. The worker calls it and records each run (`running`, then `success` or `error`). Old closed entries disappear, everything else survives, and a local scheduled run plus a production run both leave a `success` row in `job_runs`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Where the delete lives | SQL function called via `rpc` | pgTAP can test the exact code that runs, matching `start_timer` / `switch_timer`. | Plan |
| Retention window | Calendar 3 months (`now() - interval '3 months'`) | PRD says "at least 3 months"; 90 days can undercut that by up to 2 days. | Plan (from Research) |
| Boundary | Strict less-than: an entry exactly on the cutoff is kept | "Older than" excludes equality; matches the worker's current `lt`. | Plan |
| Open (running) entries | Never purged; only entries with `ended_at` set | A live timer must not vanish; long timers are S-04's problem, and one stopped later is purged at the next run. | Plan |
| Age measured from | `started_at` | Simple, unchanged, uses the existing index. | Research |
| Run logging | `running` row first, finalised after; failed writes throw | A crash becomes a visible stuck row, and nothing is purged unrecorded. | Plan |
| Production proof | Success row and unchanged project count, no synthetic old rows | A test link would burn one of the 10 slots; deletion is proven by pgTAP and locally. | Plan |

## Scope

**In scope:** the purge function and its migration, the pgTAP test, the worker rewrite and run logging, a local end-to-end check, and the production rollout steps.

**Out of scope:** cron schedule changes, batching, alerting or stale-row cleanup, purging anything besides entries, ageing by `ended_at`, CI running the Worker, deploying or pushing from the `/goal` lane.

## Architecture / Approach

Database first, then worker, then production. The retention rule lives only in SQL (`20260925120000_purge_time_entries.sql`); the worker becomes a thin scheduler: insert a `running` row, call `rpc("purge_time_entries")`, finalise the row, and throw on any failed write so Cloudflare shows a failed run. Production order is migration then worker deploy, because the new worker needs the function.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Purge function and pgTAP | Migration plus tests for boundary, open entries, projects, count and grants | Month arithmetic depends on the session time zone (UTC on Supabase) |
| 2. Worker and local end-to-end | `rpc` call, `running` to final log lifecycle, local scheduled run proving it | A local `.dev.vars` must never hold the production service-role key |
| 3. Production rollout (user-run, after merge, from main) | Migration pushed, worker deployed, real scheduled run recorded | Deploying the worker before the migration; remote changes need your approval |

**Prerequisites:** `npm ci` in this worktree (it has no `node_modules`); Docker with `npx supabase start` for Phases 1–2; S-02 done (it is); remote Supabase and Cloudflare access for Phase 3 only.
**Estimated effort:** ~1–2 sessions for Phases 1–2; Phase 3 is a short manual session.

## Open Risks & Assumptions

- Production probably holds no entry older than 3 months yet, so the production run can only show `rows_affected: 0`; real deletion is proven locally and by pgTAP.
- Commit `e59845d` changed the worker's source by 5 lines after Phase B; its content was not inspected and the rewrite replaces the handler anyway.
- Remote state (applied migrations, deployed worker version, cron trigger) is unverified from the repo.

## Success Criteria (Summary)

- `npx supabase test db`, `npm run lint`, `npx astro check` and `npm run build` pass.
- A local scheduled run deletes only old closed entries, keeps everything else including all projects, and leaves one `success` row in `job_runs`; with the function dropped, it leaves one `error` row instead.
- After your production rollout, the newest production `job_runs` row is `success` and the project count is unchanged.
