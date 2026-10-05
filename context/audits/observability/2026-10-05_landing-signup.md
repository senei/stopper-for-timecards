---
type: observability-audit
date: 2026-10-05 08:50
mode: audit
commit: 245a757
branch: main
dirty_tree: false
areas: [landing-signup-returning-visitor]
area_source: user
runtime_proof: blocked
error_tracker: none (Cloudflare Workers Logs via console only; wrangler.jsonc observability, head_sampling_rate 1)
previous_report: context/audits/observability/2026-10-02_timer-delete-link-grid.md
findings: { critical: 0, high: 3, medium: 6, low: 9 }
---

# Observability audit — landing, sign-up and returning visitor (2026-10-05)

## 1. TL;DR

- **A failed lookup reads as "no link".** When the database fails for a returning visitor, `resolveCookieLink` logs and returns `null` (`link-cookie.ts:37-44`). The landing page then offers "Create my private link", and `POST /api/links` falls through to creation. If the database recovers in between, the visitor gets a second link, the old workspace is orphaned and a cap slot (of 10) is burned. No log line says it happened.
- **Successes and committed writes leave no record.** A created link emits no event (`api/links.ts:50-56`). If the insert commits but the response, the cookie or the RPC result check fails, the slot is spent and the log carries no link id (`links.ts:23`, `api/links.ts:50-59`).
- **One catch, one event, no stage.** `link_create_failed` covers the throttle count, the RPC and the cookie, and the Turnstile, cookie and access-log lines name a module (`lib/turnstile`) instead of the request (`POST /api/links`).
- **Config is read as "off" instead of "wrong".** An unrecognised kill-switch value means open, a missing Turnstile site key renders a widget that never challenges (logged only as `turnstile_missing_token`, a warn), and a null throttle count means no throttle.
- **Two blind spots outside the flow.** Astro's origin check answers 403 before our boundary and nothing logs it. The purge worker still logs with raw `console.error`, no run id, no cause.
- **The 2026-10-02 fixes hold for this flow.** Turnstile verdicts, page catches, route logs with `linkId`, cause-preserving DB errors and the 500 boundary are all in place (section 7). What is left is flows that do not look like failures.

## 2. Capture model

How a failure travels from code to a human here:

- **Runtime:** Astro 7.3.2 SSR on Cloudflare Workers through `@astrojs/cloudflare` 14.3.1 (`astro.config.mjs`; `wrangler.jsonc:3`). A cron Worker, `workers/purge-job`.
- **Tracker:** none. No Sentry or OTel in `package.json` or `src`.
- **Pipeline:** Workers Logs collect console output and invocation outcomes (`wrangler.jsonc` observability, `head_sampling_rate: 1`).
- **Boundaries of our own:** `src/middleware.ts:3` runs `src/lib/error-boundary.ts:19-21`, which logs `unhandled_request_error` (`route: "<METHOD> <routePattern>"`, serialized error with `cause`) and rethrows. `src/pages/500.astro` renders the error page. Astro's own stack line is also logged; it does not include `cause`, so our JSON line is the useful one. Errors after streaming starts are out of reach by decision.
- **Logger:** `src/lib/log.ts` (`logError`, `logWarn`: one JSON line with level, event, route, `linkId`, `projectId`, `op`, `detail`, serialized error with `cause` to depth 3). `src/lib/db-error.ts` keeps the PostgREST error as `cause`. ESLint rejects a bare `catch` and any `console` outside `log.ts`.
- **Turnstile:** `src/lib/turnstile.ts` returns a verdict and logs every refusal; `src/pages/api/links.ts:41-43` refuses with 303 to `/?error=verify`.
- **Durable records:** `access_log` (`src/lib/access-log.ts`, never throws) and `job_runs`.
- **Identity:** no release or environment field in any line.
- **Client side:** three `<script>` blocks (`WorkspaceCard.astro:264`, `delete-account.astro:89`, the Turnstile script in `index.astro:65`), no global error handler and no beacon.

**Assumptions (outside the repo, not findings), all unconfirmed:**

- Workers Logs are enabled in the dashboard and retained long enough to search by event and route. The purge worker's own comment (`workers/purge-job/src/index.ts:14`) says free-tier logs are not persisted, which conflicts with this.
- The platform adds worker name, version id, request URL and `cf-ray` to each invocation, so release and environment may be visible there.
- The platform records status and outcome for 403, 503 and exceptions.
- No alert rules or log forwarding exist for `level: "error"` events.

## 3. What reaches the logs

Static-only version: the runtime probes were **not run** (the local Supabase stack needs Docker, which is not running). Every row is **inferred** from code.

| Failure shape                                                          | Response                                | Logs                                                                    | Verdict |
| ---------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------- | ------- |
| Cookie link lookup throws on `GET /`                                   | 200, "Create my private link" form      | `cookie_link_lookup_failed`, route `lib/link-cookie`, no caller, no id  | poor    |
| Cookie link lookup throws on `POST /api/links`, then database recovers | 303 to a new workspace, cookie replaced | the same single line; creation leaves nothing                           | missed  |
| Successful sign-up                                                     | 303 to `/w/<token>`                     | nothing                                                                 | missed  |
| `create_link` commits, result not a string                             | 303 `/?error=1`                         | `link_create_failed`, route only, error without shape or id             | poor    |
| `setLinkCookie` throws after commit                                    | 303 `/?error=1`                         | `link_create_failed`, route only; link id known but not logged          | poor    |
| Supabase env missing                                                   | 303 `/?error=1`                         | `link_create_failed` with "Supabase is not configured" cause, no stage  | poor    |
| `count` returns null                                                   | continues as if zero recent links       | nothing                                                                 | missed  |
| `LINK_CREATION_CLOSED=yes`                                             | sign-up stays open                      | nothing                                                                 | missed  |
| `TURNSTILE_SITE_KEY` unset or script blocked                           | 303 `/?error=verify`                    | `turnstile_missing_token` (warn), looks like a bot                      | poor    |
| Cross-origin POST (Astro origin check)                                 | 403 text body                           | nothing from the app                                                    | missed  |
| Page or route throws unexpectedly                                      | 500 page                                | `unhandled_request_error` with route and cause, plus Astro's stack line | good    |
| Turnstile rejection with an operator code                              | 303 `/?error=verify`                    | `turnstile_rejected` (error), route `lib/turnstile`                     | good    |
| `closed`, `busy`, `full` outcomes                                      | 303 with banner                         | nothing (open F9)                                                       | missed  |

## 4. Systemic root causes

1. **A failed lookup is treated as absence.** `resolveCookieLink` returns `null` when `findLinkByToken` throws (`link-cookie.ts:37-44`), and its doc comment makes this deliberate ("so the caller can carry on"). Both callers (`index.astro:12-15`, `api/links.ts:20-23`) cannot tell "no link" from "could not check". The same shape appears in `countRecentLinks` (`links.ts:110`, `count ?? 0`). Explains S1, S7, S9.
2. **Successes and committed writes are not recorded.** Nothing logs a created link or a recognised visitor, and the post-commit steps share a `try` with the pre-commit ones (`api/links.ts:45-60`; `regenerate.ts:34-52` has the same shape). A write can commit with no trace of which link it was. Explains S2, S3, P4.
3. **Log context names the module and the flow's start, not the stage.** `LogContext` has `route`, `linkId`, `op`, `detail` but no stage or request id; helpers use pseudo-routes (`lib/turnstile`, `lib/link-cookie`, `lib/access-log`) and one `try` spans three stages. Explains S4, S8, P3, P6.
4. **Config is read as "off" instead of "wrong".** `creation-closed.ts:6-9` accepts only `1` and `true`; secrets and the site key are `optional: true` (`astro.config.mjs:22`) with no signal when missing. Explains S5, S6 and F15 (open).
5. **Capture sits inside the framework pipeline, and the worker sits outside our conventions.** Astro's origin check is unshifted before our middleware (`node_modules/astro/dist/core/middleware/load.js:13`), so decisions like a 403 are never seen; the purge worker uses raw `console.error` with no run id or cause (`workers/purge-job/src/index.ts:26-56`). Explains P1, P2.

## 5. Findings by area

### Landing, sign-up and returning visitor

| #   | Location                                                                           | Category                            | Severity | What happens in production                                                                                                                                                                                                                                                           | Fix direction                                                                                    |
| --- | ---------------------------------------------------------------------------------- | ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| S1  | `link-cookie.ts:37-44`; `api/links.ts:20-23`; `index.astro:12-15`                  | flattened-response, missing-throw   | high     | Database failure → returning visitor sees "Create my private link"; if they submit and the database is back, they get a second link, a new cookie and a burned cap slot. One `cookie_link_lookup_failed` line with route `lib/link-cookie`, no caller, no id (static)                | Return an "unknown" state; render an error or refuse creation; log the caller's route            |
| S2  | `api/links.ts:50-56`; `index.astro:14`                                             | coverage-gap                        | high     | A created link and a recognised visitor leave no event. A drop in sign-ups (a broken widget) looks like "no traffic"; cap use is only countable in the database (static)                                                                                                             | `link_created` with `linkId`; a sampled `link_recognised` (extends F9)                           |
| S3  | `links.ts:18-24`; `api/links.ts:50-59`                                             | swallowed, missing-context          | high     | `create_link` commits inside the RPC. A non-string result (`links.ts:23`) or a failed `setLinkCookie` then shows `/?error=1`, the token is lost, the slot is burned. The log has the route only; the id was known (static)                                                           | Log the returned type, the id and a stage; wrap the post-create steps separately                 |
| S4  | `api/links.ts:45-60`; `supabase-admin.ts:19`                                       | flattened-response, missing-context | medium   | One `try` covers `countRecentLinks`, `createLink` and `setLinkCookie`; "Supabase is not configured", a PostgREST failure and a cookie failure all log `link_create_failed` and show "Something went wrong". The stage is only in the nested cause (static)                           | `op` per stage; its own event for missing configuration                                          |
| S5  | `creation-closed.ts:6-9`; `api/links.ts:25`; `index.astro:18`                      | config, swallowed                   | medium   | `LINK_CREATION_CLOSED=yes`, `on` or `closed` is read as open; the owner believes registration is closed, and only the cap and the throttle remain. Nothing says the value was not recognised (static)                                                                                | Warn on a set but unrecognised value, or accept more truthy values                               |
| S6  | `index.astro:56,65`; `astro.config.mjs:22`                                         | config, noise                       | medium   | `TURNSTILE_SITE_KEY` unset (or the script blocked) → widget never challenges, every visitor posts an empty token and sees "Verification failed; please try again", which no retry can fix. The only trace is `turnstile_missing_token`, a warn indistinguishable from a bot (static) | Log an error when rendering the form with no site key; widget callbacks stay a separate decision |
| S7  | `links.ts:110`                                                                     | missing-throw                       | medium   | `count ?? 0` turns an unexpected null into "no recent links", which disables the 3-per-10-minutes throttle with no log; the neighbouring lookups throw on unexpected shapes (static)                                                                                                 | Throw when `count === null`                                                                      |
| S8  | `turnstile.ts:5`; `link-cookie.ts:41-43`; `access-log.ts`                          | missing-context                     | low      | Lines use pseudo-routes (`lib/turnstile`, `lib/link-cookie`, `lib/access-log`); a filter on `route = "POST /api/links"` misses Turnstile refusals and a cookie lookup failure cannot say whether `GET /` or the POST triggered it (static)                                           | Pass the caller's route into the helper, or log one outcome event from the route                 |
| S9  | `link-cookie.ts:36-48`                                                             | swallowed, noise                    | low      | A malformed cookie and a cookie for a deleted or regenerated link are cleared silently; mass clearing from a wrongly-null lookup would be invisible too (static)                                                                                                                     | Sampled `cookie_stale` with reason `malformed` or `not_found`                                    |
| S10 | `index.astro:12`; `link-cookie.ts:32-34`                                           | coverage-gap                        | low      | With no cookie, `GET /` never touches Supabase: the landing page renders fine while the database or its secrets are broken, and the first signal is `link_create_failed` after the visitor solved Turnstile. Same root as F15 (static)                                               | Log missing secrets once per instance on render                                                  |
| S11 | `api/links.ts:33-36`; `timer/start.ts`, `delete-account.ts`, `regenerate.ts` sites | noise, missing-context              | low      | `form_parse_failed` warns for every junk POST and `detail` is the raw `Content-Type`: unbounded, client-controlled, and a multipart boundary makes every line unique; a second warn (`turnstile_missing_token`) follows (static)                                                     | Log only the media type, without parameters; merge with a single refusal event                   |

### Platform / plumbing

| #   | Location                                                                                           | Category                             | Severity | What happens in production                                                                                                                                                                                                                                                                    | Fix direction                                                                          |
| --- | -------------------------------------------------------------------------------------------------- | ------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| P1  | `node_modules/astro/dist/core/middleware/load.js:13`; `core/app/origin-check.js`                   | coverage-gap                         | medium   | Astro's origin check answers `403 "Cross-site POST form submissions are forbidden"` before our middleware; if a header change makes legitimate form posts fail (the lessons file has exactly this case), the app logs nothing, only the platform status shows it (static)                     | Out of reach of the boundary; log 403s at a layer that sees them, or test in a browser |
| P2  | `workers/purge-job/src/index.ts:26-56`                                                             | missing-context, logged-not-captured | medium   | Raw `console.error` (3 sites, `eslint-disable` without reason), no run id, job name or cutoff; thrown errors carry no `cause`; `job_runs.error_message` stores only `.message`, dropping `code`, `details`, `hint` (static; extends F20–F22)                                                  | Small JSON logger with `runId`; throw with `{ cause }`; store code and details         |
| P3  | `error-boundary.ts:19-21`                                                                          | identity-lost                        | low      | `unhandled_request_error` has `route` only: no `linkId`, no request id, so users hitting one bug cannot be told apart (static)                                                                                                                                                                | Put `linkId` in `locals` after the lookup; optional `cf-ray`                           |
| P4  | `regenerate.ts:34-52`                                                                              | flattened-response                   | low      | `rewrite("/404")` and the success-path calls sit inside the `try` that covers `regenerateLink`. After the swap committed, a failing `setLinkCookie` redirects to the old `/w/<token>`, now dead, and logs `link_regenerate_failed` plus an "error" access row; the new token is lost (static) | Narrow the `try`; log the new link id on a post-commit failure                         |
| P5  | `links.ts:23,50,69,94`; `projects.ts:32,46,77`; `timer.ts:32,55,146`; `weekly-grid-query.ts:32,61` | missing-context                      | low      | About 17 "returned an unexpected value/row" throws with no `typeof` or key names: a schema drift in an RPC would be a puzzle (static)                                                                                                                                                         | Add `typeof` and key names (never values) to the message                               |
| P6  | `log.ts:59-73,80-83`                                                                               | identity-lost                        | low      | The object branch does not follow `cause`; `AggregateError.errors` is dropped; `details` (where supabase-js puts a fetch failure's stack) is cut at 500 characters; a serialization failure drops `linkId` and the whole error, leaving "log serialization failed" (static)                   | Follow `cause` on objects; keep the tail of `details`; keep context in the fallback    |
| P7  | Astro `core/errors/default-handler.js` (framework `catch {}` around the 500 render)                | coverage-gap                         | low      | If `500.astro` itself throws, our boundary logs `GET /500` once, Astro swallows it and retries without middleware; a second failure ends in a bare 500 with no line (static)                                                                                                                  | Keep `500.astro` free of anything that can throw (it currently is)                     |

## 6. Recommended fix order

1. **Stop reading a failed lookup as "no link" (S1, S7, S9).** Make `resolveCookieLink` return a third state, refuse creation on `unknown`, render a 503 state on `GET /`, and throw on a null count. Constraint: a visitor with a valid cookie must still reach their workspace when the database is healthy. Closes the only finding that creates wrong state (duplicate link).
2. **Record the sign-up lifecycle (S2, S3, S4, S8).** One `link_created` event (`linkId` only, never the token), split the `try` into stages with `op`, and log the id when a post-commit step fails. Extends the open F9 (`closed`, `busy`, `full`) into one set of outcome events. Constraint: log `link.id`, never the token.
3. **Config as wrong, not off (S5, S6, S10, F15).** Warn on an unrecognised kill-switch value, log an error when the form renders without a site key, log missing Supabase secrets once. Cheap and removes three silent degradations.
4. **Purge worker onto the same conventions (P2, F20–F22).** Same logger shape, run id, cutoff, `cause`.
5. **Context polish (P3, P4, P5, P6, S11).** `linkId` and request id in the boundary, narrow the regenerate `try`, shape in "unexpected value" messages, serializer fallbacks, bounded `detail`.
6. **Decide, don't fix (P1, P7).** The origin-check 403 and the framework's swallowed 500-page failure sit outside the boundary; keep the lessons-file rule (`strict-origin`, test forms in a real browser) and accept the gap, or add a check at a layer that sees it.

## 7. Changes since last audit

Re-checked against `2026-10-02_timer-delete-link-grid.md`, for the findings that touch this flow or the shared plumbing:

| Previous id                          | Status                  | Evidence                                                                                                                                                             |
| ------------------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F2 Turnstile collapses to `false`    | fixed (operator side)   | `turnstile.ts` returns a verdict and logs every refusal; read today. Widget callbacks still open by decision (see S6)                                                |
| F8 cookie lookup swallowed           | partly fixed            | logged as `cookie_link_lookup_failed`, but the lookup failure is still read as "no link" (S1)                                                                        |
| F9 `closed` / `busy` / `full` silent | still open              | `api/links.ts:25-26,46-52` redirect with no log, read today                                                                                                          |
| F10 `access_log` fail-open           | still open (not re-run) | `access-log.ts:27-28` returns silently on a null client per the plumbing audit; not probed                                                                           |
| F13 / F3 no boundary, page reads     | fixed                   | `middleware.ts`, `500.astro`, `error-boundary.test.ts`; verified in earlier verify reports                                                                           |
| F15 optional secrets                 | still open              | `astro.config.mjs:22-23`; Turnstile secret has `turnstile_secret_missing`, site key and Supabase secrets do not (S6, S10)                                            |
| F16 no release/env                   | still open              | no field in `log.ts`                                                                                                                                                 |
| F17 token in request URLs            | not re-checked          | Astro's request log is a no-op in production (`core/environment/production.js`), so Astro does not log `/w/<token>`; the platform's own URL logging is an assumption |
| F18 errors after streaming starts    | still open, by decision | unchanged                                                                                                                                                            |
| F20–F22 purge worker                 | still open              | `workers/purge-job/src/index.ts` read today: `purge.data ?? 0`, `createClient` outside `try`, raw `console.error` (see P2)                                           |
| F23, F26                             | not re-checked          | outside this flow                                                                                                                                                    |
| F27 query-string banners             | still open              | `index.astro:21-26`; an unknown `?error=` value shows no banner at all                                                                                               |

## 8. Method and limits

- **Agents:** one area auditor (landing, sign-up, returning visitor) and one cross-cutting auditor (boundary, logger, client scripts, purge worker, repo-wide sweep), both read-only, run in parallel. The area auditor did not read `log.ts`; the plumbing auditor covered it.
- **Spot-checked by hand:** S1 (`link-cookie.ts`, `api/links.ts`), S5 (`creation-closed.ts`), S7 (`links.ts:110`), S3 (`links.ts:18-24`, `api/links.ts:45-60`), S6 (`index.astro:56`), P1 (`middleware/load.js:13`, `origin-check.js`), P2 (`purge-job/src/index.ts`), P4 (`regenerate.ts:28-58`). All confirmed. Severity adjusted: the area auditor rated S1 critical; it is high here because a log line exists and the harm needs an outage window with a recovery in between. The area auditor rated S4 high; it is medium because the stage is recoverable from the nested cause.
- **Runtime proof: blocked.** The local Supabase stack needs Docker Desktop, which was not running. No probe, fake-ingest endpoint or worktree was created for this run. The existing harness from the 2026-10-02 audits remains in `.claude/worktrees/agent-a992330e2542a0e09/probe/`; a before/after run for S1, S3 and S7 would need a database that can be made to fail on demand.
- **Repo-wide sweep (production code, `src` and `workers`):** 0 empty catches; 2 catches without a binding (`WorkspaceCard.astro:274` with a reason, `log.ts:81` the logger's own fallback); 0 `.catch(() =>` to a default; 3 raw `console.*` calls, all in the purge worker; 4 `eslint-disable` of `no-console` / `no-restricted-syntax` (1 client with a reason, 3 purge without); about 17 `new Error(` without `cause` in `src` and 3 in the purge worker. Dev scripts (`scripts/smoke-local.mjs`, 4 bare catches) are exempt.
- **Not verifiable from the repo:** how production Workers Logs render `Error` arguments and URLs, log retention, alert rules, and whether the platform adds a release or environment field.
- **Nothing in the application was changed by this run.**
