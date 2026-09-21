# Private Link Access — Plan Brief

> Full plan: `context/changes/private-link-access/plan.md`

## What & Why

Give each person their own private link (`/w/<token>`) as their identity — no account, no password — capped at 10 people, with a clear "full" message after that. It is roadmap slice S-01 (issue #1), the first step of the core timecard flow: every later slice (projects, timer, weekly grid) is keyed to a person's link.

## Starting Point

The app still runs the starter's Supabase email/password auth, and CI's smoke test depends on it. The database already has `access_log` and `time_entries.link_id` waiting for a stable per-person id, plus a `logAccess()` helper nothing calls. Existing tables have no row-level security. CI has been red since 2026-09-18 (lint errors, and smoke steps that fail on the email setup), so the plan repairs both on the way.

## Desired End State

A visitor clicks "create my private link", lands on `/w/<token>` in an empty workspace showing their own link, and can reopen it anywhere without logging in. The 11th person sees "full". Wrong or malformed tokens all get the same 404. Lookups are logged. The email/password code is gone and CI verifies the link flow.

## Key Decisions Made

| Decision            | Choice                                                    | Why                                                                                  |
| ------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Creation gating     | Open creation + browser cookie + Turnstile bot check + creation throttle (3 per 10 min) | Stops accidental double links and scripted slot exhaustion without a shared secret the PRD forbids |
| Link shape          | Token in URL path, checked against the DB every request   | Bookmarkable, works on any device, no session state to invalidate on regeneration    |
| Token storage       | Only a SHA-256 hash stored; stable `links.id` per person  | A database leak exposes no usable links; regeneration (S-07) changes only the hash   |
| Cap enforcement     | One atomic database function (10th ok, 11th `null`)       | Two simultaneous creators cannot both take the last slot                             |
| Starter auth        | Remove pages, routes, middleware, dependency              | Leaves no public signup endpoint and no dependence on the Resend email setup         |
| Access log          | Log hits and well-formed misses (null link id); skip malformed | Records guessing attempts without letting scanner noise flood the table         |
| Table security      | RLS on all four tables, no policies                       | Anon key can no longer read link hashes, IPs or entries; server uses service role    |
| Closing creation    | `LINK_CREATION_CLOSED` secret stops all new links; existing links unaffected | Once the coworkers are onboarded the slot-exhaustion risk is gone, with no admin role |
| Rate limiting       | No per-IP rule or Workers binding; Turnstile + database-backed throttle | Dashboard rules need a zone and the binding is unverified on `workers.dev`; these two need neither |

## Scope

**In scope:** links table and atomic capped creation, RLS, token helpers, create and open flow, access logging, "full" and 404 behaviour, removal of the starter auth, CI and smoke updates, production rollout.

**Out of scope:** per-IP rate limiting, reclaiming idle slots, link regeneration (S-07), projects/timer/entries (S-02+), the purge worker (S-08), an admin way to free slots, remote Supabase Auth signup disable (recommended follow-up).

## Architecture / Approach

All data access is server-side through one service-role client. `POST /api/links` creates a link through the database function and sets a convenience cookie; `/w/[token]` hashes the token, looks it up, logs the outcome (awaited, so no audit row is dropped), and renders the workspace with no-store, no-referrer and noindex headers. Before a link is created the route checks the cookie, then a Turnstile token, then a database count of links made in the last 10 minutes. Nothing in the browser holds identity except the URL itself.

## Phases at a Glance

| Phase                     | What it delivers                                                        | Key risk                                             |
| ------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| 1. Link data and core     | Migration (links, cap, RLS), token helpers, hardened `logAccess`, lint baseline repair, tests | Getting the cap and RLS right in SQL |
| 2. Create and open a link | Landing page, create route, workspace page, smoke test rebuilt around the link flow | Cookie and "already has a link" edge cases |
| 3. Retire the starter auth | Old auth removed, smoke and CI reworked around the link flow           | CI needs the service-role key wired correctly        |
| 4. Ship and verify        | Migration pushed, Turnstile widget and secrets set, deployed and checked in production | Test links permanently use up slots; Turnstile may reject the `workers.dev` hostname |

**Prerequisites:** Docker for local Supabase (`supabase start`, pgTAP tests); the linked remote Supabase project; the three Worker secrets already set; a Turnstile widget created in the Cloudflare dashboard before the production deploy (Phase 4).
**Estimated effort:** 4 phases, one `/10x-implement` run each.

## Open Risks & Assumptions

- Turnstile may not accept the `workers.dev` hostname; Phase 4 checks this and falls back to the cookie, the throttle and the cap. Turnstile fails closed, so the production secrets must be set before deploy or nobody can create a link.
- The throttle is global, so a slow drip (one link every few minutes) can still fill the slots while creation is open. The answer is closing creation with `LINK_CREATION_CLOSED` once everyone has a link; before that, recovery is deleting rows in SQL. CI now depends on reaching `challenges.cloudflare.com`.
- A lost link cannot be recovered and its slot is never freed (PRD-accepted); production test links must be deleted by SQL to avoid wasting slots.
- Supabase Auth signups stay reachable on the project until the follow-up config change is made.

## Success Criteria (Summary)

- A new visitor can create a link and reopen it from any browser without logging in.
- The 11th visitor sees "full" and no link is created, even under concurrent attempts.
- Nothing readable with the anon key exposes links, entries or logs, and access to links is auditable.
