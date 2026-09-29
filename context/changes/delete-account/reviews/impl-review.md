<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Delete account (S-10)

- **Plan**: context/changes/delete-account/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4 (Phase 3 row 3.7, the CI smoke job, was still pending when the review ran)
- **Date**: 2026-09-29
- **Verdict**: NEEDS ATTENTION (before triage); all warnings fixed or accepted after triage
- **Findings**: 0 critical, 5 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Plan-drift review: every planned item matches (function, lock, order, grants, tests, route contract, page, workspace link, smoke, roadmap and test-plan notes). The "not doing" list holds: no cascade, no audit entry, no existing migration edited. Unplanned but harmless extras: route unit tests in `src/__tests__/`, a `deleteAccount` integration test, submit-disable and back-button handling on the confirm page, the `storeCookies` change in smoke, and the roadmap/test-plan path fix.

Safety review: no path deletes without the typed phrase (a missing or non-form body counts as no phrase; GET/HEAD/OPTIONS return 405); every delete is scoped to the locked link id; all three tables with a `link_id` are covered in FK order; the kitchen-sink page only gains one link.

## Findings

### F1 — delete_account takes an advisory lock key nobody else uses

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260928120000_delete_account.sql:26
- **Detail**: The comment says the lock is "the same per-link key start_timer uses", but 20260923120000_switch_timer.sql moved start_timer, switch_timer and stop_timer to `public.timer:<id>`. The old key excludes nothing. The data stayed safe because the `for update` row lock blocks concurrent child inserts; the plan review had already noted the different key and it was still used.
- **Fix**: New migration replacing the function with the `public.timer:` key and a correct comment.
- **Decision**: FIXED via new migration 20260928130000_delete_account_timer_lock.sql (pgTAP passes with it; smoke passes).

### F2 — Smoke does not prove another person's data survives

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs (S-10 section)
- **Detail**: The delete checks assumed a single person owns all data and compared global counts, so a delete that also removed other people's projects and entries would not have been seen.
- **Fix**: Seed a second person with a project and an entry before the delete; assert exactly the owner's rows go and the bystander's stay.
- **Decision**: FIXED (bystander project and entry seeded via the service key; counts now compare per link; new check "another person's project and time entry survive"). Smoke passes.

### F3 — "Cookie cleared" smoke check can pass vacuously

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs (S-10 section)
- **Detail**: `!jar.has("stopper_link")` passes if the jar never held the cookie.
- **Fix**: Assert the jar holds the deleted link's token before the delete.
- **Decision**: FIXED (cookie captured before the delete and required to equal the regenerated token).

### F4 — Route tests miss the failure paths of an irreversible action

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/__tests__/delete-account-route.test.ts
- **Detail**: No case for `deleteAccount` throwing, for it returning false, or for the lookup failing.
- **Fix**: Add the three cases.
- **Decision**: FIXED (3 tests: generic-error redirect keeping the cookie, 404 keeping the cookie, 503 with no delete). Break-checks turned each red.

### F5 — Confirm button is disabled in the HTML

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/w/[token]/delete-account.astro
- **Detail**: A browser without scripts could never submit, although the server is the real guard.
- **Fix**: Enable it in the markup; the script disables it until the field reads DELETE.
- **Decision**: FIXED.

### F6 — pgTAP cap test assumes an empty links table

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/tests/database/delete_account.test.sql
- **Detail**: The count of ten links assumes no other rows; it fails loudly rather than passing wrongly, and the sibling private_links test shares the assumption.
- **Fix**: Assert relative counts, or accept.
- **Decision**: ACCEPTED (same convention as private_links.test.sql; the suite runs after a db reset).

### F7 — "Deleted" banner is lost when the cookie resolves to another link

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-state
- **Location**: src/pages/index.astro:12-16
- **Detail**: If the browser's cookie holds a different, still-valid link, the home page redirects to that workspace before showing the notice. The route deliberately leaves another link's cookie alone.
- **Fix**: Accept, or pass the status through the redirect.
- **Decision**: ACCEPTED (an edge case: the person deleted a link that was not the one this browser remembers).

### F8 — Minor observations

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: several
- **Detail**: (a) A regenerate that loses a race to a delete tries to log an access row for the vanished link; the insert fails its FK and `logAccess` swallows it. (b) The error alert is not linked to the field with `aria-describedby`. (c) The delete leaves no audit trail, and there is no throttling on the endpoint; this follows the recorded decision and the token is the credential. (d) A retry after a lost response returns the 404 page.
- **Fix**: None needed.
- **Decision**: ACCEPTED.
