# Make Turnstile failures visible to the operator — Plan Brief

> Full plan: `context/changes/turnstile-failure-visibility/plan.md`
> Frame brief: `context/changes/turnstile-failure-visibility/frame.md`

## What & Why

> **The real problem to plan around is**: when Turnstile rejects a sign-up, nothing records _why_ — `verifyTurnstile` throws away Cloudflare's reason and returns a bare boolean, so a legitimate visitor with a spent token, a widget/secret mismatch, a missing secret and a Cloudflare outage are indistinguishable to the operator, and the deliberate fail-closed rule turns any of them into a silent, total sign-up outage.

The team has seen a real rejection with the widget solved and worries sign-up may silently stop. This change makes the reason visible in the logs.

## Starting Point

`src/lib/turnstile.ts` returns a boolean, never reads `error-codes`, and logs only a thrown exception. `src/pages/api/links.ts:39-40` turns every `false` into the same `/?error=verify`. The logger from `fix-silent-error-logging` exists; the route has no test; the smoke only uses always-pass dummy keys.

## Desired End State

Every refusal writes one log line with the reason (and Cloudflare's codes for a rejection), at `error` when the operator must act and `warn` when a visitor was refused. The route creates a link only on an explicit `ok`. The visitor sees exactly what they see today. A live test and a runtime check prove the real Cloudflare strings and the new lines.

## Key Decisions Made

| Decision        | Choice                                                                        | Why (1 sentence)                                                                                                                         | Source |
| --------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| What to plan    | Turnstile verdict visibility only; the page error boundary is split off       | Disjoint files, different risk and severity; the user chose "Turnstile first".                                                           | Frame  |
| Fail-closed     | Unchanged and pinned by a route test                                          | It is a documented decision (`private-link-access/plan.md:55`).                                                                          | Frame  |
| Return shape    | `{ ok: true } \| { ok: false, reason, errorCodes? }` with five reasons        | The type forces every reason to be handled and the logs can rely on it; changes the old `Promise<boolean>` contract.                     | Plan   |
| Who logs        | The verifier, not the route                                                   | One place that knows the reason, so no caller can forget.                                                                                | Plan   |
| Log policy      | Every refusal, `error` for operator-side causes, `warn` for a refused visitor | One line per refusal also shows how often real users hit a spent or empty token, which is the evidence for the widget-callback question. | Plan   |
| Visitor message | No change                                                                     | No new copy and no new forgeable `?error=` value; smaller scope.                                                                         | Plan   |
| Testing         | Unit + route test + opt-in live test with Cloudflare's dummy secrets          | Proves the real `error-codes` strings and catches documentation drift without fault injection.                                           | Plan   |
| Phasing         | Verifier and route change in one phase                                        | An object return makes `!(await verify())` always false, which would fail open.                                                          | Plan   |

## Scope

**In scope:** `src/lib/turnstile.ts`, `src/pages/api/links.ts`, the verifier's tests, a new route test, an opt-in live test, a runtime before/after check and a verify report.

**Out of scope:** widget callbacks, a different visitor message, startup validation of the keys, alerting, the page error boundary (`page-error-boundary`), smoke scenarios with failing keys.

## Architecture / Approach

The verifier maps what Cloudflare (or the network) did to one of five reasons, logs it through `src/lib/log.ts`, and returns the verdict. The route only continues on `ok: true`. Operator-side Cloudflare codes (`invalid-input-secret`, `bad-request`, `internal-error`, `missing-input-secret`) log at `error`, the rest of a rejection at `warn`. Nothing secret is logged: no token, secret, IP or response body.

## Phases at a Glance

| Phase                                         | What it delivers                                                                          | Key risk                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1. Verdict with a reason, logs, and the route | New verdict type, logs, fail-closed route, rewritten unit tests, first route test         | A mixed state would fail open; verifier and route must land together    |
| 2. Opt-in test against the real siteverify    | Live test with Cloudflare's dummy secrets, full lint and astro check                      | Needs network; the dummy secrets' exact codes are unknown until it runs |
| 3. Runtime proof through the real route       | Before/after run of the real route with three secret configurations, plus a verify report | Needs the probe worktree and network; the baseline must be taken first  |

**Prerequisites:** network access to `challenges.cloudflare.com` for phases 2 and 3; the probe worktree `.claude/worktrees/agent-a992330e2542a0e09`; `fix-silent-error-logging` already merged (it is).
**Estimated effort:** about 2–3 sessions across 3 phases; phase 1 is the bulk.

## Open Risks & Assumptions

- Cloudflare's documentation, read in this session, confirms the `error-codes` and the 300-second single-use token; the exact codes returned by the dummy secrets are verified only when phase 2 runs.
- A hostname mismatch is reported by the widget (client-side, `110200`), not by `siteverify`, so it will not show in these logs; a widget error would still leave the token empty (`missing_token`).
- Log volume from anonymous refused POSTs is steerable from outside; accepted, and each such request is already a Workers invocation.
- Whether production is misconfigured right now is unknowable from the repo; the new logs are how that gets answered.

## Success Criteria (Summary)

- A rejected, spent, empty or unconfigured sign-up each leaves a distinct, readable log line.
- No refusal can create a link, and the visitor's experience is unchanged.
- The real route's before/after logs show the three causes told apart.
