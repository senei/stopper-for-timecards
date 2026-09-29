<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Testing weekly grid rounding & aggregation

- **Plan**: context/changes/testing-weekly-grid-rounding-aggregation/plan.md
- **Scope**: Full plan (4 of 4 phases)
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-09-29
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 2 observations

Method: reviewed inline by the main agent (no sub-agents; 8 source/config files changed, commits b09a520..01db923). Automated criteria re-run: default suite 83/83, grid unit files 30/30, integration suite 3/3 with env and 3 skipped without env, working tree clean apart from an unrelated `CLAUDE.md` edit.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — New tests are not run in CI

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: .github/workflows/ci.yml:18-22,44; context/foundation/test-plan.md §5
- **Detail**: The CI workflow runs lint, `astro check`, build, `supabase test db` and the smoke script. It has no `vitest` step (searched the whole file for `vitest` and `npm test`; only those `run:` steps exist). So every unit test in this change, including the float-sum regression guard, is enforced only locally. `test-plan.md` §5 lists "unit + integration (Vitest + pgTAP) | local + CI | required", which overstates what CI does. This predates the change, but it limits how much protection the change actually gives.
- **Fix**: Add a `npx vitest run` step to the CI `check` job (default suite needs no database), and reword §5 to say the Vitest integration run is ad hoc.
  - Strength: Turns 83 existing tests into a real merge gate at the cost of one CI line.
  - Tradeoff: Touches CI, which this lesson excludes from scope; do it as a separate follow-up change.
  - Confidence: HIGH — the default suite passes with no env vars or database.
  - Blind spot: Have not checked whether another workflow file runs vitest.
- **Decision**: FIXED via Fix now — added `npx vitest run` to ci.yml and reworded test-plan section 5

### F2 — Integration test has no guard against a non-local database

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/weekly-grid-query.integration.test.ts:8-10
- **Detail**: The test uses whatever `SUPABASE_URL` and service-role key are in the environment and inserts and deletes rows with them. Vitest does not load `.env` into `process.env`, so this needs a deliberate export, but a shell that still has hosted-project credentials from an earlier `smoke` run would write test rows into that project. Rows are removed in `afterAll`, and only rows it created, but service-role writes to a real project are still avoidable.
- **Fix**: Skip (or throw) unless the URL host is `127.0.0.1` or `localhost`, and say so in the skip message.
- **Decision**: FIXED via Fix now — integration test skips unless SUPABASE_URL host is 127.0.0.1 or localhost

### F3 — Row 4.3 is ticked although the step was skipped

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/testing-weekly-grid-rounding-aggregation/plan.md:282
- **Detail**: Progress row 4.3 reads "Surviving Stryker mutants … were each triaged — ffb7864" but no triage happened; the Stryker run gave an invalid 0/64 result and you chose to skip. The explanation is in the Phase 4 block note (plan.md:186), the commit body and test-plan §6.4, but the Progress row alone reads as done.
- **Fix**: Leave as is, since row titles are immutable and the skip is recorded in three places.
- **Decision**: FIXED — row 4.3 unticked (SHA removed); the skip stays documented in the Phase 4 note, commit ffb7864 and test-plan 6.4

### F4 — Phase 1 manual row lacks a "confirmed by user" record

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: commit b09a520 (row 1.3)
- **Detail**: Lessons ask that a manual row ticked on the user's confirmation say so in the phase commit body. Phases 2, 3 and 4 do; the Phase 1 commit body does not mention row 1.3. The commit is already made; amending is not appropriate.
- **Fix**: Nothing to change now; note it and follow the convention from the first phase next time.
- **Decision**: SKIPPED — commit b09a520 not amended; convention followed from phase 2 on
