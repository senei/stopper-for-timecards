<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Weekly Grid Summary (S-06)

- **Plan**: context/changes/weekly-grid-summary/plan.md
- **Scope**: Full plan (4 of 4 phases)
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-09-29
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

Method: reviewed inline by the main agent (no sub-agents). Read `src/lib/weekly-grid*.ts`, `src/pages/w/[token]/grid.astro`, `src/components/WeeklyGridView.astro`, the `WorkspaceCard.astro` diff and the plan. Automated criteria evidence: CI (`ci` and `smoke` jobs, including lint, `astro check`, build and `npx vitest run`) passed on merge commit 0dfe975 and on 8d212e6. Manual rows 3.3, 3.4, 4.2, 4.3 are ticked; 4.2 was confirmed by the user, 3.4 and 4.2 were verified structurally (no browser tool at the time), and rows 3.1 and 3.2 have no SHA suffix.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — A failing week query returns an unhandled 500, not the planned 503 page

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/w/[token]/grid.astro:15-16 and the `fetchWeekEntries` call in the else branch (around line 80)
- **Detail**: The plan's auth pattern is "`isWellFormedToken` → `findLinkByToken` → 404/503" (plan.md:290). `findLinkByToken` is wrapped in try/catch and sets `unavailable`, but `fetchWeekEntries` is not. It throws on any database error (`weekly-grid-query.ts` throws "week entries lookup failed" and on unexpected rows), so a DB error after a successful link lookup reaches the user as an unhandled server error instead of the "Temporarily unavailable" page.
- **Fix**: Wrap the `fetchWeekEntries` + `buildWeeklyGrid` call in try/catch and set `unavailable = true` (status 503) on failure, matching the link lookup above it.
- **Decision**: FIXED via Fix now — fetchWeekEntries/buildWeeklyGrid wrapped in try/catch in grid.astro; failure sets unavailable and status 503 (astro check 0 errors, eslint and prettier clean)

### F2 — Plan verification command names a test file that does not exist

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/weekly-grid-summary/plan.md:262, 401, 451 (row 2.1)
- **Detail**: Row 2.1 and the Testing Strategy list `src/lib/weekly-grid-query.test.ts` for the retention-window boundary. The shipped file is `src/lib/weekly-grid-retention.test.ts`; `weekly-grid-query.ts` itself is untested until the later integration test. Running row 2.1's command as written would fail to find a file. Row titles are immutable, and the tests themselves pass.
- **Fix**: Leave as is; the drift is recorded here and in the testing-weekly-grid-rounding-aggregation research.
- **Decision**: SKIPPED — drift recorded here; row titles are immutable

### F3 — `utcMondayOf` is copied into the page instead of shared

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/w/[token]/grid.astro:41-46 and src/lib/weekly-grid-retention.ts:8-13
- **Detail**: The same Monday-of-week helper exists twice; the page copy's comment says the original "isn't exported for reuse". Two copies can drift, and neither the page copy nor `parseViewedWeekStart` has a test.
- **Fix**: Export `utcMondayOf` from `weekly-grid-retention.ts` and import it in the page.
- **Decision**: FIXED via Fix now — utcMondayOf exported from weekly-grid-retention.ts and imported in grid.astro; local copy removed (30 grid tests pass, astro check clean)
