---
type: observability-audit
date: 2026-10-02 11:10
mode: verify
commit: c35c93d
branch: main
dirty_tree: false
areas: [timer, delete-account-and-project, link-create-and-regenerate, weekly-grid-and-purge]
area_source: arguments
runtime_proof: observed
error_tracker: none (Cloudflare Workers Logs via console only; wrangler.jsonc:12)
previous_report: context/audits/observability/2026-10-02_timer-delete-link-grid.md
findings: { critical: 1, high: 4, medium: 11, low: 5 }
---

# Observability audit, verify — fix-silent-error-logging (2026-10-02)

Checks the original audit's findings against the code at `c35c93d` (phases 1–4 of `context/changes/fix-silent-error-logging`). `findings` above counts what is still open. Nothing in the application was changed by this run.

## 1. TL;DR

- **The four formerly "missed" probes are now diagnosable.** R7, R8, R12, R13 and R14 (workspace and grid pages, DB failure) went from a request line only to one JSON line with `event` and `route`; R12, R13 and R7 also carry the database `code`.
- **The database code now reaches the log.** R1, R2s, R3, R5 (timer start/stop, account delete, link creation) printed no `code` before; they print it now.
- **No response changed.** All 26 probes return the same HTTP status as the baseline, as intended.
- **No log line contains the link token.** 15 `"event"` lines in the run, 0 contain the 43-character token.
- **Still open and not touched by this change:** Turnstile collapsing every failure into `false` (F2, the one remaining critical), the unguarded page reads (F3, R9/R10 unchanged), the `access_log` fail-open (F10), the purge worker (F20–F22), 303-as-success for action failures (F6, now at least logged).

## 2. Capture model

Unchanged from the original report except for one new fact: every `console.error` / `console.warn` in `src` now goes through `src/lib/log.ts` (`logError` / `logWarn`), one JSON line per event with `level`, `event`, `route`, optional `linkId` / `projectId` / `op` / `detail`, and a serialised `error` (message truncated to 500 characters, stack, `code` / `details` / `hint`, `cause` to depth 3). ESLint now rejects a `catch` without a binding in `src/**/*.{ts,tsx,astro}` and any direct `console` call outside `log.ts`.

**Assumptions (unconfirmed, outside the repo):** Workers Logs parse JSON log lines into fields; production URL logging of the `/w/<token>` path; production workerd rendering of `Error` arguments. This run only observed local workerd output.

## 3. What reaches the logs: before and after

Same harness (`probe/suite.sh`), same probes, production build under `wrangler dev`, local Supabase behind a fault-injecting proxy. "Before" is `probe/out-before/` (code at `bcd00db`), "after" is `probe/out/` (code at `c35c93d`). `event` = number of `"event"` JSON lines in that probe's console output.

| Probe        | Failure shape                                            | HTTP            | event before → after | code before → after | linkId before → after | Verdict                                                           |
| ------------ | -------------------------------------------------------- | --------------- | -------------------- | ------------------- | --------------------- | ----------------------------------------------------------------- |
| R7           | workspace page, link lookup → 500                        | 503 → 503       | 0 → 1                | no → yes            | no → no               | **missed → good**                                                 |
| R8           | workspace page, DB unreachable                           | 503 → 503       | 0 → 2                | no → no             | no → no               | **missed → ok** (lookup failure + `access_log_failed`)            |
| R12          | grid page, link lookup → 500                             | 503 → 503       | 0 → 1                | no → yes            | no → no               | **missed → good**                                                 |
| R13          | grid page, `fetchWeekEntries` → 500                      | 503 → 503       | 0 → 1                | no → yes            | no → yes              | **missed → good**                                                 |
| R14          | grid page, DB unreachable                                | 503 → 503       | 0 → 1                | no → no             | no → no               | **missed → ok**                                                   |
| R1           | timer start, `start_timer` → 500 JSON                    | 303 → 303       | 0 → 1                | no → yes            | no → yes              | poor → good                                                       |
| R1b          | timer start, `start_timer` → 502 HTML                    | 303 → 303       | 0 → 1                | no → no             | no → yes              | poor → ok (HTML body truncated, nothing to carry as `code`)       |
| R2s          | timer stop, `stop_timer` → 500                           | 303 → 303       | 0 → 1                | no → yes            | no → yes              | poor → good                                                       |
| R3           | delete-account, `delete_account` → 500                   | 303 → 303       | 0 → 1                | no → yes            | no → yes              | poor → good                                                       |
| R5           | link creation, `create_link` → 500                       | 303 → 303       | 0 → 1                | no → yes            | no → no               | poor → good (no link exists yet, so no `linkId` by design)        |
| R2 / R4 / R6 | action route, DB unreachable                             | 503 / 503 / 303 | 0 → 1 each           | no → no             | no → no               | ok → ok (route now named in the line)                             |
| R11          | workspace page, `access_log` insert → 500                | 200 → 200       | 0 → 1                | no → yes            | no → yes              | poor → good (`code`, `linkId` and outcome now present)            |
| R9 / R10     | workspace page, `getCurrentTimer` / `listProjects` → 500 | 500 → 500       | 0 → 0                | no → no             | no → no               | good → good (Astro logs the stack; **not changed**, still no ids) |
| P1–P10b, R0  | control probes                                           | unchanged       | 0 → 0                | —                   | —                     | n/a                                                               |

Raw data: `probe/out-before/results.json`, `probe/out/results.json` and `probe/out/<id>.log` in the harness worktree.

## 4. Systemic root causes

| Root cause (original report §4)                            | Status                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Pages treat a backend failure as UI state, not an event | **Fixed for the lookup and entries catches** (observed). The page reads outside a `try` (F3) are unchanged.                                                                                                                                                      |
| 2. The data layer keeps only `error.message`               | **Fixed** for all 13 wrappers (unit-tested; observed for the RPC and query paths in R1, R2s, R3, R5, R7, R12, R13).                                                                                                                                              |
| 3. Failures encoded as ordinary responses with no identity | **Partly fixed**: the log lines now carry route and `linkId`; the responses are still 303 / body-less 503 / silent 404 by design.                                                                                                                                |
| 4. No shared boundary or logger                            | **Partly fixed**: a logger exists and ESLint enforces it. No middleware and no `500.astro` yet.                                                                                                                                                                  |
| 5. Expected and unexpected outcomes share a silent path    | **Open** except the timer / project-delete race backstops (now `warn`, unit-tested, not probed) and `form_parse_failed`. Turnstile, cookie-link and kill-switch outcomes: cookie-link and Turnstile _exceptions_ are logged; `closed` / `busy` / `full` are not. |
| 6. The purge job reports only what it ran                  | **Open**, not touched.                                                                                                                                                                                                                                           |

## 5. Findings by area

Status of each finding from the original report. "Fixed" means the code mechanism the finding cited is gone and a test or probe shows it; "not re-checked" means this run did not look.

| Finding                                                         | Status             | Evidence                                                                                                                                                   |
| --------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 pages swallow lookup / entries errors                        | **fixed**          | R7, R8, R12, R13, R14 (observed)                                                                                                                           |
| F2 Turnstile collapses every failure to `false`                 | **still open**     | `turnstile.ts` only logs the thrown-exception case (`turnstile_verify_failed`, unit-tested); missing secret, non-2xx and a real rejection are still silent |
| F3 unguarded page reads → blank 500                             | **still open**     | R9, R10 unchanged                                                                                                                                          |
| F4 lib rethrows drop `cause`                                    | **fixed**          | `db-error-cause.test.ts` (13 wrappers); R1, R2s, R3, R5 (observed)                                                                                         |
| F5 route logs lack ids and route                                | **fixed**          | R1, R2s, R3, R13 show `route` and `linkId` (observed)                                                                                                      |
| F6 failures flattened to 303 / 503 / 404                        | **changed**        | statuses identical by design; every failure branch now leaves an event                                                                                     |
| F7 silent race backstops and 404 rewrites                       | **partly fixed**   | backstops warn (`timer-routes.test.ts`); 404 for unknown tokens still unlogged by design                                                                   |
| F8 `resolveCookieLink` swallows lookup errors                   | **fixed**          | logs `cookie_link_lookup_failed` (`link-cookie.test.ts`); not probed                                                                                       |
| F9 no telemetry for `closed` / `busy` / `full`                  | **still open**     |                                                                                                                                                            |
| F10 `access_log` fail-open                                      | **partly fixed**   | R11 now logs `code`, `linkId`, outcome; a null admin client is still silent; deletes still wipe the trail; no distinct rotation event                      |
| F11, F12 post-commit parse errors, SQLSTATE-only classification | **not re-checked** | code unchanged                                                                                                                                             |
| F13 no middleware / `500.astro`                                 | **still open**     |                                                                                                                                                            |
| F14 form-parse catches swallowed                                | **fixed**          | `form_parse_failed` with content type (`timer-routes.test.ts`); not probed                                                                                 |
| F15–F19, F23–F27                                                | **not re-checked** | untouched by this change                                                                                                                                   |
| F20–F22 purge worker                                            | **still open**     | untouched                                                                                                                                                  |

## 6. Recommended fix order (what remains)

1. **Turnstile as a discriminated result** (F2): the last critical; sign-up can still fail completely and look like bot traffic.
2. **Wrap the post-lookup page reads and add a `500.astro` / middleware boundary** (F3, F13): R9 / R10 are the only probed rows that did not improve.
3. **`access_log` and lifecycle events** (F10, F9): log when the admin client is null, a distinct rotation outcome, a delete-account event.
4. **Purge worker** (F20–F22).
5. **Platform decisions**: token in request URLs (F17), release / environment identity (F16).

## 7. Changes since last audit

See §5; this whole report is a verify run against `2026-10-02_timer-delete-link-grid.md`.

## 8. Method and limits

- **Run:** `bash probe/suite.sh` in the isolated worktree `.claude/worktrees/agent-a992330e2542a0e09`, checked out detached at `c35c93d`; baseline copied to `probe/out-before/` first. The comparison reads `results.json` of both runs plus each probe's `.log`; the token check greps the lines containing `"event"` in `probe/out/full-console.log` for the seeded link token.
- **Statuses:** all 26 probes returned the same HTTP status in both runs.
- **Not verifiable here:** production Workers Logs (JSON parsing into fields, retention, URL logging), production handling of floating rejections and truncated streams (P7, P10b). The unprobed routes (regenerate, project delete, timer switch) and the new `warn` events are covered by unit tests only.
- **Cleanup:** after the run no process was listening on the probe ports (8799, 54399). The harness worktree is left in place for further before / after runs.
