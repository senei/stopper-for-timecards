<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Testing delete-account scope and confirmation guardrails

- **Plan**: context/changes/testing-delete-account-guardrails/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-09-30
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 5 observations (all resolved or accepted after triage)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated checks re-run in this review: `npx vitest run` 14 files / 111 tests pass; `npm run test:integration` with the local env vars 4 files / 23 tests pass; `npx astro check` 0 errors. Lint ran clean in Phase 2 (the one full run for this change).

Plan-drift review: every planned item matches (gating, fake context, two-person fixture with children, null-link row cleanup, the four route cases, the wrapper tests, the cookbook entries, the change notes). `git diff --name-only 46fc933^..HEAD` shows no non-test `src/` or `supabase/` file changed, no PRD edit, no e2e, no concurrency test. Safety review: no path to a non-local database; every delete and count is scoped by a seeded id or a per-run marker.

## Findings

### F1 — Wrong-phrase integration cases do not prove the route reached the phrase check

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/__tests__/delete-account.integration.test.ts:91-103
- **Detail**: The three wrong-phrase cases only check that both people's rows are unchanged. They would also pass if the route returned early for another reason (a 503 from a misconfigured environment, a 404 rewrite), because nothing is deleted either way.
- **Fix**: Also assert the 303 redirect to `/w/<token>/delete-account?error=confirm-phrase` and that the `rewrite` spy was not called.
- **Decision**: FIXED via Fix now (the wrong-phrase cases assert the 303, the confirm-phrase Location and that rewrite was not called; a route that bails out early with a 404 now turns all three red, checked)

### F2 — Two inaccurate statements in the cookbook

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md §6.6 and §6.5
- **Detail**: §6.6 says "six deliberate-break checks"; the change ran nine (three in Phase 1, six in Phase 2). §6.5 says to "assert both people's row counts before and after", but the tests assert counts after the action only.
- **Fix**: Say nine, and say "after the action (the fixture is proven non-empty by the FULL assertions on the untouched person)".
- **Decision**: FIXED via Fix now (test-plan §6.6 says nine deliberate-break checks; §6.5 says counts are asserted after the action, with the untouched person's FULL counts proving the seed)

### F3 — Weak assertions in a few integration cases

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/__tests__/delete-account.integration.test.ts:50, 138-148
- **Detail**: `count()` maps a null count to 0, so a broken API answer could make EMPTY pass. The repeat-delete case checks only the stayer, not that the leaver stays deleted.
- **Fix**: Make `count()` throw on a null count; also assert the leaver is still EMPTY after the second call.
- **Decision**: FIXED via Fix now (count() throws on a null count; the repeat-delete case also asserts the leaver stays EMPTY)

### F4 — No wrapper case for a missing Supabase configuration

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/links.test.ts
- **Detail**: `adminOrThrow()` throws when Supabase is not configured; no test shows `deleteAccount` then rejects instead of reporting success.
- **Fix**: Add a case where `adminOrThrow` throws and `deleteAccount` rejects.
- **Decision**: FIXED via Fix now (links.test.ts: deleteAccount rejects and never calls the rpc when adminOrThrow throws)

### F5 — Minor coupling and duplication

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: several
- **Detail**: The fake-context helper is duplicated in the route test and the integration test; the wrapper test copies exact error strings; `vi.restoreAllMocks()` sits after the resets in the route test (harmless); some redirect, cookie and 404 cases appear in both the hermetic and the integration file, mostly on purpose.
- **Fix**: None needed.
- **Decision**: ACCEPTED (duplication is mostly on purpose; mild coupling to error wording)

### F6 — Parallel files and killed runs

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/__tests__/delete-account.integration.test.ts, src/test/integration-db.ts
- **Detail**: The file seeds about 13 links and shares one database with the other integration files; a future test that relies on global counts or `create_link` could be flaky, and a killed run leaves seeded links behind (a `supabase db reset` cleans up).
- **Fix**: None needed today.
- **Decision**: ACCEPTED (parallel-file and killed-run notes are recorded in the cookbook; nothing uses global counts today)

### F7 — "The cookie fixture adds nothing" (reviewer claim)

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/__tests__/delete-account.integration.test.ts:105-127
- **Detail**: The quality review said that because the route ignores the cookie for identity, the "cookie holds the other person's link" setup adds nothing to the database assertion. That is true for a correct route and false for the regression it exists for: making the route look up the cookie's link turned exactly this test red during the Phase 1 break-check.
- **Fix**: None; keep the fixture.
- **Decision**: DISMISSED (the reviewer's premise is wrong for the regression this fixture exists for: making the route look up the cookie's link turned exactly this test red in the Phase 1 break-check)
