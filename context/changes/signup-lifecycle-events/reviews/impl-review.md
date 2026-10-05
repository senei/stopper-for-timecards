<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Sign-up lifecycle events

- **Plan**: context/changes/signup-lifecycle-events/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-10-05
- **Verdict**: APPROVED
- **Findings**: 0 critical 0 warnings 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Verification evidence

- `npx vitest run` (log, links, supabase-admin, links-route tests): 4 files, 59 tests passed.
- `npx vitest run` (whole suite): 234 passed.
- `npx tsc --noEmit`: exit 0.
- `npx eslint` on the six phase-1 files: exit 0.
- `npm run lint`: exit 0.
- `grep -rnE "console\.|eslint-disable-next-line no-console" src/pages/api/links.ts`: no output.
- Deliberate-break rows 1.5 and 2.6 not re-run (implementer ran them; re-running would edit src/). `git status` was clean before and after my checks apart from this report and change.md.
- Manual rows 2.7 and 2.8 are ticked; commit bd1229a body says "Rows 2.7 and 2.8 (manual) were confirmed by the user", which matches the lessons.md rule on recording how manual rows were verified. They rest on the user's confirmation, not on a script.
- Changed files vs plan: all planned files changed (log.ts, log.test.ts, links.ts, links.test.ts, supabase-admin.ts, supabase-admin.test.ts, api/links.ts, links-route.test.ts); the only extras are the change folder files (plan.md, plan-brief.md, change.md). No unplanned src files.

## Targeted checks

1. Token never logged: the only token reads in api/links.ts are the setLinkCookie call and the redirect; log calls use `result.id` only (line 74). Tests assert no line contains "new-token" (links-route.test.ts:208, 283).
2. Stage and createdLinkId: stage starts as count_recent, becomes create_link before createLink and set_cookie before setLinkCookie; createdLinkId is set before logInfo and before setLinkCookie, so a thrown setLinkCookie gives op set_cookie plus linkId. A SupabaseNotConfiguredError from createLink gives op create_link, no linkId. A throw inside the throttle count gives count_recent.
3. logInfo uses console.info (log.ts:98); the `src/lib/log.ts` override disables no-console for the whole file (eslint.config.js:91-94).
4. SupabaseNotConfiguredError keeps the message "Supabase is not configured" (supabase-admin.ts:18). Only src/lib/links.test.ts:48 (a mock that throws a plain Error) and the new supabase-admin test reference the text; nothing in src compares `err.message ===` to it.
5. Not-doing list respected: no link_recognised, no access_log or migration, no changes to turnstile, link-cookie or access-log, responses, redirects and cookies unchanged, regenerate.ts untouched.
6. Busy detail is `<count> of 3 in 10 minutes` with op count_recent; full uses op create_link. Both match the plan.

## Findings

### F1 — Token-absence assertion covers only 2 of the route's log cases

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/**tests**/links-route.test.ts:208
- **Detail**: Plan says "across all cases, no emitted line contains the token". The assertion exists only in the created case and the set_cookie failure case (line 283). The other cases never reach the token (it is only returned on success), so the invariant holds, but a later change could leak it unnoticed in those paths.
- **Fix**: Optionally move the `not.toContain("new-token")` check into an afterEach that scans all spied lines.
- **Decision**: FIXED — an afterEach in the events block of links-route.test.ts now asserts no spied line contains the token

### F2 — Error serialization on set_cookie failure is the one place a token could reach a line

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/links.ts:81-85
- **Detail**: The catch logs the serialized error. If setLinkCookie ever threw an error whose message embeds the token, it would be logged. Today the real setLinkCookie does not; the test throws an error without the token. No action required now.
- **Fix**: None needed; keep in mind if link-cookie.ts error messages change.
- **Decision**: FIXED — one-line comment at the catch in api/links.ts noting that nothing thrown above may put the token in its message
