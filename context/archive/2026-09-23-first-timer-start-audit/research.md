---
date: 2026-09-23T10:11:44Z
researcher: Claude (10x-research)
git_commit: 38d0ffc184c1aef0dcc8fe9d7006e201376831ae
branch: main
repository: stopper-for-timecards
topic: "Re-audit shipped first-timer-start (S-02) before downstream work (S-03, S-09, S-10)"
tags: [research, codebase, timer, projects, s-02, s-03, s-09, s-10, delete, schema]
status: complete
last_updated: 2026-09-23
last_updated_by: Claude (10x-research)
---

# Research: Re-audit shipped first-timer-start (S-02) before downstream work

**Date**: 2026-09-23T10:11:44Z
**Researcher**: Claude (10x-research)
**Git Commit**: 38d0ffc184c1aef0dcc8fe9d7006e201376831ae
**Branch**: main
**Repository**: stopper-for-timecards

## Research Question

Per `context/changes/first-timer-start-audit/change.md`: general re-audit of the shipped `first-timer-start` (roadmap slice S-02) implementation before starting downstream work (S-03 timer-switch-rounding, S-09 delete-project, S-10 delete-account). Two sub-questions: (1) does the current on-disk code actually match what the plan and implementation review claimed shipped, and (2) does the current schema/lib/API surface give S-03, S-09, and S-10 what they need, or are there gaps that should shape their plans?

## Summary

**S-02 shipped as documented, with no discrepancies.** All six findings from the archived implementation review (`context/archive/2026-09-22-first-timer-start/reviews/impl-review.md`) match the current on-disk state exactly: the four marked FIXED (F3 `adminOrThrow()` extraction, F4 `formatUtcTime()` helper, F5 locale-dependence comment on the case-insensitive index, plus the follow-up client-side time-localization script from commit `528d9b6`) are all present; the two left unfixed by deliberate decision (F2 no explicit precondition on the destructive column drop, F6 the added 503 branch on link-lookup failure) are also unchanged, exactly as their review decisions describe. No TODO/FIXME/placeholder markers were found in any of the eleven S-02 files inspected.

**Downstream readiness is uneven across the three candidate slices.** S-09 (delete-project) is closest to plan-ready: its enforcement mechanism (the `time_entries.project_id` FK) already exists with the correct default behavior, and the only missing piece is a small app-level error-message translation with an exact existing precedent to copy (`TimerAlreadyRunningError`). S-03 (timer-switch-rounding) has its data-model prerequisite (`time_entries.ended_at`) already present, but the actual switch/close function and all rounding logic are fully greenfield, and the rounding algorithm itself is an unresolved product decision, not just an implementation gap. S-10 (delete-account) is the least ready: every FK that would need to be touched (`projects.link_id`, `time_entries.link_id`, `access_log.link_id`) defaults to `NO ACTION`, so account deletion would fail outright today; no cascade or multi-table delete function exists anywhere; and the `access_log` table's schema (specifically its `outcome` check constraint) does not currently accommodate logging a deletion event, so reusing it for an audit trail is a real (if small) schema change, not a drop-in call.

## Detailed Findings

### S-02 implementation vs. review claims

- `supabase/migrations/20260922150000_projects_and_timer.sql` (full file, 102 lines) matches the plan's contract: `projects` table (lines 13-21), unique index `projects (link_id, lower(name))` with the F5 locale-dependence comment immediately above it (lines 23-29), `time_entries` reshaped to drop the old `project` text column and add `project_id`/`project_name`/`task`/`type`/`work_type` plus the `time_entries_link_id_fkey` FK the prior slice's review had deferred (lines 37-50), the partial unique index enforcing one open entry per link (lines 57-59), and the `start_timer()` function exactly as specified in the plan (lines 66-98).
- `src/lib/supabase-admin.ts` exists and exports `createAdminClient()` and `adminOrThrow()` (lines 5-22); `src/lib/links.ts:2`, `src/lib/timer.ts:1`, and `src/lib/projects.ts:1` all import from it, with no duplicate local definitions remaining — F3 fully fixed.
- `src/pages/w/[token].astro:62-65` has the `formatUtcTime()` helper (Date-parse + `Number.isNaN` guard, falls back to `"—"`), used at line 84 in place of the old raw `.slice(11, 16)` substring — F4 fixed. A client-side localization `<script>` block (lines 165-174) added in commit `528d9b6` converts `started_at` to the viewer's local time via `toLocaleTimeString`, with the same `Number.isNaN` guard.
- F2 (destructive `drop column project` with no explicit precondition, `supabase/migrations/20260922150000_projects_and_timer.sql:37`) remains unguarded, exactly as the review's "ACCEPTED-AS-RULE" decision describes — the rule was recorded in `context/foundation/lessons.md` for *future* migrations, not retrofitted onto this one.
- F6 (an added `503` branch in `src/pages/api/w/[token]/timer/start.ts:21-27` for a `findLinkByToken` exception, beyond the plan's stated 404-only contract) remains present and unchanged — the review's decision was "SKIPPED", i.e. keep it.
- Test coverage matches the plan: `src/lib/project-name.test.ts` (8 cases covering trim/empty/200-char-boundary/non-string rejection), `supabase/tests/database/projects_and_timer.test.sql` (12 pgTAP assertions covering create, case-insensitive reuse, the one-open-entry unique-violation, and RLS/grant checks), `supabase/tests/database/private_links.test.sql:38-41` (updated to insert via `project_id`/`project_name`, not the old `project` column), and `scripts/smoke.mjs:131-184` (black-box R-01/R-02 checks via the real HTTP route, gated behind `SMOKE_SUPABASE_URL`/`SMOKE_SERVICE_ROLE_KEY`).
- No TODO/FIXME/HACK/XXX markers found in any of the eleven inspected S-02 files; the only regex hit was an unrelated literal string (`scripts/smoke.mjs:22`, `DUMMY_TURNSTILE_TOKEN`).

### S-03 readiness (switch timer, FR-003)

- Ready: `time_entries.ended_at` (nullable `timestamptz`) already exists, added by the earlier placeholder migration (`supabase/migrations/20260918082739_phase_b_c_purge_and_access_log.sql:14`) and never dropped by S-02. The partial unique index on open entries (`supabase/migrations/20260922150000_projects_and_timer.sql:57-59`) is exactly the invariant a switch operation must preserve. `start_timer`'s advisory-lock + `security definer` pattern (lines 66-98) is a ready-made template for a new `switch_timer` function.
- Missing: no function or code path anywhere closes an entry today — `start_timer` only inserts (lines 93-96), never updates `ended_at`. No rounding logic exists in the codebase; a grep for "round" in `src/` matches only Tailwind `rounded-*` CSS classes, not time math. `context/foundation/test-plan.md:30-34` independently confirms R-03 ("Time calculation precision") as "Not yet implemented — owned by S-03... and S-06." No switch/stop API route exists; only `src/pages/api/w/[token]/timer/start.ts` is present under `src/pages/api/`.
- Open product decision (not a schema gap): the rounding rule for sub-15-minute switches (per-segment vs. per-day-total) is unresolved — flagged in `context/foundation/roadmap.md:119` and left unspecified by the PRD's Business Logic section (`context/foundation/prd.md:96-98` names "15-minute-rounded durations per project" without an algorithm). This blocks writing the rounding function correctly, not just its refinement.

### S-09 readiness (delete project, FR-009)

- Ready: `time_entries.project_id uuid not null references projects (id)` exists with no explicit `ON DELETE` clause (`supabase/migrations/20260922150000_projects_and_timer.sql:42`), so it defaults to `NO ACTION` — confirmed by this codebase's own documented convention on the analogous `access_log_link_id_fkey` (`supabase/migrations/20260922100433_access_log_link_fk.sql:5-8`: "ON DELETE defaults to NO ACTION... failing loudly is the safe default"). This FK alone already makes "can't delete a used project" the database's default behavior, matching the roadmap's own risk note (`context/foundation/roadmap.md:195`).
- Missing: no `deleteProject` function exists in `src/lib/projects.ts` (only `listProjects` is exported) and no delete API route exists. The FK alone is **not** sufficient for FR-009's "clear message explaining why" requirement (`context/foundation/prd.md:82`) — a raw Postgres FK violation surfaces as error code `23503` with a generic constraint message, not a user-facing explanation. `src/lib/timer.ts:28-33` already establishes the exact pattern to copy: catch a specific Postgres error code and translate it into a typed error (there, `23505` → `TimerAlreadyRunningError`).
- No open product decision here — the roadmap's own Unknown (`context/foundation/roadmap.md:194`, FK-as-enforcement vs. app-level pre-check) is answered by this research: catch-and-translate the FK violation is both correct and lower-risk than a separate pre-check query (which would add a race-prone extra round trip the FK already closes).

### S-10 readiness (delete account, FR-010)

- Three FKs reference `links.id`, all defaulting to `NO ACTION`: `projects.link_id` (`supabase/migrations/20260922150000_projects_and_timer.sql:15`), `time_entries.link_id` via `time_entries_link_id_fkey` (same file, lines 48-50), and `access_log.link_id` via `access_log_link_id_fkey` (`supabase/migrations/20260922100433_access_log_link_fk.sql:13-15`). `job_runs` has no link reference. Deleting a `links` row today would fail immediately with a FK violation for any account that has ever started a timer (guaranteed true post-S-02).
- Nothing currently supports cascading delete — no `ON DELETE CASCADE` anywhere, no multi-table delete function in any migration. This is fully greenfield, comparable in scope to S-03's missing switch function.
- The `access_log_link_id_fkey` comment (`supabase/migrations/20260922100433_access_log_link_fk.sql:5-8`) states "links are never deleted by any code path in this app... by design — see FR-007" — this is now stale, since FR-010 (added to the PRD after this migration, `context/foundation/prd.md:84-85`) introduces exactly the removal mechanism the comment says doesn't exist.
- `logAccess()` (`src/lib/access-log.ts:15-37`) is not a drop-in fit for a deletion audit entry: its `outcome` field is constrained to `'success' | 'not_found' | 'error'` by both a DB check constraint (`supabase/migrations/20260918082739_phase_b_c_purge_and_access_log.sql:47`) and the TS type, with no value for "account deleted." Reusing it would need either a new `outcome` value (a schema change) or a separate audit mechanism.
- Open product decisions (not implementation gaps): confirmation UX (typed phrase vs. two-step), already flagged as user-owned in `context/foundation/roadmap.md:207`; whether a deletion audit-log entry is needed at all given the `access_log` schema mismatch above, already flagged in `context/foundation/roadmap.md:208` and now confirmed to be a real design question rather than trivial; and cascade-via-FK vs. a manual multi-table delete function, which is itself an architecture call — a hard `ON DELETE CASCADE` is a one-way door that forecloses any future soft-delete/archive feature on links, while a manual delete function is more auditable but must get child-before-parent ordering right to avoid the same `NO ACTION` violations S-09 addresses.

## Code References

- `supabase/migrations/20260922150000_projects_and_timer.sql:13-102` - S-02 schema: `projects` table, case-insensitive unique index + locale comment, `time_entries` reshape + FK, one-open-entry partial index, `start_timer()` function
- `src/lib/supabase-admin.ts:5-22` - shared `createAdminClient()`/`adminOrThrow()`, imported by `links.ts`, `timer.ts`, `projects.ts`
- `src/lib/timer.ts:24-61` - `startTimer()`; `28-33` shows the `23505` → `TimerAlreadyRunningError` translation pattern S-09 should copy for `23503`
- `src/pages/w/[token].astro:62-65,84,165-174` - `formatUtcTime()` server fallback and client-side local-time localization script
- `src/pages/api/w/[token]/timer/start.ts:21-27` - unplanned but accepted 503 branch on link-lookup failure (F6)
- `supabase/migrations/20260918082739_phase_b_c_purge_and_access_log.sql:14,47` - `time_entries.ended_at` origin; `access_log.outcome` check constraint (blocks direct reuse for a deletion event)
- `supabase/migrations/20260922100433_access_log_link_fk.sql:5-8,13-15` - `access_log_link_id_fkey`, `NO ACTION` default, and its now-stale "links are never deleted" comment
- `context/foundation/test-plan.md:30-34` - R-03 (time calculation precision) status: not yet implemented, owned by S-03/S-06

## Architecture Insights

- Every atomic invariant in this codebase lives in the database, not application code: `create_link`'s 10-person cap and `start_timer`'s one-running-timer guard both use `pg_advisory_xact_lock` inside a `security definer` function with grants restricted to `service_role`. Any new S-03/S-10 function should follow this exact shape rather than introducing application-level locking.
- Error translation follows one consistent pattern: catch a specific Postgres error code from an RPC/query response and re-throw as a named, typed error class (`TimerAlreadyRunningError` for `23505`). This is the established template for S-09's FR-009 friendly-message requirement (translate `23503`).
- RLS is enabled on every table with zero policies — the service-role client is the sole reader/writer throughout. This pattern holds for `projects` and is expected to hold for any new table/column S-03 or S-10 introduce.

## Historical Context (from prior changes)

- `context/archive/2026-09-21-private-link-access/reviews/impl-review.md` (finding F1) deliberately left `time_entries.link_id` unconstrained "pending rework by a later roadmap slice (S-02)" — S-02's migration closed that FK, confirming the prior review's deferred-work note was honored on schedule.
- `context/archive/2026-09-22-first-timer-start/reviews/impl-review.md` - source of the six findings verified against current code in this research (F1-F6); F1 itself (a documentation-only finding about `plan.md`'s missing "Related Changes" section) was out of this research's code-verification scope.
- `context/foundation/roadmap.md` "Related Changes" note under S-02's plan.md records that FR-009/FR-010 and roadmap slices S-09/S-10 were added mid-implementation via a separate commit (`01a214a`), not part of S-02's own plan — explains why those requirements exist despite not appearing in the original S-02 plan-brief.

## Related Research

None — this is the first research document under `context/changes/first-timer-start-audit/`.

## Open Questions

- S-03's rounding algorithm (per-segment vs. per-day-total) — owner: user, per `context/foundation/roadmap.md:119`; blocks writing `switch_timer`'s rounding logic correctly, should be resolved before or during `/10x-plan`.
- S-10's confirmation UX (typed phrase vs. two-step) — owner: user, per `context/foundation/roadmap.md:207`.
- S-10's deletion audit-log approach (new `access_log.outcome` value vs. separate mechanism vs. none) — owner: user, per `context/foundation/roadmap.md:208`; this research adds the concrete finding that `access_log` is not a drop-in fit as-is.
- S-10's cascade-via-FK vs. manual-delete-function architecture choice — not previously flagged in the roadmap; recommend surfacing at `/10x-plan` time for S-10 given its one-way-door implications for `ON DELETE CASCADE`.
