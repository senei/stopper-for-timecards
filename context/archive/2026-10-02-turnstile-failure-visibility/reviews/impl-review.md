<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Make Turnstile failures visible to the operator

- **Plan**: context/changes/turnstile-failure-visibility/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
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

Evidence: the changed files are exactly the plan's (`src/lib/turnstile.ts`, `src/pages/api/links.ts`, `src/lib/turnstile.test.ts`, `src/__tests__/links-route.test.ts`, `src/lib/turnstile.integration.test.ts`); `index.astro`, `astro.config.mjs` and the widget are untouched, as the "not doing" list requires.

- Phase 1: `verifyTurnstile` returns the `TurnstileVerdict` union with the five reasons; only `response.ok && success === true` is `ok` (fail-closed holds, including a non-2xx answer that says `success: true`, which becomes `unavailable`). Events, levels and the operator-code set match the plan. No token, secret, IP or response body goes into any line. `links.ts` binds the verdict and refuses on `!verdict.ok`, so the always-false trap the plan warns about is closed; the verifier and the route changed in the same commit.
- Phase 2: the plan's design was corrected by evidence. Cloudflare answers a wrong or missing secret with HTTP 400 and the verdict in the body, so the verifier reads the body before the status decides (commit 8a4d351). This is documented in the plan's Migration Notes with the observed codes.
- Re-run today: `npx vitest run` 212 passed; `TURNSTILE_LIVE=1 npx vitest run --config vitest.integration.config.ts src/lib/turnstile.integration.test.ts` 4 passed against the real Cloudflare (the observed codes still hold); without the variable the suite is skipped (4 skipped), not failed; `npx tsc --noEmit` exit 0; `npm run lint` clean; `npx astro check` 0 errors.
- Not re-run: the phase 3 probe harness (needs the isolated worktree and `wrangler dev`). Its result was taken from commit 9e58afc and `context/audits/observability/2026-10-02_verify-turnstile-failure-visibility.md`.
- Manual rows 2.6, 3.6 and 3.7 are recorded as confirmed by the user in the phase commit bodies, as `lessons.md` asks.

## Findings

None.
