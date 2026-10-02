---
type: observability-audit
date: 2026-10-02 15:55
mode: verify
commit: ab1d1a9
branch: main
dirty_tree: true
areas: [timer, delete-account-and-project, link-create-and-regenerate]
area_source: arguments
runtime_proof: observed
error_tracker: none (Cloudflare Workers Logs via console only; wrangler.jsonc:12)
previous_report: context/audits/observability/2026-10-02_timer-delete-link-grid.md
findings: { critical: 0, high: 4, medium: 9, low: 5 }
---

# Observability audit, verify — page-error-boundary (2026-10-02)

Checks findings **F3** and **F13** of `2026-10-02_timer-delete-link-grid.md` against the code at `ab1d1a9` (`context/changes/page-error-boundary`, phases 1 and 2). `findings` above counts what is still open across the whole original report: the two medium findings F3 and F13 are closed. Nothing in the application was changed by this run.

## 1. TL;DR

- **The three failing reads now answer with the friendly view instead of a blank page.** R9 and R10 (the workspace page's timer and projects reads) and D1 (the project delete page's read) went from `500`, 0 bytes, no privacy headers, to `503`, an HTML body (3665, 3665 and 741 characters), all three privacy headers, and one `page_workspace_read_failed` / `page_project_read_failed` line carrying the route template and the link id.
- **An error nobody anticipated now gets a small 500 page and one route-labelled log line.** P10a (a page throw) and P1 (an API-route throw) went from a blank `500` to an HTML `500` (748 characters) with all three privacy headers and one `unhandled_request_error` line labelled `GET /zprobe/ssr` and `GET /api/zprobe/[id]`; Astro still logs its own stack line next to ours (1 + 1 for each).
- **Nothing that was not meant to change changed.** The healthy page, the 404 page, the static asset, the body-less API `503` and the post-stream throw (P10b) match the baseline in status, body length and the three headers.
- **No log line contains the token.** Five event lines in the run; 0 contain the token and the link id appears only in the `linkId` field.
- **Still open, by decision:** an error thrown after streaming starts (P10b) still answers `200` with an empty body, and `logAccess("success")` is still written before the reads.

## 2. Capture model

Unchanged from the original report except for two additions: the workspace and project-delete pages now catch a failed read (`src/pages/w/[token].astro:57-66`, `src/pages/w/[token]/projects/[projectId]/delete.astro:43-57`) and render the existing "Temporarily unavailable" view with status 503; and `src/middleware.ts` wires `src/lib/error-boundary.ts`, which logs `unhandled_request_error` from its `catch` (label `${method} ${routePattern}`, never the URL) and rethrows the same error, so Astro renders `src/pages/500.astro`, which sets `Referrer-Policy: strict-origin`, `Cache-Control: no-store` and `X-Robots-Tag: noindex` itself.

**Assumptions (unconfirmed, outside the repo):** Workers Logs parse JSON log lines into fields; behaviour on the real Cloudflare edge matches local workerd.

## 3. What reaches the logs and the visitor: before and after

Production build under `wrangler dev` (local workerd), local Supabase behind a fault-injecting proxy, the same ten requests before and after. "Before" is `383a92f`, "after" is `ab1d1a9`. R9, R10 and D1 are the real pages with the database reads failing; P10a, P10b and P1 are synthetic probe routes that exist only in the harness worktree.

| Request | What it is                              | Status (b → a) | Body (b → a) | 3 privacy headers (b → a) | Our log line after                                                                 |
| ------- | --------------------------------------- | -------------- | ------------ | ------------------------- | ---------------------------------------------------------------------------------- |
| R9      | workspace page, `getCurrentTimer` fails | 500 → **503**  | 0 → 3665     | no → **yes**              | `page_workspace_read_failed`, `GET /w/[token]`, `linkId`                           |
| R10     | workspace page, `listProjects` fails    | 500 → **503**  | 0 → 3665     | no → **yes**              | `page_workspace_read_failed`, `GET /w/[token]`, `linkId`                           |
| D1      | delete page, `getProject` fails         | 500 → **503**  | 0 → 741      | no → **yes**              | `page_project_read_failed`, `GET /w/[token]/projects/[projectId]/delete`, `linkId` |
| P10a    | page frontmatter throws                 | 500 → 500      | 0 → **748**  | no → **yes**              | `unhandled_request_error`, `GET /zprobe/ssr`                                       |
| P1      | API route throws                        | 500 → 500      | 0 → **748**  | no → **yes**              | `unhandled_request_error`, `GET /api/zprobe/[id]`                                  |
| P10b    | throw after streaming started           | 200 → 200      | 0 → 0        | no → no                   | none (Astro's `Uncaught Error` lines only)                                         |
| A503    | API route returns an explicit 503       | 503 → 503      | 0 → 0        | no → no                   | its existing `link_lookup_failed` line                                             |
| N404    | unknown well-formed token               | 404 → 404      | 693 → 693    | yes → yes                 | none                                                                               |
| ASSET   | `/favicon.png`                          | 200 → 200      | 690 → 690    | unchanged                 | none                                                                               |
| HEALTHY | healthy workspace page                  | 200 → 200      | 9655 → 9655  | yes → yes                 | none                                                                               |

Raw data: `probe/boundary-out/before/results.json` and `probe/boundary-out/after/results.json` in the harness worktree (token and link id redacted to `<TOKEN>` and `<LINK>`).

## 4. Systemic root causes

| Root cause (original report §4)                            | Status                                                                                                                                                                       |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3. Failures encoded as ordinary responses with no identity | **Further improved**: a failed page read now carries the link id and a route template, and the blank 500 is replaced by a 503 view or a 500 page with the privacy headers.   |
| 4. No shared boundary or logger                            | **Fixed for rendering errors**: a logger (earlier change), a 500 page and a middleware boundary now exist. Errors raised after streaming starts remain outside any boundary. |

## 5. Findings by area

| Finding                                         | Status                                                                                                                 | Evidence                                                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| F3 unguarded page reads → blank 500             | **fixed**                                                                                                              | R9, R10, D1 (observed): 503, HTML, 3 headers, structured log with `linkId`                                    |
| F13 no middleware and no `500.astro`            | **fixed**                                                                                                              | P10a, P1 (observed): HTML 500 with 3 headers and one route-labelled event; `error-boundary.test.ts` (9 cases) |
| F18 errors after streaming starts               | **still open, by decision**                                                                                            | P10b unchanged: 200, 0 bytes, `Uncaught Error` log only                                                       |
| `logAccess("success")` written before the reads | **unchanged, by decision**                                                                                             | `access_log` records the link access, which did succeed; `src/pages/w/[token].astro:49`                       |
| All other findings                              | unchanged, see `2026-10-02_verify-fix-silent-error-logging.md` and `2026-10-02_verify-turnstile-failure-visibility.md` |                                                                                                               |

## 6. Recommended fix order (what remains)

1. **`access_log` and lifecycle events** (F10, F9): log when the admin client is null, a distinct rotation outcome, a delete-account event, and one event per `closed` / `busy` / `full`.
2. **Purge worker** (F20–F22): validate the result, record the cutoff, detect a missed cron run.
3. **Errors after streaming starts** (F18): only a per-component boundary can cover them; the probe shows nothing else does.
4. **Optional:** deduplicate the five "Temporarily unavailable" copies once the views have tests; decide whether `logAccess` should record a failed read.

## 7. Changes since last audit

See §5; this report is a verify run against `2026-10-02_timer-delete-link-grid.md`, narrowed to F3 and F13.

## 8. Method and limits

- **Run:** `ASTRO_DEV_BACKGROUND=1 node probe/boundary.mjs before` with the worktree `.claude/worktrees/agent-a992330e2542a0e09` detached at `383a92f`, then `after` at `ab1d1a9` (a fresh `astro build` and `wrangler dev` each time). The comparison reads `results.json` of both runs; the leak checks read the console lines of our five event lines (`unhandled_request_error`, `page_workspace_read_failed`, `page_project_read_failed`) for `<TOKEN>`, `<UNKNOWN>` and `<LINK>`.
- **Check script correction:** the first comparison reported two failures that were mistakes in the checking script, not in the application (an assertion that required a `[` in the route of a probe route that has no dynamic segment, and an expected event count of 6 instead of 5); they were corrected and rerun with the same data and thresholds, and all assertions passed.
- **Not probed:** non-GET page throws; the `null` error case of the 500 page; the real Cloudflare edge; `astro dev`; a failure of both `Promise.all` reads at once (only the first error would be logged, from the language semantics); the real production routes for the unanticipated-error case (P10a and P1 are probe routes).
- **Cleanup:** after the runs no process was listening on ports 8820 and 54420. The worktree is left in place at `ab1d1a9` for further before and after runs.
