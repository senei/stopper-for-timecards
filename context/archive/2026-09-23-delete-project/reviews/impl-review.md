<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Delete Project Implementation Plan

- **Plan**: context/changes/delete-project/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-09-23
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations
- **Triage**: F1 FIXED (differently than proposed — real bug caught in the proposed fix itself), F2 SKIPPED (accepted, out of scope), F3 FIXED

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — pgTAP suite doesn't assert anon/authenticated lack DELETE on `projects`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence / Pattern Consistency
- **Location**: supabase/tests/database/delete_project.test.sql:84-92
- **Detail**: The plan's own Contract for this file states "`anon`/`authenticated` cannot delete from `projects`... `service_role` can." The suite only asserts `has_table_privilege('service_role', 'public.projects', 'DELETE') = true` — there is no assertion that `anon`/`authenticated` lack DELETE privilege. A code comment justifies the omission by citing `projects_and_timer.test.sql`, but that file only proves anon/authenticated see zero *SELECT* rows and can't execute `start_timer` — it never asserts a DELETE-specific privilege for either role. Functionally this is safe today (RLS is enabled with zero policies, which blocks all DML including DELETE, not just SELECT, and the app never uses non-service-role keys for writes) — both independent review passes confirmed this — but the file's own stated contract isn't fully covered by its own assertions.
- **Fix**: Add two `has_table_privilege` assertions (`anon`/`authenticated`, `'DELETE'`, expect `false`) to `delete_project.test.sql`, matching the pattern already used for `service_role`, and bump `select plan(9)` to `plan(11)`.
- **Decision**: FIXED — not via the proposed `has_table_privilege` approach, which turned out to be wrong: `anon`/`authenticated` actually hold the table-level DELETE grant by default in this project (verified: the proposed fix's own assertions failed with `have: true, want: false`), and RLS-with-no-policies is what blocks the row, not the grant. Replaced with behavior-based assertions matching how `projects_and_timer.test.sql` already proves the analogous SELECT case: `set local role anon`/`authenticated`, attempt the delete, assert zero rows affected, then confirm `service_role` can actually delete the same row. `plan(9)` → `plan(12)`. Verified: `npx supabase test db` — 36/36 pass.

### F2 — Destructive POST has no CSRF token (pre-existing, app-wide pattern)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/w/[token]/projects/[projectId]/delete.ts
- **Detail**: This destructive route relies solely on the 43-char unguessable link token as the capability boundary, with no separate CSRF token. This is pattern-consistent with `timer/start.ts` (same app-wide design, not a regression introduced by this change) and was an accepted tradeoff already baked into the app's identity model. Flagged only because this specific route is destructive (data loss on a used-project attempt is blocked by the FK, but an unused project genuinely disappears) rather than additive.
- **Fix**: No action required now — revisit only if the team wants to reconsider the app's whole CSRF posture, which is out of this change's scope.
- **Decision**: SKIPPED — pre-existing, accepted, app-wide design; not this change's scope to fix.

### F3 — `deleteProject`'s error message phrasing inconsistent with siblings

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/projects.ts:92
- **Detail**: `deleteProject`'s generic thrown message is `` `deleteProject failed: ${response.error.message}` `` (camelCase function name), while this file's other functions use a human-phrase style (`"project list failed"`, `"project lookup failed"`).
- **Fix**: Rename to `` `project delete failed: ${response.error.message}` `` to match the surrounding style.
- **Decision**: FIXED — renamed as proposed.
