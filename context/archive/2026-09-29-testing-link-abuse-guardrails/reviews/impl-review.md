<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Testing link leak & regeneration guardrails

- **Plan**: context/changes/testing-link-abuse-guardrails/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-09-29
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated checks re-run in this review: `npx vitest run` 12 files / 90 tests pass; `npm run test:integration` with local env vars 3 files / 12 tests pass. Earlier in the session: pgTAP 9 files / 115 tests, lint, astro check, smoke:local, and CI run 36563821034 all green.

## Findings

### F1 — Integration cleanup swallows errors and skips access_log

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/test/integration-db.ts:69-75
- **Detail**: The three `delete` calls in `cleanupSeeded` never check `error`. `access_log.link_id` has an FK to `links`, so if anything writes an access_log row for a seeded link the final `links` delete fails silently and the link stays. `scripts/smoke.mjs` refuses to run while any link exists, so leaked rows would abort the next smoke run.
- **Fix**: Also delete `access_log` rows for each seeded link, and throw on any delete error.
- **Decision**: FIXED via Fix now (cleanupSeeded also deletes access_log rows and throws on delete errors; integration suite, eslint, prettier pass)

### F2 — Ownership delete test has no empty-project case

- **Severity**: 👁 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/projects.integration.test.ts:31,50-56
- **Detail**: Both projects carry a time entry, so an unscoped `deleteProject(A, pB)` would hit the FK and throw `ProjectInUseError` instead of returning false. The regression is still caught (as a thrown error), but there is no case where another person's empty project must survive, and no positive control that A can delete an own unused project. The comment at line 31 is misleading.
- **Fix**: Seed an unused project for B, assert `deleteProject(A, thatId)` is false and the row survives; optionally add A deleting an own unused project returns true.
- **Decision**: FIXED via Fix now (unused projects for A and B; B's unused project survives, A deletes own unused; comment corrected; dropping the link_id scope in deleteProject turned both delete tests red, restored)

### F3 — pgTAP control covers only `links`

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/tests/database/anon_access.test.sql:62-76
- **Detail**: The other four zero-row assertions (projects, time_entries, access_log, job_runs) have no control showing they would notice a leak. Seed inserts run as owner and would error if they failed, so risk is low.
- **Fix**: Repeat the control for the other tables (raise plan count accordingly), or accept as is.
- **Decision**: FIXED via Fix now (control added for projects, time_entries, access_log, job_runs; plan 6 -> 10; supabase test db passes)

### F4 — test-plan §3 row 3 status is stale

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md (§3 row 3)
- **Detail**: Says "CI smoke job pending its first push"; the push happened and CI run 36563821034 passed.
- **Fix**: Drop the "pending" note.
- **Decision**: FIXED via Fix now (stale CI-pending note removed from test-plan §3 row 3)

### F5 — Minor test hygiene in links.integration.test.ts

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/links.integration.test.ts:40-53
- **Detail**: One test depends on the previous one having run (breaks under `.only` or shuffle), and the "lockout accepted" test repeats an assertion from the previous test (kept deliberately as a named documentation of the accepted model).
- **Fix**: Accept, or make each test seed its own person.
- **Decision**: SKIPPED (sequential dependency accepted for this opt-in suite)
