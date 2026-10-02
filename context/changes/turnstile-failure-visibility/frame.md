# Frame Brief: Turnstile failures and the page error boundary

> The framing step before /10x-plan. It records what the problem _actually is_, kept apart from what was first assumed.

## Reported Observation

From the observability audit (`context/audits/observability/2026-10-02_timer-delete-link-grid.md`) and its verify report, plus the user's own report in this session:

- **F2** (static finding): `verifyTurnstile` returns `false` for a missing secret, a Cloudflare outage and a real rejection alike, so a total sign-up outage would look like bot traffic. The user adds that they **have seen** "Verification failed; please try again." on production or preview with the widget **visible and solved**, and that the main worry is that sign-up may silently stop working.
- **F3** (observed, probes R9/R10): when `getCurrentTimer` / `listProjects` / `getProject` fail after a good link lookup, the page answers with an empty HTTP 500 whose only trace is Astro's own stack line. The user says they have also seen a blank 500 on production or preview.
- **F13**: the repo has no `src/middleware.ts` and no `src/pages/500.astro`.

## Initial Framing (preserved)

- **User-stated cause or approach**: one scope covering "make Turnstile failures distinguishable from bot rejections (F2), guard the page reads after the link lookup and add a 500 page and error boundary (F3, F13)".
- **User-proposed direction**: tell a Turnstile failure apart from a bot rejection; wrap the reads; add a 500 page and an error boundary.
- **Pre-dispatch narrowing**: the user has seen both a real Turnstile rejection (widget visible and solved) and a blank 500; the thing they worry about most is sign-up silently failing.

## Dimension Map

The observation can come from any of these dimensions:

1. **Server-side verification collapses outcomes** — `verifyTurnstile` folds several outcomes into `false` and never reads Cloudflare's `error-codes`. ← initial framing for F2
2. **Client-side widget delivers no token** — no `data-callback` / `data-error-callback` / `data-expired-callback`, button never gated on a token.
3. **Configuration** — both Turnstile keys are `optional: true`; a missing secret fails closed for every new visitor with no signal.
4. **User-facing message** — one generic banner for every cause (and the banner is driven by a forgeable `?error=` query).
5. **Page failure paths** — the real set of unguarded awaits. ← initial framing for F3
6. **Error boundary** — what Astro 7 + the Cloudflare adapter do with an uncaught error, and what a 500 page / middleware can and cannot cover.
7. **Scope shape** — whether sign-up and the page boundary are one change or two.

## Hypothesis Investigation

| Hypothesis                                                     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Verdict                                                                                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1. Server-side verification collapses outcomes                 | `turnstile.ts:18-20` (missing token or secret), `:33-35` (non-2xx), `:38` (any `success !== true`, `error-codes` never read; they appear only in a test fixture, `turnstile.test.ts:44`), `:39-42` (exception, the only branch that logs). `api/links.ts:39-40` turns every `false` into the same redirect.                                                                                                                                                                                                                                                                                                                                                 | **STRONG**                                                                                                                 |
| 2. Client widget delivers no token                             | `index.astro:56,65`: no callbacks, ungated submit; an empty token returns `false` at `turnstile.ts:18` with no log. The user says the widget was visible **and solved**, which rules this path out for the observed case, but it stays a latent path.                                                                                                                                                                                                                                                                                                                                                                                                       | **WEAK** (for the observed incident)                                                                                       |
| 3. Configuration (missing or mismatched secret, key, hostname) | `astro.config.mjs:22-23` both `optional: true`; no warning, no startup check; secrets live only in the Cloudflare dashboard (`wrangler.jsonc` has none). Fail-closed is a deliberate decision (`context/archive/2026-09-21-private-link-access/plan.md:55`, `plan-brief.md:55`). Whether production is misconfigured now is **not knowable from the repo**.                                                                                                                                                                                                                                                                                                 | **MEDIUM** (mechanism certain, occurrence unknown)                                                                         |
| 4. One generic message for every cause                         | `index.astro:21-26`; the generic copy was chosen on purpose (`plan.md:164`). `?error=verify` also renders with no failure at all (`index.astro:26`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **STRONG** that it is one message, **WEAK** that it is the problem: the operator, not the visitor, is the one who is blind |
| 5. Page failure paths: wrapping "those reads"                  | Exactly **two** unguarded awaits: `w/[token].astro:57` (after `logAccess("success")` at `:49`) and `w/[token]/projects/[projectId]/delete.astro:43`. Every other await in `src/pages` and all seven API routes is guarded or non-throwing. R9/R10: 500, empty body.                                                                                                                                                                                                                                                                                                                                                                                         | **STRONG** (framing right, narrower than "the reads")                                                                      |
| 6. A 500 page + boundary covers it                             | Verified in `node_modules/astro/dist/core/errors/default-handler.js`: with no `/500` route Astro returns `new Response(null, { status })` (`:105`); with `src/pages/500.astro` it renders it with `Astro.props.error` (`:73`, may be `null`) and middleware runs for it (`:76`). A middleware `try { await next() }` catches a frontmatter throw. **It cannot catch an error thrown after streaming starts** (P10b: 200, empty body). Headers set on the failed page (`Referrer-Policy`, `Cache-Control`, `X-Robots-Tag`) are lost on the blank 500 (derived from source, not captured by a probe); a 500 page or middleware response must set them itself. | **STRONG**, with three caveats the framing missed                                                                          |
| 7. One change or two                                           | File sets are disjoint (Turnstile: `turnstile.ts`, `api/links.ts`, `index.astro`, tests, smoke; boundary: two pages, new `500.astro` and `middleware.ts`); only `src/lib/log.ts` is shared and neither needs to change it. Neither blocks the other. Risk differs (sign-up vs presentation and logging); so does severity (F2 critical, F3/F13 medium). No roadmap slice or PRD NFR covers either.                                                                                                                                                                                                                                                          | **STRONG**: independent                                                                                                    |

## Narrowing Signals

- **The widget was visible and solved when the rejection happened** (user). That excludes "empty token" as the observed cause. What remains: a spent or expired token, a genuine rejection (including a hostname, site-key or secret mismatch), a missing secret, a Cloudflare 5xx, or an unexpected response shape. **Every one of those ends in the same `false`**, and none is logged, because `error-codes` are discarded and only the thrown-exception branch calls `logError`.
- **The user's main concern is sign-up silently stopping**, not what the visitor reads: the first thing missing is a signal for the operator.
- **Scope**: the user chose separate changes, Turnstile first.
- The audit's own recommendations already list the two items separately (`timer-delete-link-grid.md` fix order items 3 and 4).

## Cross-System Convention

- Fail-closed is a standing, documented decision for Turnstile; no change may relax it. The plan's contract was `verifyTurnstile(token, ip): Promise<boolean>`, so returning a reason changes a documented signature.
- There is no error tracker (`roadmap.md:76`); Workers Logs via `console` is the only channel, now fed through `src/lib/log.ts` (`logError` / `logWarn`) by the shipped `fix-silent-error-logging` change.
- The "Temporarily unavailable" view is copy-pasted into five places and has no tests; the 503 pattern was introduced ad hoc, not decided.
- The reframing fits this: the codebase already treats "log the event, keep the response" as the pattern for failures (`fix-silent-error-logging`); Turnstile is the one verdict that still discards its reason.

## Reframed Problem Statement

> **The real problem to plan around is**: when Turnstile rejects a sign-up, nothing records _why_ — `verifyTurnstile` throws away Cloudflare's reason and returns a bare boolean, so a legitimate visitor with a spent token, a widget/secret mismatch, a missing secret and a Cloudflare outage are indistinguishable to the operator, and the deliberate fail-closed rule turns any of them into a silent, total sign-up outage.

The user-facing copy, the widget callbacks and the page error boundary are separate questions. The page boundary is a different change with different risk (see below). If the plan keeps fail-closed (it must), the first deliverable is making the verdict carry a reason and making that reason visible to the operator; what the visitor is told in each case is a smaller, separate decision.

## Confidence

**HIGH** for what to plan around (verifier code, tests and the audit all agree; the user's report corroborates; the one alternative, an empty token, is excluded by the user's answer). One thing stays unknown and does not change the plan: whether production is currently misconfigured (secret, site key, hostname) — that cannot be read from the repo, and answering it is what the new logging is for.

Unverified prior knowledge the plan must check before relying on it (not evidence in this repo): the exact `error-codes` Cloudflare returns (`missing-input-secret`, `invalid-input-secret`, `invalid-input-response`, `timeout-or-duplicate`, `internal-error`); that tokens are single-use and live about 300 seconds (`plan.md:33` states it too, unverified); that a hostname mismatch is mostly reported at widget render time rather than by `siteverify`; whether the widget refreshes expired tokens on its own.

## What Changes for /10x-plan

Plan the **Turnstile** change only: the verifier's outcome carries a reason, Cloudflare's `error-codes` and the non-2xx / missing-secret / unexpected-shape cases are logged through `logError` / `logWarn`, and fail-closed stays exactly as it is. The page error boundary (F3, F13) is split off into its own change; the facts it will need are listed below so they are not lost. This change was renamed from `turnstile-and-error-boundary` to `turnstile-failure-visibility` to match the scope; the page error boundary continues as the separate change `page-error-boundary`.

Facts for the separate boundary change (not designed here): exactly two unguarded awaits (`w/[token].astro:57`, `w/[token]/projects/[projectId]/delete.astro:43`); `logAccess("success")` is written before the first of them (`w/[token].astro:49`), so a 500 leaves a "success" row; a 500 page is rendered fresh and must set `Referrer-Policy: strict-origin`, `Cache-Control: no-store` and `X-Robots-Tag: noindex` itself; `Astro.props.error` can be `null` and must not be shown; errors thrown after streaming starts reach neither a middleware nor a 500 page; the six action routes' body-less 503 stay blank whatever 500 page exists; there are no tests for any 503 view.

## References

- Source files: `src/lib/turnstile.ts:13-43`, `src/pages/api/links.ts:20-58`, `src/pages/index.astro:21-26,55-66`, `astro.config.mjs:22-23`, `scripts/smoke.mjs:127-143` (Turnstile gate), `src/pages/w/[token].astro:49,57`, `src/pages/w/[token]/projects/[projectId]/delete.astro:43`, `node_modules/astro/dist/core/errors/default-handler.js:26-107`
- Decisions: `context/archive/2026-09-21-private-link-access/plan.md:55,156,164,335`, `plan-brief.md:55`
- Audit: `context/audits/observability/2026-10-02_timer-delete-link-grid.md` (F2, F3, F13), `2026-10-02_verify-fix-silent-error-logging.md`
- Probe evidence (harness worktree): `.claude/worktrees/agent-a992330e2542a0e09/probe/out/` R9, R10, P10a, P10b
- Related research: none yet
