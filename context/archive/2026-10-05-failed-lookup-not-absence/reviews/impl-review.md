<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Failed lookup is not absence

- **Plan**: context/changes/failed-lookup-not-absence/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-10-05
- **Verdict**: APPROVED
- **Findings**: 0 critical 0 warnings 0 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Evidence: the code files changed by this change are exactly the plan's seven (`src/lib/link-cookie.ts`, `src/lib/link-cookie.test.ts`, `src/pages/api/links.ts`, `src/__tests__/links-route.test.ts`, `src/pages/index.astro`, `src/lib/links.ts`, `src/lib/links.test.ts`); nothing in the "not doing" list was touched (no lifecycle events, no new `?error=` code, no config warnings, no widget changes). The screenshots commit `c8398ab` is separate from this change and was not reviewed.

- Phase 1: `resolveCookieLink(cookies, route)` returns `linked` / `none` / `unknown` as specified. A failed lookup is logged as `cookie_link_lookup_failed` with the caller's route and leaves the cookie alone; a malformed cookie and a cookie whose link is gone are cleared with a `cookie_stale` warning and the reason. `index.astro` answers 503 with the "Temporarily unavailable" view and skips the form and the Turnstile script on `unknown`; `api/links.ts` refuses with 303 to `/?error=1` before the kill switch, Turnstile, throttle and `createLink`. The helper, both callers and both test files landed in one commit (`10abb2d`), as the state-sequencing note required.
- Phase 2: `countRecentLinks` throws `recent link count returned null` on a null count; the `{ error }` branch and `dbError` are unchanged. The unit tests cover value, zero, error with `cause` and null; the route test pins that a failing count creates nothing and writes one `link_create_failed` line. Phase 2 was written by a subagent and the diff was read in full before the gates.
- Re-run today at `HEAD`: `npx vitest run` 219 passed (21 files), `npx tsc --noEmit` exit 0. Run at the phase commits on the same code: `npm run lint` clean, `npx astro check` 0 errors, ESLint on the five phase 1 files clean, and both deliberate breaks turned the expected test red (phase 1: the `unknown` case and the route refusal case; phase 2: the null-count case) with the restore leaving the tree equal to the staged copy.
- Manual rows 1.6, 1.7, 1.8 and 1.9 are recorded as confirmed by the user in commit `10abb2d`, with the evidence in the session: against `SUPABASE_URL=http://127.0.0.1:1` and a well-formed cookie `GET /` answered 503 with no form and no `Set-Cookie`, `POST /api/links` answered 303 to `/?error=1`, and the log lines carried routes `GET /` and `POST /api/links`; against a healthy local stack a valid cookie redirected to the workspace (302 on `GET /`, 303 on the POST), no cookie showed the form, and a stale cookie showed the form and cleared the cookie.
- Not covered by an automated test, by plan decision: `index.astro` (no test imports an `.astro` file); it rests on rows 1.6 and 1.8.

## Findings

None.
