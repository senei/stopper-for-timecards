# Sign-up lifecycle events — Plan Brief

> Full plan: `context/changes/signup-lifecycle-events/plan.md`
> Audit (frame and research): `context/audits/observability/2026-10-05_landing-signup.md`

## What & Why

`POST /api/links`, the only way to get a private link, leaves almost no trace: a created link emits no event, the `closed`, `busy` and `full` refusals are silent redirects, and one `try` hides which stage failed. When the insert commits but a later step fails, the log has no link id even though it was known. This change gives every outcome one event, labels the stage of a failure, keeps the link id on post-create failures and gives a missing Supabase configuration its own event. It implements S2, S3, S4 and the route half of S8, plus open F9, of the 2026-10-05 audit.

## Starting Point

`src/pages/api/links.ts` checks the cookie, the kill switch and Turnstile, then runs one `try` over the throttle count, `createLink` and `setLinkCookie`; its `catch` logs `link_create_failed` with the route only. `src/lib/log.ts` has `logError` and `logWarn` and no info level. `adminOrThrow` throws a plain `Error`, and the "unexpected value" error from `createLink` says nothing about what came back. The cookie check was fixed in `failed-lookup-not-absence`; this change is the next step of the same audit.

## Desired End State

A successful sign-up writes one `link_created` line with the link id (never the token), emitted before the cookie is set. Each refusal writes `link_creation_closed`, `link_creation_busy` (with the count) or `link_creation_full`. A failure says whether it happened while counting, creating or setting the cookie, carries the link id once the link exists, and a missing configuration appears as `supabase_not_configured`. Every response, redirect and cookie is exactly what it is today.

## Key Decisions Made

| Decision                | Choice                                                                                             | Why (1 sentence)                                                                                              | Source               |
| ----------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------- |
| Returning visitors      | No `link_recognised` event                                                                         | Workers Logs already show request volume, and the logger has no sampling, so a busy user would flood the log. | Plan (user approved) |
| Durable record          | Log lines only; no `access_log` row, no migration                                                  | A row needs a check-constraint migration and fails open (F10); every other event here is a log line.          | Plan (user approved) |
| Event levels            | `link_created` and `link_creation_closed` info; `link_creation_busy` and `link_creation_full` warn | Closed is the owner's own switch; busy and full are things an operator may need to act on.                    | Audit / Plan         |
| Info level              | New `logInfo` in `log.ts` (`console.info`)                                                         | Successes need the same one-line JSON shape, and ESLint forbids `console` anywhere else.                      | Plan                 |
| Link id on late failure | Log `link_created` right after `createLink`, and keep the id for the `catch`                       | The id is known before the cookie and redirect, so a later failure cannot lose it.                            | Audit / Plan         |
| Stage labels            | One `try`, a `stage` variable (`count_recent`, `create_link`, `set_cookie`) used as `op`           | Names the failed stage without nesting three blocks.                                                          | Audit / Plan         |
| Missing configuration   | `SupabaseNotConfiguredError` (same message), route logs `supabase_not_configured`                  | Lets the route separate "secrets missing" from "database down" without parsing text.                          | Audit / Plan         |
| Turnstile route label   | Unchanged                                                                                          | Its refusals are already logged with the reason; changing its signature touches 35 tests for a low gain.      | Plan                 |

## Scope

**In scope:** `logInfo`, `SupabaseNotConfiguredError`, the clearer `createLink` message, the route's events and stage labels, and their tests.

**Out of scope:** `link_recognised`, an `access_log` row or migration, turnstile and `access-log` route labels, config warnings (S5, S6, S10, F15), request ids, `regenerate.ts`, and any change to responses.

## Architecture / Approach

Shared pieces first as pure additions with unit tests and no callers (phase 1), then the route (phase 2): same order of checks, same responses, one added log call per outcome, a `stage` variable and a created-id variable declared outside the `try`, and a `catch` that picks `supabase_not_configured` or `link_create_failed` and attaches `op` and `linkId`. No log line may contain the token; the route test checks this.

## Phases at a Glance

| Phase                         | What it delivers                                                                               | Key risk                                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1. Logger and library support | `logInfo`, `SupabaseNotConfiguredError`, typed unexpected-value message, unit tests            | None significant; pure additions with no callers                        |
| 2. Route events and stages    | One event per outcome, stage and link id on failures, route tests, full lint, manual log check | The token must never reach a log line; `link_created` before the cookie |

**Prerequisites:** none beyond the repo; the manual check in phase 2 needs the local Supabase stack (Docker) and the dev server.
**Estimated effort:** about 1–2 sessions across 2 phases.

## Open Risks & Assumptions

- `link_creation_closed` is reachable by anonymous POSTs before Turnstile, so its volume is steerable; accepted, as with the Turnstile refusal lines.
- A saved Workers Logs query that counted configuration failures under `link_create_failed` must add `supabase_not_configured`.
- Importing the error class into the route test may require mocking `@/lib/supabase-admin` with `importActual`; the plan allows it.
- The manual check needs Docker and a running dev server; if unavailable, the route tests are the proof.

## Success Criteria (Summary)

- Every sign-up outcome leaves one line, and a created link's id is in the log even when the cookie step fails.
- A failure says which stage it came from, and "secrets missing" is distinguishable from "database down".
- Visitors see exactly what they saw before, and no line ever contains a token.
