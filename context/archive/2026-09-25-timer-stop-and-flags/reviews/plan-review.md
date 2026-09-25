<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Timer Stop and Flags

- **Plan**: context/changes/timer-stop-and-flags/plan.md
- **Mode**: Deep (claims verified locally, no sub-agent)
- **Date**: 2026-09-25
- **Verdict**: SOUND (after the three plan edits below)
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

10/10 paths ✓, 8/8 symbols ✓, brief↔plan ✓, Progress↔Phase ✓ (15/15 criteria map to Progress rows). `docs/reference/contract-surfaces.md` does not exist, so the contract-surfaces check was skipped.

## Findings

### F1 — The warning only mentions Stop, but Switch records the same hours

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 — Workspace card (warning wording)
- **Detail**: `switch_timer` also closes the running entry at `now()` (`supabase/migrations/20260923120000_switch_timer.sql:73`). A user who sees "Did you forget to stop it?" and picks a project from the switch list records the same excess hours, and the alert never says so. The plan did not state whether that was intended.
- **Fix**: Word the alert to cover both stopping and switching, and record in the plan that switching a flagged timer is intentionally unchanged.
- **Decision**: FIXED — plan.md Phase 3 card contract now requires wording covering stop and switch; "What We're NOT Doing" gained "Changing Switch for a flagged timer"; plan-brief.md Open Risks updated.

### F2 — Smoke asserts flag wording the plan leaves to the implementer

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — card and smoke contracts
- **Detail**: The card contract left the alert wording to the implementer while the smoke contract asserted on "the flag wording", so both could not be satisfied by a plan-following implementation, and a later copy tweak would break smoke.
- **Fix**: Pin a stable `data-long-running-warning` attribute on the alert and have smoke assert the attribute plus "13 hours".
- **Decision**: FIXED — plan.md Phase 3 card contract pins the attribute; the smoke contract asserts it (both the absent-when-fresh and present-when-seeded checks).

### F3 — Output-column names can shadow table columns in `stop_timer`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — migration contract
- **Detail**: The function's return columns (`project_id`, `project_name`, `started_at`) share names with `time_entries` columns, so an unqualified reference in the body fails as ambiguous. `switch_timer` avoids it with a table alias (`:88-90`). The first pgTAP run would catch it.
- **Fix**: Add a line to the migration contract requiring alias-qualified column references, as `switch_timer` does.
- **Decision**: FIXED — plan.md Phase 1 migration contract now says so, with the `switch_timer` reference.

### F4 — The 12-hour threshold needs the user's final confirmation (lane requirement)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Implementation Approach — Threshold
- **Detail**: The lane goal requires the "suspiciously long" threshold to be surfaced in plan-review for confirmation. 12 hours elapsed was chosen in planning; alternatives were 8 hours and "started on an earlier local date". A timer left running at 18:00 is not flagged until 06:00 the next morning. It is a single constant, so changing it later is cheap.
- **Fix**: None unless a different value is wanted.
- **Decision**: ACCEPTED — 12 hours confirmed, trade-off understood (plan-brief.md Open Risks records this).
