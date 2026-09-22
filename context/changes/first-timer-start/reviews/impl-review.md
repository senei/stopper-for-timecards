<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: First Timer Start Implementation Plan

- **Plan**: context/changes/first-timer-start/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-09-22
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Foundation-doc changes outside the plan's own file list

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/foundation/{infrastructure.md, prd.md, prd-v3.md, roadmap.md} (commit 01a214a)
- **Detail**: Mid-implementation, a course-grading-checklist review (CRUD completeness) led to PRD v3→v4 (new FR-009/FR-010), two new roadmap slices (S-09 delete-project, S-10 delete-account), and an owner-only-deletion operational note in infrastructure.md. None of this is described anywhere in `first-timer-start/plan.md` — a future reader of the change folder alone, without the conversation history, would not know why the PRD version bumped or why the roadmap gained two new slices during a change whose plan is only about starting a timer. This was disclosed and user-approved in real time (each PRD/roadmap addition went through its own confirmation), and is cleanly isolated in its own commit (01a214a) separate from the three phase commits — so it's a documentation gap, not a hidden or dangerous change.
- **Fix**: Add a short "Related changes" note to `plan.md` (e.g. under References or a new final section) pointing at commit 01a214a and summarizing what it did and why, so the plan document is self-contained for future readers.
- **Decision**: FIXED — added a `## Related Changes` section to plan.md summarizing commit 01a214a.

### F2 — Destructive column drop has no explicit precondition check

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (data safety)
- **Location**: supabase/migrations/20260922150000_projects_and_timer.sql:34
- **Detail**: `alter table time_entries drop column project;` runs with no explicit runtime assertion that the table is actually empty, even though the plan's own Migration Notes claim zero production rows. In practice this is safe by accident, not by design: the very next statement adds `project_id uuid not null` with no default, which Postgres rejects outright if any row exists, aborting the whole migration transaction atomically. The safety net exists, but it wasn't placed there on purpose.
- **Fix**: No action required now. For future migrations that drop/rework columns on a table that might not be empty, add an explicit precondition (e.g. a `do $$ ... raise exception ...` block) rather than relying on an incidental NOT NULL constraint to catch a non-empty table.
- **Decision**: ACCEPTED-AS-RULE: Guard destructive column drops with an explicit precondition check (finding not fixed — migration already applied/committed; rule recorded in context/foundation/lessons.md for future migrations).

### F3 — `adminOrThrow()` duplicated across three lib modules

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/timer.ts, src/lib/projects.ts (mirrors src/lib/links.ts)
- **Detail**: The `adminOrThrow()` helper is copy-pasted identically into `links.ts`, `timer.ts`, and `projects.ts`. This is pre-existing duplication from `links.ts` (S-01) that this slice's new files are being consistent with, not a new pattern this diff introduced.
- **Fix**: Optional cleanup — extract to a shared export (e.g. in `src/lib/supabase-admin.ts`) the next time any of these three files is touched. Not blocking.
- **Decision**: FIXED — `adminOrThrow()` moved to `src/lib/supabase-admin.ts`, `links.ts`/`timer.ts`/`projects.ts` now import it. Verified: unit tests (27/27), lint, astro check, pgTAP (24/24) all pass.

### F4 — SSR time-display fallback is a fragile fixed-format substring

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/pages/w/[token].astro:77
- **Detail**: The server-rendered fallback `currentTimer.startedAt.slice(11, 16)` assumes the timestamp string is always in the exact `YYYY-MM-DDTHH:MM:SS...` layout. It works today (Supabase/PostgREST's format is stable), but unlike the client-side localization script added in 528d9b6 — which validates via `Number.isNaN(date.getTime())` before using the parsed value — this SSR path has no such guard and would silently render garbled text rather than fail loudly if the timestamp format ever changed.
- **Fix**: Low priority. If touched again, parse via `Date` and format defensively (matching the client script's validation) instead of a fixed-offset substring.
- **Decision**: FIXED — added `formatUtcTime()` helper (Date parse + `Number.isNaN` guard, falls back to "—") replacing the raw `.slice(11, 16)`. Verified: lint, astro check pass.

### F5 — Locale-dependent case-folding in project-name matching

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922150000_projects_and_timer.sql:25-26, 81
- **Detail**: Case-insensitive project-name matching uses Postgres's `lower()`, both in the unique index (`projects (link_id, lower(name))`) and in `start_timer`'s find-or-create lookup. `lower()` is locale/collation-dependent server-side; under most locales this is fine for Latin-script names, but under certain locales (e.g. Turkish `tr_TR`) or exotic Unicode casefolding edge cases, two visually-identical names could theoretically fail to collide, or unrelated ones could. Not exploitable in this app's single-tenant, ASCII-oriented context.
- **Fix**: No action needed. If this becomes a real concern later, a one-line comment near the `lower()` usage documenting the assumption would suffice.
- **Decision**: FIXED — added a comment above `projects_link_id_lower_name_idx` documenting the locale-dependence assumption. Note: this edits an already-applied migration file (comment-only, no schema change); verified `supabase db reset` still applies cleanly and pgTAP still passes 24/24.

### F6 — Unplanned 503 branch on link-lookup failure

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/w/[token]/timer/start.ts (link-lookup catch block)
- **Detail**: The plan's contract for this file didn't mention a DB-lookup-failure path, only "malformed token or unknown link → 404." The implementation added a `503` response on a `findLinkByToken` exception, mirroring `/w/[token].astro`'s own `unavailable` branch. This is a sensible, pattern-consistent addition, not scope creep or a dangerous change.
- **Fix**: No action needed.
- **Decision**: SKIPPED — sensible, disclosed, pattern-consistent addition; not worth further action.
