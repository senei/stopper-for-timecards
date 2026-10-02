---
date: 2026-10-02T15:01 (local time; the shell did not report a timezone name)
researcher: Claude Code (claude-sonnet-5-5)
git_commit: 383a92f
branch: main
repository: x10-dev--curse
topic: "What does Astro 7 with the Cloudflare adapter do with an uncaught page error, and what can a 500 page and a middleware boundary cover?"
tags: [research, codebase, astro, error-pages, middleware, cloudflare-workers, observability, page-error-boundary]
status: complete
last_updated: 2026-10-02
last_updated_by: Claude Code (claude-sonnet-5-5)
---

# Research: What does Astro 7 with the Cloudflare adapter do with an uncaught page error, and what can a 500 page and a middleware boundary cover?

**Date**: 2026-10-02T15:01 (local time)
**Researcher**: Claude Code (claude-sonnet-5-5)
**Git Commit**: 383a92f (working tree has this untracked change folder only; the experiments ran in an isolated worktree at `1f718d2`)
**Branch**: main
**Repository**: x10-dev--curse

## Research Question

For the change `page-error-boundary` (guard the two unguarded page reads after the link lookup, add a 500 page and an error boundary): what does Astro 7.3.2 with `@astrojs/cloudflare` 14.3.1 actually do when a page throws, as observed in a running production build under `wrangler dev`, and what can `src/pages/500.astro` and `src/middleware.ts` cover? The frame (`context/changes/turnstile-failure-visibility/frame.md`) derived several answers from source reading and marked them unverified; this research checks them by running, adds how the result could be tested here, and checks the Astro documentation.

## Summary

All statements below are about the `wrangler dev` run of a production build (local workerd, local Supabase behind a fault-injecting proxy), not the real Cloudflare edge. "Observed" means a running request; "inferred" means source or documentation reading only.

- **The blank 500 loses the privacy headers (observed).** In the baseline build (no `500.astro`, no middleware) the failing requests R9, R10, D1, P10a and P1 answered `500` with a 0-byte body, no `content-type`, and none of `Referrer-Policy`, `Cache-Control` or `X-Robots-Tag`; the workspace page sets all three on `Astro.response` before it throws, and they are discarded. A healthy workspace page and the 404 page carry all three.
- **A `src/pages/500.astro` renders in that build (observed).** For the same five requests it answered `500`, `text/html`, 690 characters, and the three headers that `500.astro` sets itself reached the client. `Astro.props.error` was defined and an `Error` instance for the page throws and for the API-route throw, and Astro still logged the original error with its stack.
- **A middleware `try { await next() } catch` fires for those five requests (observed).** What it can do: rethrow (the 500 page then receives `error`), return its own `Response` (sent as is), or `ctx.rewrite("/500")` (the 500 page renders with status 500 but **without** the error prop, and Astro does **not** log the original error). `ctx.routePattern` is available and contains no token (`/w/[token]`); `ctx.url.pathname` contains the token.
- **Neither a 500 page nor a middleware covers an error thrown after streaming has started (observed, one probe).** P10b (a throw in a child component after the stream began) answered `200`, `text/html`, 0 bytes, in the baseline and with the 500 page and with all three middleware variants; the only trace is Astro's `Uncaught Error` line, printed three times.
- **Explicit `503` responses from API routes stay blank and header-less with a 500 page and with all three tested middleware variants (observed on one route, `timer/start` with the link read failing).**
- **The unguarded set is the two awaits the frame named (verified at the cited lines).** `src/pages/w/[token].astro:57` and `src/pages/w/[token]/projects/[projectId]/delete.astro:43`; the first runs after `logAccess(..., "success")` at `:49`.
- **Tests: no test in `src`, `tests` or `scripts` exercises a page-level 500 or 503 view (grep), and `astro:middleware` does not resolve in the default vitest run (inspected, not run).** A middleware written as a plain `(ctx, next)` function with only type imports from `astro` avoids the virtual module (inference).

## Detailed Findings

### 1. The current blank 500 (observed, baseline E1)

- Requests R9 (time-entries read fails), R10 (projects read fails), D1 (`getProject` fails on the delete page), P10a (frontmatter throw) and P1 (API-route throw), each on the baseline build: status 500, body length 0, no `content-type`, leak headers absent. Data: `.claude/worktrees/agent-a992330e2542a0e09/probe/boundary-out/E1/results.json` (fields `status`, `headers`, `bodyLength`, `console`).
- Controls on the same build: the healthy workspace page answered 200 with all three leak headers and 9655 characters; an unknown well-formed token answered 404 with all three headers and the 693-character 404 page.
- Source explanation: with no `/500` route, Astro builds `new Response(null, { status })` and merges it with the original response only when one was passed (`node_modules/astro/dist/core/errors/default-handler.js:105-106`); the catch that logs the error passes none (`dist/core/routing/handler.js:101-108`).
- Astro logs the original error itself with its stack (`logger.error(null, err.stack || err.message || String(err))`, `handler.js:102`); it logs no route, link id or request id.

### 2. A `500.astro` page (observed, E2; documentation checked)

- With a probe `src/pages/500.astro` (Layout + PageCard like `404.astro`, setting the three headers on `Astro.response`), R9, R10, D1, P10a and the API-route throw P1 each answered `500`, `text/html`, 690 characters, with the three headers present. Data: `boundary-out/E2/results.json`.
- Observed props: the page's marker line printed `props=["error"] typeof=object isError=true status=500`. For P1 (an API route) the response was the HTML 500 page, so a JSON or form-post caller of an API route that throws also receives HTML.
- Astro still logged the original error with its stack before the page rendered (E2 console for R9).
- Source: the error route is looked up and rendered with `errorState.initialProps = { error }` (`default-handler.js:24-34,73`); the production environment declares `errorStrategy: "default"` (`dist/core/environment/production.js:110`), the strategy this default handler belongs to (the link between the two was read earlier, not re-traced here).
- Documentation (`docs.astro.build/en/basics/astro-pages/`): a `500.astro` is "automatically passed an `error` prop for any error thrown during rendering", it is not available for prerendered pages, and it warns against displaying the error's stack. The page says nothing about the HTTP status, about adapters, or about what happens when `500.astro` itself throws.
- Not probed: the case where `error` is `null` (a 500 produced by a null-body `Response`, `routing/handler.js:126-138`, per source reading), and a throw inside `500.astro`.

### 3. A middleware boundary (observed, E3 a/b/c; documentation checked)

Tested on top of the E2 build, for R9, R10, D1, P10a, P1, P10b, the 503 route, the 404 rewrite, a static asset and the healthy page. Data: `boundary-out/E3a`, `E3b`, `E3c`.

- **Catch fires** for R9, R10, D1, P10a and P1 in all three variants; it does not fire for P10b (`next()` had already resolved 200), for the 503 route (`next()` resolved 503), the 404 rewrite or the healthy page.
- **`routePattern`:** `/w/[token]` for R9 and R10, `/w/[token]/projects/[projectId]/delete` for D1, `/api/zprobe/[id]` for P1; the token does not appear in it. `ctx.url.pathname` contains the token (and the project id for D1). Source: `dist/core/middleware/sequence.js:60` sets it from `routeData.route`; the type is documented in `dist/types/public/context.d.ts:570-583`, and `docs.astro.build/en/reference/api-reference/` lists it as added in Astro 5.0.0.
- **Variant (a), log and rethrow:** the 500 page renders with `props.error` defined and an `Error`; Astro still logs the error. Astro's own 500 render re-enters the middleware as `routePattern=/500` while `ctx.url.pathname` stays the original path.
- **Variant (b), return a custom `Response`:** sent as is, including its explicit leak headers; Astro printed no error line for the original error (only the probe's marker).
- **Variant (c), `ctx.rewrite("/500")`:** the client received 500 with the 500 page, the page saw `props=[]` (`error` undefined) and `Astro.response.status` 200 inside the page, and Astro printed no error line for the original error.
- **404 rewrite:** the middleware ran twice (`/w/[token]`, then `/404`), both resolved 404, and the response was byte-identical to the baseline in all three variants.
- **Static asset `/favicon.png`:** the middleware never ran (no marker line) and the response was unchanged; the cause is inferred (the assets binding answers before the Worker), not observed.
- **Healthy page:** 200, all three leak headers, 9655 characters, identical to the baseline in all three variants.
- Documentation (`docs.astro.build/en/guides/middleware/`): custom `Response` and rewrite are supported and middleware runs for error pages; the page does **not** state that a `try/catch` around `next()` catches rendering errors, so that part rests on the observation above.

### 4. Errors after streaming has started (observed, P10b)

- P10b is a throw in a child component after the head was written (`src/pages/zprobe/ssr.astro` and `StreamBoom.astro` in the harness worktree, not in the main tree). Baseline, with the 500 page, and with each middleware variant: status 200, `text/html`, body length 0, and the console shows `Uncaught Error ...` three times with no Astro `[ERROR]` line.
- The empty body means even the already-written head did not reach the client; the cause is inferred to be buffering and was not isolated.
- Source: the stream is returned first and rendering continues; a later error goes to `controller.error` via `setTimeout` (`node_modules/astro/dist/runtime/server/render/astro/render.js:62-74`, per the earlier source reading). Because `next()` has resolved by then, neither the middleware nor `/500` is reached on this inspected path.
- Consequence for scope (this inspected path only): errors in `Layout`, `WorkspaceCard`, `PageCard` or other child components that run after streaming starts are outside what a 500 page or middleware can turn into a page; the 200-empty outcome and the three console lines are all there is.

### 5. API routes and explicit 503 responses (observed on one route)

- An uncaught throw in an API route (P1) renders the HTML 500 page once `500.astro` exists; before, it was blank (observed, E1 vs E2).
- An explicit `new Response(null, { status: 503 })` from `timer/start` (link lookup failing) stayed blank with no `content-type` and no leak headers in the baseline, with the 500 page, and with all three middleware variants (observed, request A503). The other five action routes use the same `return new Response(null, { status: 503 })` pattern (`src/pages/api/w/[token]/delete-account.ts`, `regenerate.ts`, `projects/[projectId]/delete.ts`, `timer/stop.ts`, `switch.ts`); they were not individually probed (inferred).
- Source: `renderEndpoint` sets `skipErrorReroute` for 404 and 500 responses (`dist/runtime/server/endpoint.js:41-43`) and a 503 is not in `REROUTABLE_STATUS_CODES = [404, 500]` (`dist/core/constants.js:6`, re-read).

### 6. The two unguarded reads and the surrounding page code (verified in the files)

- `src/pages/w/[token].astro:57`: `await Promise.all([getCurrentTimer(link.id), listProjects(link.id)])`, outside any `try`. Only the link lookup at `:30-35` is guarded and sets `unavailable = true` and status 503 at `:44`.
- `src/pages/w/[token].astro:49`: `await logAccess(link.id, Astro.request, "success")` runs before the reads, so a failure at `:57` leaves an `access_log` row with outcome `success` (verified by reading; not run).
- `Promise.all` rejects with the first rejection; whether both read errors appear in a log when both fail was not probed (inference from the language semantics).
- `src/pages/w/[token]/projects/[projectId]/delete.astro:43`: `project = await getProject(link.id, projectId)` outside any `try`; the lookup at `:27-32` is guarded.
- The "Temporarily unavailable" markup exists as five copies: `src/components/WorkspaceCard.astro:83` (the only one of these five files containing the text "Try again", grep), `src/pages/w/[token]/delete-account.astro:45`, `grid.astro:121`, `projects/[projectId]/delete.astro:57`, `regenerate.astro:41` (grep over `src`).
- Reusable shared pieces: `src/components/PageCard.astro` (card shell, `width` `md` or `xl`) and `src/layouts/Layout.astro` (bare html/head/body with a title); `404.astro:5-8` shows the convention of setting the three headers on the page itself.

### 7. Testability (inspected, nothing run)

- `astro:middleware` is aliased only inside Astro's own Vite config (`node_modules/astro/dist/core/create-vite.js:222-225`); `vitest.config.ts` has only the `@` alias, so importing `defineMiddleware` from `astro:middleware` in a test file would not resolve in the default suite (inference from the two files). `astro/virtual-modules/middleware.js` loads in plain Node and exports `defineMiddleware` and `sequence`, and `astro/middleware` exports `createContext`, `defineMiddleware`, `sequence` (checked with `node -e import(...)`; not checked under vitest). `defineMiddleware` is an identity function (`dist/core/middleware/defineMiddleware.js:1-3`).
- A boundary written as a plain function of `(context, next)` with `import type` only from `astro` needs no virtual module, the same style the route tests use for `APIContext` (`src/__tests__/timer-routes.test.ts:2`); `src/middleware.ts` would then be a one-line wrapper (inference).
- A `.astro` page cannot be imported by the default vitest run: no test imports one, and `happy-dom` is installed (`package.json:53`) but referenced by no vitest config or source file (grep). Astro 7 exports `experimental_AstroContainer` (`node_modules/astro/package.json:37`, `dist/container/index.js:415-417`); feasibility inside this repo's vitest setup is not demonstrated and would likely need Astro's Vite config (`getViteConfig`, `dist/config/index.js:4`).
- End to end: `playwright.config.ts:17-40` has one project and one `webServer` (`npm run build && npm run preview`), seeding goes straight to the local Supabase through `src/test/integration-db`, and no mechanism exists to make a server-side read fail; browser-side request interception cannot reach the Worker's own fetches.
- Smoke: `scripts/smoke.mjs:104-113` (`checkLeakHeaders`) requires status 200 and the three headers, and is applied to five healthy pages (`/w/<token>`, `/regenerate`, `/delete-account`, `/grid`, `/projects/<id>/delete`); the smoke asserts 404 on unknown or old tokens (for example lines 427, 430, 522, 550, 633, 636) and never asserts a 500 or 503. The observed middleware and 500 page left the healthy pages and the 404 page byte-identical.
- Test net: no unit, route, e2e or smoke test exercises a page-level 500 or 503 view or the "Temporarily unavailable" markup (grep of `src`, `tests`, `scripts`); the route-level 503s are covered only for API routes (`src/__tests__/*-route*.test.ts`).
- Lint constraints for new files (`eslint.config.js`): `no-restricted-syntax` rejects a `catch` without a binding in `src/**/*.{ts,tsx,astro}` (lines 75-89); `no-console` is an error outside `src/lib/log.ts` (line 25, override at 91-94); strict type-aware rules apply to `src/middleware.ts`; `src/lib/log.ts` `LogContext` requires `route` and has no token field (`log.ts:5-13`).

## Code References

- `src/pages/w/[token].astro:49,57` - `logAccess("success")` before the unguarded `Promise.all`
- `src/pages/w/[token]/projects/[projectId]/delete.astro:43` - unguarded `getProject`
- `src/pages/404.astro:5-8` - the three headers set on the page; the convention a 500 page must follow
- `src/components/PageCard.astro:1-29`, `src/layouts/Layout.astro:1-31` - reusable shell
- `src/components/WorkspaceCard.astro:83`, `src/pages/w/[token]/{delete-account,grid,regenerate}.astro`, `delete.astro:57` - the five "Temporarily unavailable" copies
- `src/lib/log.ts:5-13,87-94` - `LogContext`, `logError`, `logWarn`
- `node_modules/astro/dist/core/errors/default-handler.js:24-34,73,105-106` - error route lookup, `initialProps = { error }`, blank fallback
- `node_modules/astro/dist/core/routing/handler.js:101-108` - where Astro logs the original error and renders the error page
- `node_modules/astro/dist/core/middleware/sequence.js:60` - `routePattern` from `routeData.route`
- `node_modules/astro/dist/core/create-vite.js:222-225` - the only `astro:middleware` alias
- `node_modules/astro/dist/core/constants.js:6` - `REROUTABLE_STATUS_CODES = [404, 500]`
- `.claude/worktrees/agent-a992330e2542a0e09/probe/boundary.mjs`, `boundary-out/{E1,E2,E3a,E3b,E3c}/results.json` - the harness and the raw observations (token and link id redacted)
- `scripts/smoke.mjs:104-113` - `checkLeakHeaders`; `playwright.config.ts:17-40` - single `webServer`

## Architecture Insights

- The privacy convention is page-local: each tokenized page sets `Referrer-Policy`, `Cache-Control` and `X-Robots-Tag` on `Astro.response`, and in the observed failing requests those headers set before the throw did not reach the client (section 1). Astro's blank error response did not inherit them, so an error response for a `/w/<token>` or `/api/w/<token>/...` URL has to set them itself, as `404.astro` does (observed: with `500.astro` they reach the client; with a middleware-built `Response` only the explicitly set ones do).
- Error handling in Astro sits at three layers with different reach: the in-page `try/catch` (existing pattern: log, `unavailable = true`, 503 view), the middleware (catches throws raised while `next()` is pending), and the `/500` route (rendered by Astro after an uncaught throw, or by rewrite). On the inspected path (P10b), none of them sees an error raised after streaming started.
- A swallowing middleware removes Astro's own error log for that request (observed in variants (b) and (c)); a rethrowing one keeps it and re-enters the middleware for the 500 render (observed in (a): `routePattern=/500`, original `pathname`). So logging inside a boundary that rethrows can double-log, and logging inside one that swallows is the only record.
- The existing observability layer (`src/lib/log.ts`, `fix-silent-error-logging`) makes log lines route-template based and token-free; `ctx.routePattern` fits `LogContext.route` directly, `ctx.url.pathname` does not.

## Historical Context (from prior changes)

Claims of `context/changes/turnstile-failure-visibility/frame.md` ("Facts for the separate boundary change"), scored one by one against this research:

- "Exactly two unguarded awaits (`w/[token].astro:57`, `delete.astro:43`)" - supported (verified at the lines above; the line numbers are the current ones).
- "`logAccess("success")` is written before the first of them (`:49`), so a 500 leaves a 'success' row" - supported by reading the file; not run.
- "A 500 page is rendered fresh and must set the three headers itself" - supported (observed in E2: with `500.astro` setting them they reach the client; E1: they are absent without it).
- "`Astro.props.error` can be `null` and must not be shown" - partly supported: it was defined and an `Error` in the probed page and API-route throws (observed), the `null` case was not probed (source reading only), and not showing it is also the documentation's advice.
- "Errors thrown after streaming starts reach neither a middleware nor a 500 page" - supported on the one inspected path (P10b).
- "The six action routes' body-less 503 stay blank whatever 500 page exists" - supported by observation for `timer/start`; inferred for the other five (same code pattern).
- "There are no tests for any 503 view" - supported (grep and the testability inventory).
- "Headers set on the failed page are lost on the blank 500 (derived from source, not captured by a probe)" - now supported by observation (E1).
- "A middleware `try { await next() }` catches a frontmatter throw" - now supported by observation (E3).

Other:

- `context/changes/fix-silent-error-logging/plan.md` and `context/audits/observability/2026-10-02_verify-fix-silent-error-logging.md` - the page lookup catches already log (`page_link_lookup_failed`); R9 and R10 were the rows that did not improve, the origin of this change.
- `context/audits/observability/2026-10-02_timer-delete-link-grid.md` - F3 and F13.

## Related Research

A grep of the nine archived `context/archive/*/research.md` files for `middleware`, `500.astro`, `error page` and `errorStrategy` found no match, so no earlier research covers error pages or middleware.

## Open Questions

- **Where to guard the two reads:** in the page with the existing `unavailable` 503 view (consistent with the other pages, keeps the friendly view and the status), through the boundary only (gives the generic 500 page), or both. Product/design choice for the plan; the research establishes only what each can and cannot cover.
- **What a 500 page may say and whether API callers should get HTML:** an uncaught API-route throw now returns the HTML page (observed). Whether that is wanted for form-post or JSON callers is undecided.
- **Which boundary shape, if any, beyond `500.astro`:** rethrow (keeps Astro's log, the 500 page gets `error`), swallow with its own `logError` (no Astro log, no `error` prop unless passed another way), or none. The observed trade-offs are in section 3.
- **Whether to deduplicate the five "Temporarily unavailable" copies:** reusing PageCard/Layout in a 500 page is possible; extracting a shared component is a scope decision.
- **Not probed:** non-GET page throws; `Astro.rewrite("/500")` from inside a page; a throw inside `500.astro`; the `null` error case; the real Cloudflare edge (for example Cloudflare-level error pages or `cf-cache-status`); `astro dev` behaviour (uses a different error strategy); whether both read errors appear when both `Promise.all` reads fail.
- **How to test:** a plain-function middleware is unit-testable in principle; testing a `.astro` 500 page, and any e2e that needs a failing server-side read, has no existing mechanism here (Container feasibility unproven; no e2e fault injection). The plan has to choose a verification route (for example the probe harness already used for the audit's before/after runs, as in the two earlier changes).
