---
type: observability-audit
date: 2026-10-05 11:13
mode: verify
commit: 081e063
branch: main
dirty_tree: false
areas: [landing-signup-returning-visitor]
area_source: user
runtime_proof: not-run
error_tracker: none (Cloudflare Workers Logs via console only; wrangler.jsonc observability, head_sampling_rate 1)
previous_report: context/audits/observability/2026-10-05_landing-signup.md
findings: { critical: 0, high: 0, medium: 4, low: 9 }
---

# Observability audit, verify — landing, sign-up and returning visitor (2026-10-05)

## 1. TL;DR

- **Both high-risk mechanisms are closed.** A failed cookie lookup is now a third state, `unknown`, and neither the landing page nor `POST /api/links` offers or creates a second link on it. A created link and every post-commit failure now carry the link id.
- **6 of 18 findings fixed (S1, S2, S3, S4, S7, S9), 1 partly fixed (S8), 1 partly fixed in a minor way (P5), 10 still open.** None of the open ones is high; 4 are medium (S5, S6, P1, P2).
- **F8 and F9 from the 2026-10-02 audit are now fixed** (lookup failure no longer read as absence; `closed`, `busy` and `full` each log an event).
- **What remains is config read as "off" (S5, S6, S10), pseudo-routes in two helpers (S8), the purge worker (P2) and Astro's origin check (P1).**
- One new low observation (N1).
- Every row is **static**. No runtime probe was run.

## 2. Capture model

Unchanged from the previous report, except the logger now has `logInfo` (`src/lib/log.ts:96-99`) and the sign-up route and landing page use it. Runtime: Astro SSR on Cloudflare Workers plus the cron worker `workers/purge-job`. No tracker. Workers Logs collect console output. Our boundary is `src/lib/error-boundary.ts:13-23` (route pattern, serialized error with `cause`, rethrow).

**Assumptions (outside the repo, not findings), all unconfirmed:** Workers Logs enabled and retained (the purge worker comment at `workers/purge-job/src/index.ts:14` says free-tier logs are not persisted); the platform adds worker name, version and `cf-ray`; the platform records 403, 503 and exceptions; no alert rules or log forwarding on `level: "error"`. A new one: `info` lines (`link_created`, `link_creation_closed`) are kept by Workers Logs, as the log level is not filtered in the repo.

## 3. What reaches the logs

Static only: the runtime probes were **not run**, and the proof harness from 2026-10-02 was not reused. Every row is inferred from code.

| Failure shape                                  | Response                                       | Logs                                                                                                   | Verdict (before) |
| ---------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------- |
| Cookie link lookup throws on `GET /`           | 503, "Temporarily unavailable" with retry link | `cookie_link_lookup_failed`, route `GET /` (`link-cookie.ts:50`, `index.astro:13,19-22`)               | good (poor)      |
| Cookie link lookup throws on `POST /api/links` | 303 `/?error=1`, no creation                   | `cookie_link_lookup_failed`, route `POST /api/links` (`api/links.ts:21,26-28`)                         | good (missed)    |
| Successful sign-up                             | 303 to `/w/<token>`                            | `link_created` (info) with `linkId`, no token (`api/links.ts:74`)                                      | good (missed)    |
| `create_link` commits, result not a string     | 303 `/?error=1`                                | `link_create_failed`, `op: create_link`, message has `typeof` (`links.ts:22-24`, `api/links.ts:79-87`) | good (poor)      |
| `setLinkCookie` throws after commit            | 303 `/?error=1`                                | `link_create_failed`, `op: set_cookie`, `linkId` set (`api/links.ts:73,76-77,81`)                      | good (poor)      |
| Supabase env missing                           | 303 `/?error=1`                                | `supabase_not_configured`, `op` is the stage (`api/links.ts:82-86`)                                    | good (poor)      |
| `count` returns null                           | 303 `/?error=1`                                | `link_create_failed`, `op: count_recent` (`links.ts:110-112`)                                          | good (missed)    |
| `LINK_CREATION_CLOSED=yes`                     | sign-up stays open                             | nothing (S5, unchanged: `creation-closed.ts:6-9`)                                                      | missed           |
| `LINK_CREATION_CLOSED=1` and a POST            | 303 `/?closed=1`                               | `link_creation_closed` (info) (`api/links.ts:30-33`)                                                   | good (missed)    |
| `busy` / `full`                                | 303 with banner                                | `link_creation_busy` (warn, count in `detail`), `link_creation_full` (warn)                            | good (missed)    |
| Stale or malformed cookie                      | cookie cleared, landing renders                | `cookie_stale` (warn), `detail` `malformed` or `not_found` (`link-cookie.ts:56`)                       | good (poor)      |
| `TURNSTILE_SITE_KEY` unset or script blocked   | 303 `/?error=verify`                           | `turnstile_missing_token` (warn), route `lib/turnstile` (unchanged)                                    | poor             |
| Cross-origin POST (Astro origin check)         | 403 text body                                  | nothing from the app (unchanged)                                                                       | missed           |
| Page or route throws unexpectedly              | 500 page                                       | `unhandled_request_error` with route and cause                                                         | good             |
| Turnstile rejection with an operator code      | 303 `/?error=verify`                           | `turnstile_rejected` (error), route `lib/turnstile`                                                    | good             |

## 4. Systemic root causes

Previous root causes, re-checked:

1. **A failed lookup is treated as absence: fixed.** `resolveCookieLink` returns `{ status: "unknown" }` on a throw (`link-cookie.ts:30,49-52`) and both callers branch on it. The same shape in `countRecentLinks` is gone (`links.ts:110-112` throws).
2. **Successes and committed writes are not recorded: fixed for sign-up, open for regenerate.** `link_created` is logged right after the insert and the `try` tracks `stage` and `createdLinkId` (`api/links.ts:52-87`). `regenerate.ts:16-34` still has one `try` around swap, access log and cookie (P4).
3. **Log context names the module, not the stage: partly fixed.** The sign-up route and the cookie helper take the caller's route and an `op`. `lib/turnstile` (`turnstile.ts:5`) and `lib/access-log` (`access-log.ts:17`) are still pseudo-routes; the boundary still has no `linkId` (P3).
4. **Config is read as "off" instead of "wrong": open.** `creation-closed.ts:6-9` still accepts only `1` and `true`; `astro.config.mjs:19-24` still marks every secret and the site key `optional: true`; `index.astro:73` still renders the widget with no site key.
5. **Capture sits inside the framework pipeline, and the worker sits outside our conventions: open.** `workers/purge-job/src/index.ts:27,50,55` still uses raw `console.error` with an `eslint-disable` and no run id; Astro's origin check was not re-read in `node_modules` this run (assumed unchanged, nothing in `src` changed for it).

## 5. Findings still open

### Landing, sign-up and returning visitor

| #   | Location                                                      | Category               | Severity | What happens in production                                                                                                                                                                                       | Fix direction                                                                  |
| --- | ------------------------------------------------------------- | ---------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| S5  | `creation-closed.ts:6-9`; `api/links.ts:30`; `index.astro:25` | config, swallowed      | medium   | `LINK_CREATION_CLOSED=yes`, `on` or `closed` is read as open and nothing says the value was not recognised (static)                                                                                              | Warn on a set but unrecognised value, or accept more truthy values             |
| S6  | `index.astro:73`; `astro.config.mjs:22`                       | config, noise          | medium   | No site key: widget never challenges, every visitor sees "Verification failed", the only trace is a warn `turnstile_missing_token` that looks like a bot (static)                                                | Log an error when rendering the form with no site key                          |
| S8  | `turnstile.ts:5`; `access-log.ts:17`                          | missing-context        | low      | Partly fixed: the cookie lines now carry the caller's route. Turnstile refusals still say `lib/turnstile`, access-log failures `lib/access-log`, so a filter on `route = "POST /api/links"` misses them (static) | Pass the route into `verifyTurnstile`, or log one outcome event from the route |
| S10 | `index.astro:13`; `link-cookie.ts:38-40`                      | coverage-gap           | low      | With no cookie, `GET /` never touches Supabase; a broken database or missing secrets show first as `link_create_failed` or `supabase_not_configured` after the visitor solved Turnstile (static)                 | Log missing secrets once per instance on render                                |
| S11 | `api/links.ts:41`                                             | noise, missing-context | low      | `form_parse_failed` still logs the raw `Content-Type` as `detail`, unbounded and client-controlled, plus a second warn from Turnstile (static)                                                                   | Log only the media type; merge into one refusal event                          |

### Platform / plumbing

| #   | Location                                                               | Category                             | Severity | What happens in production                                                                                                                                                               | Fix direction                                                                  |
| --- | ---------------------------------------------------------------------- | ------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| P1  | Astro `core/middleware/load.js`; `core/app/origin-check.js`            | coverage-gap                         | medium   | Origin-check 403 happens before our middleware and is not logged (static, not re-read in `node_modules`, no source change since)                                                         | Accept, or log 403s at a layer that sees them; test in a browser               |
| P2  | `workers/purge-job/src/index.ts:25-57`                                 | missing-context, logged-not-captured | medium   | Unchanged: raw `console.error` (3 sites), no run id or cutoff, `purge.data ?? 0` (line 40), `error_message` stores only `.message` (static)                                              | Small JSON logger with `runId`; throw with `{ cause }`; store code and details |
| P3  | `error-boundary.ts:20`                                                 | identity-lost                        | low      | `unhandled_request_error` has `route` only, no `linkId` (static)                                                                                                                         | Put `linkId` in `locals`                                                       |
| P4  | `regenerate.ts:16-34`                                                  | flattened-response                   | low      | One `try` around swap, `logAccess`, `rewrite("/404")` and `setLinkCookie`; after a committed swap a cookie failure redirects to the dead old token and the new id is not logged (static) | Narrow the `try`; log the new id on a post-commit failure                      |
| P5  | `links.ts:50,69,94`; `projects.ts`; `timer.ts`; `weekly-grid-query.ts` | missing-context                      | low      | Partly fixed: `create_link` and the count now say what they got (`links.ts:23`, 111), but about 15 other "unexpected value/row" throws still carry no `typeof` or key names (static)     | Add `typeof` and key names (never values)                                      |
| P6  | `log.ts:59-73,81-83`                                                   | identity-lost                        | low      | Object branch does not follow `cause`; `AggregateError.errors` dropped; `details` cut at 500 characters; fallback drops `linkId` and the error (static)                                  | Follow `cause` on objects; keep context in the fallback                        |
| P7  | Astro `core/errors/default-handler.js`                                 | coverage-gap                         | low      | A throwing `500.astro` would be swallowed by the framework (static, not re-read; `500.astro` not changed)                                                                                | Keep `500.astro` free of anything that can throw                               |

### New

| #   | Location                                  | Category               | Severity | What happens in production                                                                                                                                                                                                                                                                                                                                                          | Fix direction                                                                                         |
| --- | ----------------------------------------- | ---------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| N1  | `api/links.ts:21-33`, `index.astro:19-22` | noise, missing-context | low      | Introduced by the fixes: `link_creation_closed` is logged at info for every POST while closed, before the Turnstile check, so any bot posting to `/api/links` can write an unbounded stream of lines; and the `unknown` branch of the POST redirects to the generic "Something went wrong creating your link" banner, so the visitor cannot tell it from a failed creation (static) | Sample or drop the closed line (the banner already shows it); optional distinct message for `unknown` |

Severity count of what is open: 0 critical, 0 high, 4 medium (S5, S6, P1, P2), 9 low (S8, S10, S11, P3, P4, P5, P6, P7, N1).

## 6. Recommended fix order

1. **Config as wrong, not off (S5, S6, S10, F15).** Warn on an unrecognised kill-switch value, log an error when the form renders without a site key, log missing Supabase secrets once per instance. Cheap, and it removes the last three silent degradations on the sign-up path.
2. **Purge worker onto the same conventions (P2, F20 to F22).** Same logger shape, run id, cutoff, `cause`, and store `code` and `details` in `job_runs`.
3. **Make Turnstile lines findable by request (S8, S11).** Pass the route into `verifyTurnstile`, bound the `Content-Type` detail. Constraint: no token, secret or IP in a line.
4. **Context polish (P3, P4, P5, P6, N1).** `linkId` in the boundary, narrow the regenerate `try` (the same stage pattern now used in `api/links.ts`), shape in "unexpected value" messages, serializer fallbacks.
5. **Decide, don't fix (P1, P7, F18).** Keep the lessons-file rule and accept the gap, or add a check at a layer that sees it.

## 7. Changes since last audit

Compared with `2026-10-05_landing-signup.md` (HEAD was 245a757, now 081e063). All rows are static.

| Previous id                                  | Status (before to now)                     | Evidence                                                                                                                                                                                                                      |
| -------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 failed lookup read as "no link"           | fixed (high to closed)                     | `link-cookie.ts:30,37-52` three states; `api/links.ts:22-28` refuses on `unknown`; `index.astro:13-22,39-46` renders 503 with a retry link; `cookie_link_lookup_failed` carries the caller's route                            |
| S2 no `link_created` event                   | fixed (high to closed)                     | `api/links.ts:73-74` `logInfo("link_created", { route, linkId })`, id only, never the token. A sampled `link_recognised` was not added and was not required by the fix                                                        |
| S3 id lost on post-commit failures           | fixed (high to closed)                     | `createdLinkId` set at `api/links.ts:73` before `setLinkCookie`, passed in the catch context (line 81); non-string result message has `typeof` (`links.ts:23`). `createLink` itself cannot know an id for a non-string result |
| S4 one try, no stage                         | fixed (medium to closed)                   | `stage` variable (`api/links.ts:52,65,76`) goes in `op`; `SupabaseNotConfiguredError` gets its own event (`api/links.ts:82-86`; class imported from `supabase-admin`)                                                         |
| S5 kill switch reads `yes` as open           | still open                                 | `creation-closed.ts:6-9` unchanged; no warning                                                                                                                                                                                |
| S6 no site key, widget silent                | still open                                 | `index.astro:73` renders the widget unconditionally; `turnstile.ts:55-57` still a warn                                                                                                                                        |
| S7 null count disables throttle              | fixed (medium to closed)                   | `links.ts:110-112` throws on `count === null`; the throw lands in the `count_recent` stage                                                                                                                                    |
| S8 pseudo-routes                             | partly fixed (low)                         | cookie lines use the caller's route (`link-cookie.ts:37,50,56`); `turnstile.ts:5` and `access-log.ts:17` unchanged                                                                                                            |
| S9 stale cookie cleared silently             | fixed (low to closed)                      | `link-cookie.ts:43-58` logs `cookie_stale` with reason `malformed` or `not_found`; a lookup failure leaves the cookie alone and returns `unknown`                                                                             |
| S10 no signal when secrets missing on render | still open                                 | `index.astro:13` and `link-cookie.ts:38-40` unchanged in effect                                                                                                                                                               |
| S11 `form_parse_failed` detail               | still open                                 | `api/links.ts:41` still logs the raw header                                                                                                                                                                                   |
| P1 origin-check 403                          | still open (not re-read in `node_modules`) | no change in `src`; the previous reading stands                                                                                                                                                                               |
| P2 purge worker                              | still open                                 | `workers/purge-job/src/index.ts:27,40,50,55` read today                                                                                                                                                                       |
| P3 boundary has no `linkId`                  | still open                                 | `error-boundary.ts:20`                                                                                                                                                                                                        |
| P4 regenerate `try`                          | still open                                 | `regenerate.ts:16-34`                                                                                                                                                                                                         |
| P5 "unexpected value" messages               | partly fixed                               | `create_link` has `typeof`; `regenerate_link`, `delete_account`, lookup row messages (`links.ts:50,69,94`) do not                                                                                                             |
| P6 serializer gaps                           | still open                                 | `log.ts:59-73,81-83` unchanged                                                                                                                                                                                                |
| P7 swallowed 500 render                      | still open (not re-read in `node_modules`) | `500.astro` not changed                                                                                                                                                                                                       |
| F8 cookie lookup swallowed                   | fixed                                      | see S1                                                                                                                                                                                                                        |
| F9 `closed` / `busy` / `full` silent         | fixed                                      | `api/links.ts:31,57-61,68`: `link_creation_closed` (info), `link_creation_busy` (warn, count in `detail`), `link_creation_full` (warn)                                                                                        |
| F2 Turnstile verdicts                        | still fixed (operator side)                | `turnstile.ts:47-58` logs every refusal; widget callbacks still open by decision                                                                                                                                              |
| F10 `access_log` fail-open                   | still open                                 | `access-log.ts:21-23` returns silently when no client is configured                                                                                                                                                           |
| F15 optional secrets                         | still open                                 | `astro.config.mjs:19-24`                                                                                                                                                                                                      |
| F16 no release/env                           | still open                                 | no field in `log.ts`                                                                                                                                                                                                          |
| F17 token in request URLs                    | not re-checked                             | platform behaviour, an assumption                                                                                                                                                                                             |
| F18 errors after streaming starts            | still open, by decision                    | `error-boundary.ts:11` unchanged                                                                                                                                                                                              |
| F20 to F23 purge worker                      | still open                                 | `workers/purge-job/src/index.ts` read today (F23 not specifically re-read, same file)                                                                                                                                         |
| F27 query-string banners                     | still open                                 | `index.astro:28-33`: an unknown `?error=` value shows no banner                                                                                                                                                               |
| F26                                          | not re-checked                             | outside this flow                                                                                                                                                                                                             |

## 8. Method and limits

- **Agents:** none spawned. The skill's auditors are for new audits; verify mode was done by direct reading, with no subagents (a conservative choice, since the limits ruled out delegating and nothing needed fan-out).
- **Read by hand (the cited lines):** `link-cookie.ts` (whole), `api/links.ts` (whole), `index.astro` (whole), `creation-closed.ts`, `log.ts`, `links.ts:1-114`, `turnstile.ts:1-70`, `error-boundary.ts`, `access-log.ts:1-38`, `regenerate.ts:20-60`, `workers/purge-job/src/index.ts:1-59`, `astro.config.mjs:19-24`. Plans in `context/archive/` were not used as evidence.
- **Not re-read:** Astro internals for P1 and P7; the other `projects.ts`, `timer.ts` and `weekly-grid-query.ts` sites for P5 (count taken from the previous report, minus the two changed lines).
- **Repo sweep (production code, `src` and `workers`, re-run):** raw `console.*` calls outside `log.ts`: 3, all in the purge worker (`index.ts:27,50,55`); bare `catch {`: 1 in `WorkspaceCard.astro:274` (plus `log.ts:81`, the logger's own fallback). The earlier counts for other categories were not re-run.
- **Runtime proof:** not run, by instruction (no Docker, Supabase, wrangler, astro, worktree). Every row is static. The old harness in `.claude/worktrees/agent-a992330e2542a0e09/probe/` was not used. A before/after run for S1, S3 and S7 still needs a database that can be made to fail on demand.
- **Tests:** unit tests exist for `link-cookie`, `links`, `log`, `creation-closed` (`src/lib/*.test.ts`); they were not run and are not evidence here.
- **Not verifiable from the repo:** production Workers Logs rendering, retention, alert rules, whether the platform filters `info` lines.
- **Nothing in the application was changed by this run.**
