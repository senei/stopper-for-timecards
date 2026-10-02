# Guard page reads and add a 500 page and error boundary Implementation Plan

## Overview

After a successful link lookup, two pages read from the database without a `try`: when that read fails, the visitor gets an empty HTTP 500 with none of the privacy headers, and the only trace is Astro's own stack line. This plan makes those two reads fail the way the other pages already do (a logged event and the existing "temporarily unavailable" view with status 503), and adds a `500.astro` page plus a small middleware boundary for the failures nobody anticipated. It implements F3 and F13 of the observability audit.

## Current State Analysis

The research (`context/changes/page-error-boundary/research.md`) answered by running a production build under `wrangler dev`; this plan does not re-investigate it.

- Two unguarded awaits: `src/pages/w/[token].astro:57` (`Promise.all([getCurrentTimer(link.id), listProjects(link.id)])`, after `logAccess(..., "success")` at `:49`) and `src/pages/w/[token]/projects/[projectId]/delete.astro:43` (`getProject(link.id, projectId)`). Only the link lookup is guarded in both (`[token].astro:30-35`, `delete.astro:27-32`).
- The pattern to repeat exists: `src/pages/w/[token]/grid.astro:74-86` wraps its read in `try/catch`, calls `logError("page_week_entries_failed", { route, linkId, op }, err)`, sets `unavailable = true` and `Astro.response.status = 503`; `WorkspaceCard.astro:83` and `delete.astro:55-58` already render the "Temporarily unavailable" view for that flag.
- Observed on the baseline build: R9, R10, D1 (the failing reads), P10a (frontmatter throw) and P1 (API-route throw) answer `500`, 0 bytes, no `content-type`, none of `Referrer-Policy`, `Cache-Control`, `X-Robots-Tag`. A `src/pages/500.astro` makes them render as an HTML page with status 500 and the headers that page sets itself; `Astro.props.error` is then an `Error`. A middleware `try { await next() } catch` fires for the same five; `ctx.routePattern` is `/w/[token]`, with no token (`ctx.url.pathname` has it).
- Observed limits: an error thrown after streaming starts (P10b) answers 200 with an empty body whatever is added; explicit body-less `503` responses from API routes stay blank.
- There is no `src/middleware.ts` and no `src/pages/500.astro`. Nothing in `src`, `tests` or `scripts` tests a page-level 500 or 503. `astro:middleware` does not resolve in the default vitest run (`vitest.config.ts` has only the `@` alias; Astro's own alias is at `node_modules/astro/dist/core/create-vite.js:222-225`), and no test imports an `.astro` file.
- The logger exists: `src/lib/log.ts` (`logError`, `logWarn`, `LogContext` with a required route template and no token field). ESLint rejects a `catch` without a binding and any `console` call outside `log.ts`.
- All nine callers of the seven API routes are HTML forms (`<form method="post">` in `WorkspaceCard.astro`, `index.astro`, and the delete, regenerate pages); no `fetch`, XHR or JSON appears in `src` (grep), so HTML from an API route's uncaught throw reaches only browsers submitting forms.

## Desired End State

- A failed timer/projects read on the workspace page, and a failed project read on the delete page, answer `503` with the existing "Temporarily unavailable" view, the three privacy headers, and one `logError` line carrying the route template and the link id.
- An error nobody anticipated, in a page or an API route, answers `500` with a small HTML page that sets the three headers itself and shows no error text, and leaves one `logError` line with the route template (`GET /w/[token]`), never the token; Astro still logs the error with its stack.
- Everything else is byte-identical to before: healthy pages, the 404 page, static assets, the existing 503 views and the blank API 503s.
- A before/after run of the probe harness shows all of this.

### Key Discoveries:

- Rethrow, never swallow: a middleware that swallows the error removes Astro's own error log for that request (observed in two of three variants), and `ctx.rewrite("/500")` drops the `error` prop and renders with status 200 inside the page.
- A response Astro builds for an error does not carry the headers a page set before it threw (observed); the boundary's page must set them itself, and `500.astro` setting them is enough for them to reach the client (observed).
- Astro's own 500 render re-enters the middleware as `routePattern=/500` while `ctx.url.pathname` keeps the original path (observed); logging only inside the `catch` therefore produces one event per failing request, not two.
- The route label for the log must come from `ctx.routePattern`, never from the pathname, which carries the token (and the project id on the delete page).
- Both reads in `Promise.all` fire together; only the first rejection reaches the `catch` (language semantics, not probed), so when both fail only one error is logged.

## What We're NOT Doing

- No handling of errors thrown after streaming starts (P10b): neither a 500 page nor a middleware can reach them; a per-component boundary would be a separate change.
- No change to the order of `logAccess("success")` before the reads: `access_log` records the outcome of the link access, and the link did resolve; a later page read failing does not change that.
- No shared "unavailable" component: the five copies of the "Temporarily unavailable" markup stay, and the 500 page has its own text.
- No content negotiation: the API routes are called only by HTML forms, so an uncaught API throw returns the same HTML page.
- No change to the explicit body-less `503` responses from API routes.
- No `astro:container` test and no change to `vitest.config.ts`.
- No change to `astro dev` behaviour (it uses a different error strategy) and no check against the real Cloudflare edge.
- No change to the other pages, to cookies, to Turnstile, or to `access_log`.

## Implementation Approach

Three steps, smallest and most local first: guard the two known reads in their pages (phase 1), then add the boundary for unknown failures as a plain function plus a thin Astro wrapper and a 500 page (phase 2), then prove the whole thing against a baseline in the probe harness (phase 3). The boundary's logic lives in `src/lib/error-boundary.ts` as a plain function so it can be unit-tested without Astro's virtual module; `src/middleware.ts` only wires it in.

## Critical Implementation Details

- **Debug & observability:** the boundary must rethrow the original error object unchanged and log from the `catch` only. It must not log on entry (the 500 render re-enters the middleware) and must label the event with `${method} ${routePattern}`, never the pathname or URL.
- **User experience spec:** `500.astro` must set `Referrer-Policy: strict-origin`, `Cache-Control: no-store` and `X-Robots-Tag: noindex` itself, as `404.astro:5-8` does (`strict-origin`, never `no-referrer`, per `context/foundation/lessons.md`), must not render `Astro.props.error` or its message or stack (the docs advise it and the error may carry user data), and must not link to the failing URL, which holds a token.
- **State sequencing:** in `delete.astro` the 404 rewrite for a missing project must run only when the read succeeded; a failed read must reach the 503 view, not the 404.

## Phase 1: Guard the two page reads

### Overview

Make the two unguarded reads fail like `grid.astro` does: log, show the existing "Temporarily unavailable" view, answer 503.

### Changes Required:

#### 1. Workspace page

**File**: `src/pages/w/[token].astro`

**Intent**: A failed timer or projects read must not turn into a blank 500; it should look like the lookup failure on the same page and leave a structured log line with the link id.

**Contract**: wrap the `Promise.all` at `:57` and the two assignments after it in `try/catch`; in the `catch` call `logError("page_workspace_read_failed", { route: "GET /w/[token]", linkId: link.id }, err)`, set `unavailable = true` and `Astro.response.status = 503`. Everything before it (the lookup guard, `logAccess`, the cookie) and the `WorkspaceCard` props stay as they are.

#### 2. Project delete page

**File**: `src/pages/w/[token]/projects/[projectId]/delete.astro`

**Intent**: Same treatment for `getProject`, without a failed read being mistaken for a missing project.

**Contract**: wrap `getProject(link.id, projectId)` at `:43` in `try/catch`; in the `catch` call `logError("page_project_read_failed", { route: "GET /w/[token]/projects/[projectId]/delete", linkId: link.id, projectId }, err)`, set `unavailable = true` and `Astro.response.status = 503`. The existing `rewrite("/404")` for a missing project (`:44-46`) runs only when `unavailable` is false.

### Success Criteria:

#### Automated Verification:

- Changed pages lint clean: `npx eslint "src/pages/w/[token].astro" "src/pages/w/[token]/projects/[projectId]/delete.astro"`
- Astro check passes: `npx astro check`
- Whole suite stays green: `npx vitest run`
- Type checking passes: `npx tsc --noEmit`

---

## Phase 2: The boundary and the 500 page

### Overview

Add the boundary function, its Astro wrapper and the 500 page, with unit tests for the function.

### Changes Required:

#### 1. The boundary function

**File**: `src/lib/error-boundary.ts` (new)

**Intent**: Turn any error raised while a request is rendered into one structured log line, without changing what happens to the error.

**Contract**: `errorBoundary(context: Pick<APIContext, "request" | "routePattern">, next: () => Promise<Response>): Promise<Response>` with `import type` only from `astro`. It awaits `next()` and returns the response untouched; if `next()` throws, it calls `logError("unhandled_request_error", { route: \`${context.request.method} ${context.routePattern}\` }, err)` and rethrows the same value. It never logs on a normal or error-status response and never reads the URL.

#### 2. The middleware wrapper

**File**: `src/middleware.ts` (new)

**Intent**: Run the boundary for every on-demand request.

**Contract**: `export const onRequest = defineMiddleware((context, next) => errorBoundary(context, next))` with `defineMiddleware` from `astro:middleware`. No other logic.

#### 3. The 500 page

**File**: `src/pages/500.astro` (new)

**Intent**: Replace the blank 500 with a small page that keeps the privacy headers and says nothing about the error.

**Contract**: sets the three headers on `Astro.response.headers` like `src/pages/404.astro:5-8`; renders `Layout` and `PageCard` (`width="md"`) with a heading "Something went wrong" and one sentence asking the visitor to try again in a moment; no links, no use of `Astro.props.error`. The final wording is confirmed by the human (manual check).

#### 4. Unit tests

**File**: `src/lib/error-boundary.test.ts` (new)

**Intent**: Pin that the boundary logs once, with a token-free route label, and never changes the outcome.

**Contract**: with a fake context (`{ request, routePattern }`, cast as the route tests do) and a spy on `console.error`: a resolved response of each of 200, 404, 500 and 503 is returned as the same object and logs nothing; a throwing `next` produces exactly one `unhandled_request_error` line whose `route` is `GET /w/[token]` and whose `error` carries the message and stack, and the same error object is rethrown; the line contains neither the token nor the project id when the request URL holds both; a non-`Error` throw (a string) is logged and rethrown unchanged.

### Success Criteria:

#### Automated Verification:

- Boundary tests pass: `npx vitest run src/lib/error-boundary.test.ts`
- Whole suite stays green: `npx vitest run`
- Type checking passes: `npx tsc --noEmit`
- Lint is clean (run once here, the last code phase; if it reports unresolved `import.meta.env` types, delete `node_modules/.cache/eslint/` and rerun per `lessons.md`): `npm run lint`
- Astro check passes (resolves `astro:middleware`): `npx astro check`
- Deliberate break: in a worktree-only edit, a boundary that returns a `Response` instead of rethrowing turns the rethrow case red, and one that labels the event with the URL path turns the token case red; both edits are reverted afterwards

#### Manual Verification:

- The text on the 500 page was read and approved

---

## Phase 3: Runtime proof through the probe harness

### Overview

Rerun the research's probe harness on the code before this change and on the final code, and compare.

### Changes Required:

#### 1. The runs

**Location**: isolated worktree `.claude/worktrees/agent-a992330e2542a0e09`, nothing committed from it

**Intent**: Observe the same requests the research used, before and after, in a production build under `wrangler dev`.

**Contract**: with local Supabase running, detach the worktree at the commit just before this change's phase 1 (`git checkout --detach <sha>`), run `node probe/boundary.mjs before` (the script rebuilds unless `--skip-build`), then detach at this change's final commit and run `node probe/boundary.mjs after`; the harness fires R9, R10, D1, P10a, P10b, P1, A503, N404, ASSET and HEALTHY and writes headers, body length, console lines and the leak-header flag per request (the untracked `src/pages/zprobe/*` and `src/pages/api/zprobe/*` stay in the worktree). Afterwards stop the `wrangler`/`workerd` processes by port (`lessons.md`).

#### 2. The verify report

**File**: `context/audits/observability/<date>_verify-page-error-boundary.md`

**Intent**: Record the before/after table next to the audit that raised F3 and F13.

**Contract**: produced by `/10x-observability-audit --verify context/audits/observability/2026-10-02_timer-delete-link-grid.md` narrowed to F3 and F13 (a new file; earlier reports are not edited).

### Success Criteria:

#### Automated Verification:

- The harness runs on both commits and writes `results.json` for each: `node probe/boundary.mjs before` and `node probe/boundary.mjs after`
- After the change R9, R10 and D1 answer `503` with a non-empty HTML body and all three privacy headers, and the console shows a `page_workspace_read_failed` or `page_project_read_failed` line with a link id; the baseline answered `500` with an empty body and no headers
- After the change P10a and P1 answer `500`, `text/html`, a non-empty body and all three privacy headers, and the console shows an `unhandled_request_error` line whose route is a template (`GET /zprobe/ssr`, `GET /api/zprobe/[id]`)
- After the change P10b, A503, N404, ASSET and HEALTHY match the baseline in status, body length and the three headers (P10b stays 200 and empty, A503 stays a blank 503)
- No `unhandled_request_error` or `page_*_read_failed` line contains the seeded token or the link id inside a URL, except the `linkId` field itself
- No process is left listening on the probe ports

#### Manual Verification:

- The before/after table was read and the failing requests are visibly diagnosable, with unchanged requests unchanged
- A `mode: verify` report with the table is written under `context/audits/observability/` and earlier reports are untouched

---

## Testing Strategy

### Unit Tests:

- The boundary function: passthrough of any resolved response without logging, one token-free `unhandled_request_error` line on a throw, the same error rethrown, non-`Error` throws handled.

### Integration Tests:

- None added: pages and `500.astro` cannot be imported by the default vitest run (research §7), so they are proven by the probe harness; no existing mechanism makes a server-side read fail in Playwright or smoke.

### Manual Testing Steps:

1. In a browser against a local build with Supabase stopped, open the workspace page and the project delete page and confirm the "Temporarily unavailable" view appears (status 503) with a "Try again" link on the workspace page.
2. Submit a form to an API route that is made to throw and confirm the small 500 page appears with no error text.

## Performance Considerations

The middleware adds one `await` and a `try/catch` to every on-demand request and does nothing on the success path. Static assets never reach it (observed).

## Migration Notes

None for data or deploy. Pages that failed with a blank 500 now answer 503, so an uptime check or log query keyed on `500` for these two pages must also look at `503`; a saved Workers Logs query on Astro's stack line for these failures is replaced by the `page_workspace_read_failed` and `page_project_read_failed` events.

## References

- Research: `context/changes/page-error-boundary/research.md`
- Frame facts that this change inherits: `context/changes/turnstile-failure-visibility/frame.md` ("Facts for the separate boundary change")
- Audit: `context/audits/observability/2026-10-02_timer-delete-link-grid.md` (F3, F13), `2026-10-02_verify-fix-silent-error-logging.md`
- Pattern to repeat: `src/pages/w/[token]/grid.astro:74-86`; header convention: `src/pages/404.astro:5-8`; logger: `src/lib/log.ts`
- Astro documentation: custom 500 page (`Astro.props.error`, on-demand only) and middleware (`next()`, custom `Response`, rewrites, `routePattern` since 5.0.0)
- Probe harness: `.claude/worktrees/agent-a992330e2542a0e09/probe/boundary.mjs` and its output `probe/boundary-out/` (the research's baseline)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Guard the two page reads

#### Automated

- [x] 1.1 Changed pages lint clean: `npx eslint "src/pages/w/[token].astro" "src/pages/w/[token]/projects/[projectId]/delete.astro"` — 7b3d15a
- [x] 1.2 Astro check passes: `npx astro check` — 7b3d15a
- [x] 1.3 Whole suite stays green: `npx vitest run` — 7b3d15a
- [x] 1.4 Type checking passes: `npx tsc --noEmit` — 7b3d15a

### Phase 2: The boundary and the 500 page

#### Automated

- [x] 2.1 Boundary tests pass: `npx vitest run src/lib/error-boundary.test.ts` — ab1d1a9
- [x] 2.2 Whole suite stays green: `npx vitest run` — ab1d1a9
- [x] 2.3 Type checking passes: `npx tsc --noEmit` — ab1d1a9
- [x] 2.4 Lint is clean: `npm run lint` — ab1d1a9
- [x] 2.5 Astro check passes: `npx astro check` — ab1d1a9
- [x] 2.6 Deliberate break: a boundary that returns a `Response` instead of rethrowing turns the rethrow case red and one that labels the event with the URL path turns the token case red; both edits are reverted — ab1d1a9

#### Manual

- [x] 2.7 The text on the 500 page was read and approved — ab1d1a9

### Phase 3: Runtime proof through the probe harness

#### Automated

- [x] 3.1 The harness runs on both commits and writes `results.json` for each: `node probe/boundary.mjs before` and `node probe/boundary.mjs after` — cbcc75f
- [x] 3.2 After the change R9, R10 and D1 answer `503` with a non-empty HTML body and all three privacy headers, and the console shows a `page_workspace_read_failed` or `page_project_read_failed` line with a link id — cbcc75f
- [x] 3.3 After the change P10a and P1 answer `500`, `text/html`, a non-empty body and all three privacy headers, and the console shows an `unhandled_request_error` line whose route is a template — cbcc75f
- [x] 3.4 After the change P10b, A503, N404, ASSET and HEALTHY match the baseline in status, body length and the three headers — cbcc75f
- [x] 3.5 No `unhandled_request_error` or `page_*_read_failed` line contains the seeded token or the link id inside a URL — cbcc75f
- [x] 3.6 No process is left listening on the probe ports — cbcc75f

#### Manual

- [x] 3.7 The before/after table was read and the failing requests are visibly diagnosable, with unchanged requests unchanged — cbcc75f
- [x] 3.8 A `mode: verify` report with the table is written under `context/audits/observability/` and earlier reports are untouched — cbcc75f
