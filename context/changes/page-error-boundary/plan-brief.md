# Guard page reads and add a 500 page and error boundary — Plan Brief

> Full plan: `context/changes/page-error-boundary/plan.md`
> Research: `context/changes/page-error-boundary/research.md`

## What & Why

Two pages read from the database after a good link lookup without a `try`. When that read fails the visitor gets an empty HTTP 500 with none of the privacy headers, and the only trace is Astro's own stack line. This change makes those two reads fail like the other pages (a logged event, the existing "Temporarily unavailable" view, status 503) and adds a 500 page and a small middleware for failures nobody anticipated. It implements F3 and F13 of the observability audit; the team has also seen the blank 500 on production or preview.

## Starting Point

`src/pages/w/[token].astro:57` and `src/pages/w/[token]/projects/[projectId]/delete.astro:43` are the two unguarded awaits; `grid.astro` already shows the guard pattern and the "unavailable" views exist. There is no `src/middleware.ts` and no `500.astro`. The research ran a production build under `wrangler dev` and measured what a 500 page and a middleware can and cannot do.

## Desired End State

A failed read on those two pages shows the friendly "Temporarily unavailable" view with status 503, the privacy headers and a structured log line with the link id. An unanticipated error in a page or API route shows a small 500 page with the privacy headers and no error text, and leaves one structured log line labelled with the route template (never the token). Everything else is byte-identical, and a before/after probe run shows it.

## Key Decisions Made

| Decision                 | Choice                                                                                        | Why (1 sentence)                                                                                                                      | Source                          |
| ------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Where to guard the reads | In the page, plus the boundary as a safety net                                                | An expected outage keeps the friendly 503 view and a log with the link id, as `grid.astro` already does.                              | Plan (user approved)            |
| Boundary shape           | `500.astro` + middleware that logs and rethrows                                               | Rethrowing keeps Astro's own log and gives the 500 page its `error`; swallowing removed Astro's log (observed).                       | Research / Plan                 |
| Route label in the log   | `ctx.routePattern`, never the pathname                                                        | The pathname carries the token (observed); the pattern is `/w/[token]`.                                                               | Research                        |
| 500 page content         | Own text, three privacy headers set by the page, no error text, no link                       | Headers are lost on the blank 500 and reach the client when the page sets them (observed); the docs advise against showing the error. | Research                        |
| Unavailable markup       | No deduplication of the five copies                                                           | No test covers those views, so extraction risks untested visual regressions.                                                          | Plan (user approved)            |
| API routes               | Same HTML 500 page, no content negotiation                                                    | All nine callers are HTML forms; no fetch or JSON anywhere in `src`.                                                                  | Research / Plan                 |
| `logAccess` order        | Unchanged                                                                                     | `access_log` records the link access, which did succeed.                                                                              | Plan                            |
| Testing                  | Unit-test the boundary as a plain function; prove pages and the 500 page in the probe harness | `astro:middleware` and `.astro` files cannot be imported by the default vitest run.                                                   | Research / Plan (user approved) |

## Scope

**In scope:** guards in two pages, `src/lib/error-boundary.ts` and its test, `src/middleware.ts`, `src/pages/500.astro`, a before/after probe run and a verify report.

**Out of scope:** errors after streaming starts, the `logAccess` order, a shared unavailable component, content negotiation for API callers, the body-less API 503s, an Astro Container test, `astro dev` and the real Cloudflare edge.

## Architecture / Approach

The boundary is a plain function `(context, next)` that returns the response untouched and, only on a throw, logs `unhandled_request_error` with `GET /w/[token]`-style route and rethrows the same error; `src/middleware.ts` wires it with `defineMiddleware`. The 500 page is rendered by Astro after the rethrow. The two page guards copy the `grid.astro` pattern.

## Phases at a Glance

| Phase                                      | What it delivers                                                                          | Key risk                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1. Guard the two page reads                | `try/catch` + log + 503 view in two pages                                                 | A failed read must not reach the 404 rewrite on the delete page     |
| 2. The boundary and the 500 page           | Boundary function and tests, middleware wrapper, `500.astro`, full lint and `astro check` | The boundary must rethrow and never log the token                   |
| 3. Runtime proof through the probe harness | Before/after run of the real build, plus a verify report                                  | Needs local Supabase, the probe worktree and a baseline taken first |

**Prerequisites:** local Supabase running and the probe worktree `.claude/worktrees/agent-a992330e2542a0e09` (with its untracked probe files) for phase 3.
**Estimated effort:** about 2–3 sessions across 3 phases; phases 1 and 2 are small and touch different files.

## Open Risks & Assumptions

- When both reads in `Promise.all` fail only the first error is logged (language semantics, not probed).
- The research ran on local workerd, not the real Cloudflare edge; edge-level error pages were not tested.
- The text of the 500 page is a user-facing copy decision confirmed by a human in phase 2.
- A middleware global to every on-demand request is a wide blast radius; it does nothing on the success path (observed identical responses for the healthy page, 404 and assets).
- Errors thrown after streaming starts stay invisible to the visitor and are only an `Uncaught Error` log line.

## Success Criteria (Summary)

- The two failing reads answer 503 with the friendly view, the privacy headers and a log line with the link id.
- An unanticipated error answers 500 with the small page, the privacy headers and one token-free route-labelled log line.
- Healthy pages, the 404 page, assets and the existing 503 views are unchanged.
