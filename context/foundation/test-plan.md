---
project: "Stopper for Timecards"
version: 1
status: draft
created: 2026-09-22
---

# Test Plan: Stopper for Timecards

Defines the risks this project's tests exist to catch, derived from the PRD's own Guardrails and Success Criteria (`context/foundation/prd.md`). Each risk maps to the test(s) that verify it and the layer (database vs. user-perspective) they run at. New slices add risks here as they're planned; a slice's plan should trace at least one test back to a named risk rather than testing for its own sake.

## Risks

### R-01: Time logged against the wrong project

- **Source:** PRD Guardrails — "Project association must be correct — time logged against the wrong project defeats the entire purpose of the tool."
- **Why it matters:** A misattributed entry corrupts that day's weekly-grid submission with no easy way to notice, since nothing about a wrong-but-valid project looks broken.
- **Covered by:**
  - `supabase/tests/database/projects_and_timer.test.sql` — proves `start_timer` always resolves to the project the caller actually named (new vs. reused, case-insensitive), at the database level.
  - `scripts/smoke.mjs` (S-02 Phase 3) — starts a timer through the real HTTP flow a person would use and asserts the resulting entry is attributed to the exact project name that was submitted, verified from outside the app.

### R-02: More than one timer running at once for the same person

- **Source:** PRD Success Criteria — "start tracking on a project, switch between projects during the day with time correctly allocated" implies exactly one active segment at a time; a second concurrent timer would double-count elapsed time with nothing to flag it.
- **Why it matters:** Silent double-counting breaks the weekly grid's accuracy guarantee without producing any visible error for the person to notice.
- **Covered by:**
  - `supabase/tests/database/projects_and_timer.test.sql` — the one-running-timer-per-link partial unique index, verified with a deliberate-break check during implementation (temporarily disabling the constraint confirmed the test goes red without it).
  - `scripts/smoke.mjs` (S-02 Phase 3) — asserts that a second start attempt while a timer is already running does not create a second open entry, exercised through the same API a user's browser would hit.

### R-03: Time calculation precision

- **Source:** PRD Guardrails — "Time calculation must be accurate to 15-minute precision — miscalculated durations make the weekly table untrustworthy."
- **Why it matters:** The product's entire value proposition is an accurate weekly grid; rounding errors compound silently across a week of entries.
- **Status:** Not yet implemented — owned by S-03 (`timer-switch-rounding`) and S-06 (`weekly-grid-summary`). A test suite should be added here when those slices are planned. The rounding rule itself was decided 2026-09-23 as part of `timer-switch-rounding`/S-03's planning: round each project's total tracked time *per day* (not per segment), always rounding up to the next 15-minute increment. Still not implemented — the "day" boundary depends on S-06's still-open Mon–Sun timezone decision, so building the aggregation is deferred to S-06.

### R-04: A project with logged time gets deleted, destroying its history

- **Source:** PRD FR-009 — "User can delete a project from their list, but only when it has no logged time entries against it; a project with any logged time is protected from deletion, with a clear message explaining why."
- **Why it matters:** Silently allowing a used project to be deleted would destroy the history behind any already-produced weekly grid, with no way to reconstruct it afterward.
- **Covered by:**
  - `supabase/tests/database/delete_project.test.sql` (S-09, this phase) — proves an unused project deletes cleanly while a project with any `time_entries` row (open or closed) is rejected with `23503` and remains intact.
  - Smoke test addition planned for S-09 Phase 2 (not yet built) — exercises the block and the success path through the real HTTP delete route.

## Status

- R-01, R-02: covered as of S-02 (`first-timer-start`).
- R-03: open, tracked against S-03/S-06 on the roadmap.
- R-04: covered as of S-09 (delete-project).
