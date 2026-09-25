# Timer Stop and Flags — Plan Brief

> Full plan: `context/changes/timer-stop-and-flags/plan.md`
> Research: `context/changes/timer-stop-and-flags/research.md`

## What & Why

Let a person stop their running timer, and warn them when it has been running for 12 hours or more. This is roadmap slice S-04 (FR-004): without a stop, the only way a timer ends is switching to another project, and a forgotten timer silently keeps accruing hours. S-05 (corrections) and S-06 (weekly grid) both wait for this slice to merge.

## Starting Point

`switch_timer` is the only code that closes an entry (`ended_at`). The workspace shows a "Currently tracking…" line and a switch section while a timer runs, with no stop control and no elapsed time. The database already enforces one open entry per link, and `NoActiveTimerError` and the shared row validator already exist in `src/lib/timer.ts`.

## Desired End State

While tracking, the workspace has a Stop button. One click closes the entry at that moment and returns to the start screen with a "Timer stopped." banner; a new timer can be started straight away. If the running timer is 12 hours old or more, a warning above Stop says how many hours it has run and asks whether they forgot to stop it.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| "Suspiciously long" threshold | 12 hours elapsed, one named constant, flagged at 12 h or more | Needs no time zone, so it works on the server without waiting on S-06's day-boundary decision. | Plan (user-confirmed) |
| What a flagged timer offers | Warning plus the ordinary Stop, which closes at the current moment | Corrections belong to S-05, which depends on this slice. | Plan (user-confirmed) |
| Stop, then start again | Allowed at any time; no "day closed" state | The start form already shows whenever nothing runs, and defining a day needs S-06's time zone. | Plan (user-confirmed) |
| `stop_timer` shape | Same lock key and four return columns as `switch_timer`, `P0001` if nothing is open | Reuses `parseTimerRow` and `NoActiveTimerError`, and cannot race a switch. | Research |
| Where the flag is computed | At page render from `startedAt`; nothing stored | Needs no migration column; the page already loads the value and sends `no-store`. | Plan (default) |
| Stop UX | One click, no confirmation; "Timer stopped." banner on success | Matches Switch and the "instantaneous" NFR; nothing running redirects silently. | Plan (default) |

## Scope

**In scope:**
- `stop_timer` SQL function (`20260927120000_stop_timer.sql`) and pgTAP tests
- `stopTimer()` wrapper, `timer-flag.ts` with unit tests, the `timer-stopped` status message
- `POST /api/w/[token]/timer/stop`
- Stop button and the `warning` Alert in the workspace card, kitchen-sink states, smoke checks

**Out of scope:**
- Correcting recorded time or stopping "at an earlier time" (S-05)
- A day boundary, time zone or "day closed" state (S-06)
- Live re-evaluation of the flag in an open tab, reminders or notifications
- Storing the flag, a configurable threshold, a stop confirmation dialog, purge-worker changes

## Architecture / Approach

`stop_timer` mirrors `switch_timer` minus the "open the next entry" half: take the shared per-link advisory lock, find the open entry, fail with `P0001` if none, set `ended_at = now()`, return the closed entry. A thin `stopTimer()` wrapper maps `P0001` to `NoActiveTimerError`. The new route re-derives the link from the URL token and redirects with 303, like `switch.ts`. The flag is a pure function of `startedAt` and the current time, evaluated when the card renders; the card takes an optional `now` so the kitchen sink stays deterministic.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database function | `stop_timer` plus pgTAP tests | Using a different lock key would let a stop race a switch |
| 2. App logic and stop route | `stopTimer()`, flag logic with unit tests, status message, `stop.ts` | Keeping edits to the shared `timer.ts` small and additive |
| 3. UI and smoke coverage | Stop button, warning alert, kitchen-sink states, smoke checks | The existing kitchen-sink "tracking" state would turn flagged unless `now` is pinned; the form must be checked in a real browser |

**Prerequisites:** S-02 (first-timer-start) and S-03 (timer-switch-rounding), both shipped and archived.
**Estimated effort:** about 1-2 sessions across 3 phases. One SQL function and one route following S-03's pattern, plus one card change.

## Open Risks & Assumptions

- Until S-05 ships, stopping a flagged timer records all its hours and the user cannot repair them. This is accepted for this slice.
- Switching a flagged timer records the same hours as stopping it; the warning wording covers both, and Switch itself is unchanged.
- A tab left open past 12 hours will not show the flag until it reloads (Stop still works).
- The 12-hour value was confirmed in planning and again in plan-review (accepted, including that a timer left on at 18:00 is not flagged until 06:00).

## Success Criteria (Summary)

- One click stops the running timer and the page returns to the start screen with a confirmation
- A timer running 12 hours or more is visibly flagged, and one under 12 hours is not
- Stopping never leaves two open entries or a stuck timer, and works again straight after a stop
