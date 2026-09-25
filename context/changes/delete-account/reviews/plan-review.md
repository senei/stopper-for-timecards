<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Delete Account (S-10)

- **Plan**: context/changes/delete-account/plan.md
- **Mode**: Deep (verified locally, no sub-agent)
- **Date**: 2026-09-25
- **Verdict**: REVISE
- **Findings**: 0 critical, 3 warnings, 3 observations
- **Triage**: 2026-09-25, all 6 FIXED. F6 was fixed rather than accepted: the home page skips its auto-redirect when a status message is present. Verdict after fixes: SOUND

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

11/11 existing paths ✓, 4/4 new paths free ✓, 6/6 symbols ✓, brief↔plan ✓

## Findings

### F1 — Delete route doesn't say how to read a non-form body

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — #4 POST route
- **Detail**: The plan says to copy S-09's delete route, but that route reads no body. This one must read `confirmation` with `request.formData()`, which throws on a JSON or empty body and would return a 500. `src/pages/api/w/[token]/timer/start.ts:33-39` and `src/pages/api/links.ts:26-33` both wrap it in try/catch and treat a failure as "field missing".
- **Fix**: State in the route contract that a body that isn't a form is treated as an empty phrase (mismatch redirect, nothing deleted), as in `timer/start.ts:33-39`; add a smoke or manual case for it.
- **Decision**: FIXED (Fix in plan)

### F2 — A concurrent page view can make the delete fail with 23503

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — #1 delete_account contract; Key Discoveries
- **Detail**: The plan serializes only against timer functions. Every workspace view writes an `access_log` row (`src/pages/w/[token].astro:47`), and that insert takes no timer lock. If it commits between the function's `delete from access_log` and its `delete from links`, the link delete hits the foreign key and the whole call rolls back. Nothing is lost and a retry works, but the user sees a spurious error on an irreversible action.
- **Fix**: Add `select id from public.links where id = p_link_id for update` right after the advisory lock, and return `false` if no row. The row lock makes concurrent access_log and timer inserts wait, and gives the "unknown link" case an early exit.
- **Decision**: FIXED (Fix in plan)

### F3 — Smoke "slot freed" step is muddled

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 — #1 Smoke steps
- **Detail**: At that point the script has exactly 10 links (`scripts/smoke.mjs:341-370`). The plan deletes two, then says a new link "succeeds where it would have been full before". With 8 links left, a successful create proves nothing about the cap. The throttle (3 per 10 minutes, `src/pages/api/links.ts:9-10`) also makes the order matter.
- **Fix**: Specify: delete the 10th link (count 10 to 9), create one (9 to 10, succeeds), create again and expect `/?full=1`; then delete the first link and assert its rows are gone everywhere.
- **Decision**: FIXED (Fix in plan)

### F4 — Four Progress rows are worded differently from their criteria

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Progress rows 2.4, 3.5, 4.2, 4.3
- **Detail**: The mapping is one-to-one (16/16, no stray checkboxes), but these four rows paraphrase their Success Criteria bullet instead of copying it. Rows are meant to be copied exactly once.
- **Fix**: Make those four Progress titles identical to their criteria.
- **Decision**: FIXED (Fix in plan)

### F5 — No smoke guard for the confirm page's Referrer-Policy

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 — #1 Smoke steps
- **Detail**: `context/foundation/lessons.md` says form pages must use `strict-origin`, and `scripts/smoke.mjs:128-132` already guards the workspace page that way. The new confirm page is a form page but has no header check; only the manual browser step covers it.
- **Fix**: Add a smoke step: GET `/w/<token>/delete-account` returns 200 with `Referrer-Policy: strict-origin`.
- **Decision**: FIXED (Fix in plan)

### F6 — The "deleted" banner is lost if the browser holds another link

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 3 — #3 Home page banner
- **Detail**: `src/pages/index.astro:11-14` redirects any browser with a valid remembered link straight to its workspace before the banner code runs. Deleting through a shared link from such a browser lands on that other workspace with no message.
- **Fix**: None needed; note it as accepted. The data is deleted either way.
- **Decision**: FIXED (Fix in plan)
