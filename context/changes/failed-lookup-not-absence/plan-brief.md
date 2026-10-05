# Failed lookup is not absence — Plan Brief

> Full plan: `context/changes/failed-lookup-not-absence/plan.md`
> Audit (frame and research): `context/audits/observability/2026-10-05_landing-signup.md`

## What & Why

When the database check behind a visitor's link cookie fails, the code reads it as "this browser has no link". The landing page then offers "Create my private link", and `POST /api/links` falls through to creation; if the database recovers in between, the visitor gets a second link, the old workspace is orphaned and one of the 10 slots is burned. This change gives a failed check its own state so an outage is never read as absence, and makes a null throttle count an error. It implements S1, S7 and S9 (and the route half of S8) of the 2026-10-05 audit.

## Starting Point

`resolveCookieLink` in `src/lib/link-cookie.ts` returns `null` for no cookie, a stale cookie and a failed lookup alike, and its doc comment calls the last one deliberate. Two callers (`src/pages/index.astro`, `src/pages/api/links.ts`) treat `null` as "no link"; `countRecentLinks` returns `count ?? 0`. Five other pages already show a "Temporarily unavailable" 503 view for a failed read, and the logger, `500.astro` and the error boundary exist.

## Desired End State

With a well-formed cookie and a failing database, `/` shows the "Temporarily unavailable" view (503, "Try again", no sign-up form) and the sign-up POST creates nothing and redirects to `/?error=1`; the log line says which route asked. A stale cookie leaves one `cookie_stale` warning, and a null throttle count refuses the sign-up. A healthy returning visitor, a first-time visitor and every banner behave exactly as today.

## Key Decisions Made

| Decision                       | Choice                                                                            | Why (1 sentence)                                                                                       | Source               |
| ------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------- |
| Landing page on a failed check | 503 with the "Temporarily unavailable" view and a "Try again" button, cookie kept | Same pattern as five existing pages, and the visitor is never offered a second link.                   | Plan (user approved) |
| Sign-up POST on a failed check | Create nothing, 303 to `/?error=1`                                                | No second link or burned slot, and no new forgeable `?error=` message (F27).                           | Plan (user approved) |
| State shape                    | `resolveCookieLink(cookies, route)` returns `linked` / `none` / `unknown`         | A discriminated union cannot be mistaken for "no link", and the route argument fixes the pseudo-route. | Audit / Plan         |
| Stale cookie                   | Still cleared, now with one `cookie_stale` warning and a reason                   | Mass clearing from a wrong lookup would otherwise be invisible (S9).                                   | Audit                |
| Throttle count                 | Throw on a null count                                                             | Matches the neighbouring lookups; the existing `link_create_failed` path then refuses the sign-up.     | Audit                |
| Proof of the landing page      | Manual run against an unreachable Supabase URL                                    | No test imports an `.astro` file, and no mechanism makes a read fail in Playwright.                    | Plan                 |

## Scope

**In scope:** the three-state helper and its two callers, the unavailable view on `/`, the `cookie_stale` event, the null-count throw, and their tests.

**Out of scope:** sign-up lifecycle events and stage labels (S2–S4), events for `closed`/`busy`/`full` (F9), config warnings (S5, S6, S10, F15), widget callbacks, any new `?error=` code, and an Astro Container test.

## Architecture / Approach

The helper stays the only place that classifies the cookie and returns a three-way result; callers only decide what to show. Phase 1 changes the helper, both callers and their tests in one commit, because an object return value would be truthy in the old `if (linkedToken)` checks. Phase 2 is a small, separate data-layer fix that carries the last-code-phase checks.

## Phases at a Glance

| Phase                                        | What it delivers                                                                   | Key risk                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1. Three-state cookie lookup and its callers | Helper, landing page 503 view, POST refusal, `cookie_stale`, updated and new tests | A mixed state (helper changed, caller not) must never be committed |
| 2. Throttle count fails loudly               | `countRecentLinks` throws on null, tests, full lint and `astro check`              | None significant; one small function                               |

**Prerequisites:** none beyond the repo; the manual check in phase 1 needs the app running against an unreachable Supabase URL (no Docker required).
**Estimated effort:** about 1–2 sessions across 2 phases.

## Open Risks & Assumptions

- A brand-new visitor holding a stale-but-well-formed cookie sees the unavailable view too while the database is down; accepted.
- The unavailable sentence is user-facing copy, confirmed by a human in phase 1.
- Saved Workers Logs queries that filtered `cookie_link_lookup_failed` on `route = "lib/link-cookie"` must change to the new route values.
- `index.astro` has no automated test; its behaviour rests on the manual check.

## Success Criteria (Summary)

- A database outage never shows a returning visitor the sign-up form or creates a second link for them.
- The log says which route asked, and stale cookies are visible as events.
- The throttle can no longer be skipped silently by a null count.
