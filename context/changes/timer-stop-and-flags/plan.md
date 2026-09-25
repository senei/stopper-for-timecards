# Timer Stop and Flags Implementation Plan

## Overview

Let a person stop their running timer, and warn them when the running timer has been going for 12 hours or more. This is roadmap slice S-04 (FR-004). Stop closes the open `time_entries` row at the current moment through a new atomic `stop_timer` SQL function, following the `switch_timer` pattern. The warning is computed when the workspace page renders from data the page already loads; nothing new is stored. Correcting the recorded time of a forgotten timer is S-05's job and is deliberately not part of this slice.

## Current State Analysis

- Nothing in the code stops a timer. A search for `ended_at =` and `ended_at:` across `src/`, `workers/`, `supabase/migrations/` and `scripts/` finds one write, in `switch_timer` (`supabase/migrations/20260923120000_switch_timer.sql:73`).
- `switch_timer` already contains everything a stop needs except the "start the next entry" half: the shared advisory lock (`:63`), the open-entry lookup, `P0001` when none is open (`:69-71`), the close (`:73`), and the `service_role`-only grants (`:94-95`).
- The database already guarantees at most one open entry per link (`supabase/migrations/20260922150000_projects_and_timer.sql:57-59`), so stop needs no new constraint.
- `src/lib/timer.ts` has `NoActiveTimerError` (`:19-25`), the shared row validator `parseTimerRow` (`:28-55`), and `switchTimer` (`:83-95`) to copy. The validator was extracted in S-03's review specifically so the S-04 stop wrapper would not add a third copy (`context/archive/2026-09-23-timer-switch-rounding/reviews/impl-review.md:80-88`).
- The workspace card shows a "Currently tracking … started at HH:MM" line and the switch section while tracking (`src/components/WorkspaceCard.astro:99-141`), with no stop control and no elapsed time. With no timer running it shows the start form (`:142-183`), so a successful stop already lands on the right screen.
- The page loads `currentTimer.startedAt` on every render (`src/pages/w/[token].astro:55`) and sends `Cache-Control: no-store` (`:17`).
- The `Alert` component already has a `warning` variant (`src/components/ui/alert.tsx:17-18`), backed by `--color-warning` tokens (`src/styles/global.css:137-138`).
- `src/pages/dev/kitchen-sink.astro` renders `WorkspaceCard` in every state. Its "tracking" state uses a fixed `startedAt` of `2026-09-24T10:57:00.000Z` (`:19-23`), which is already more than 12 hours before 2026-09-25 and would render as flagged as soon as the card computes a flag from the real clock.

## Desired End State

While a timer runs, the workspace shows a Stop button. Clicking it closes the entry at that moment and returns to the start screen with a "Timer stopped." banner; the person can start a timer again immediately. When the running timer has been going for 12 hours or more, a warning above the Stop button says how many whole hours it has run and asks whether they forgot to stop it. Stopping a flagged timer closes it at the current moment like any other stop.

Verification: `npx supabase test db`, `npx vitest run`, lint, `astro check`, build and `npm run smoke:local` all pass, and the Stop form has been submitted in a real browser.

### Key Discoveries:

- `stop_timer` must take the same advisory lock key, `'public.timer:' || p_link_id::text`, as `start_timer` and `switch_timer` (`20260923120000_switch_timer.sql:25,63`); a different key would let a stop race a switch.
- `parseTimerRow` requires exactly `entry_id`, `project_id`, `project_name`, `started_at` (`src/lib/timer.ts:35-46`); returning those four columns from `stop_timer` reuses it unchanged.
- Both existing routes redirect silently on their "wrong state" error (`src/pages/api/w/[token]/timer/switch.ts:46-50`, `start.ts:47-51`); stop follows suit for `NoActiveTimerError`.
- The client script already disables a form's submit button on submit, for every form in the card (`WorkspaceCard.astro:260-269`), so a Stop form inherits double-submit protection.
- Lesson (`context/foundation/lessons.md:19-24`): the workspace page already sets `Referrer-Policy: strict-origin` (`[token].astro:16`), but every new form must be submitted in a real browser, because smoke and curl set `Origin` themselves.
- Lesson (`lessons.md:5-10`): run `npx astro check` once before `npx astro dev` after a config change.

## What We're NOT Doing

- **Correcting recorded time.** No "stop N minutes ago", no editing an end time. Stopping a flagged timer records all its hours; fixing them is S-05 (FR-005). Decided with the user in planning.
- **Defining "the day".** After Stop the person can start a timer again at any time; nothing marks the day as closed. The day boundary and time zone are S-06's open question (`context/foundation/roadmap.md:157`). Decided with the user in planning.
- **A time-zone or "past end of day" rule.** The threshold is elapsed duration only. Decided with the user in planning.
- **Live re-evaluation of the flag.** The flag is computed when the page renders. A tab left open overnight will not show it until it reloads (Stop still works from that tab). No client-side timer, no reminders or notifications (PRD "Secondary", `context/foundation/prd.md:36`).
- **Changing Switch for a flagged timer.** Switching a flagged timer stays exactly as it is and records the same hours as Stop would; the warning wording says so instead.
- **Storing the flag.** No new column; a stopped entry carries no "was flagged" marker.
- **A confirmation step or dialog for Stop.** One click, like Switch and consistent with the "instantaneous" NFR (`prd.md:89`).
- **A configurable threshold.** One named constant in code, not a setting or an environment variable.
- **Purge-worker changes.** The worker deletes by `started_at` regardless of `ended_at` (`workers/purge-job/src/index.ts:17`); that is S-08's territory.

## Implementation Approach

Three phases, the same split S-03 used: database function first so the contract is proven under pgTAP, then the TypeScript layer and route with the pure flag logic under unit tests, then the UI and the end-to-end smoke coverage. Each phase ends in something runnable and reviewable on its own. Linting is slow here (a cold type-aware run takes many minutes), so the full `npm run lint` runs once, in Phase 3, instead of after every phase; between phases rely on `npx astro check` and editor diagnostics, and fix any lint findings in one pass at the end. CI lints the PR again. Progress row 2.3 is intentionally absent (the removed lint step) and the manual row keeps its number 2.4, per the Progress format's "never renumbered" rule.

Decisions taken in planning (all confirmed with the user unless marked "default"):

- **Threshold:** the timer is flagged once elapsed time is 12 hours or more, kept as the single named constant `LONG_RUNNING_TIMER_HOURS`. The user confirmed 12 hours in planning, and plan-review re-surfaces it for a final check before implementation, as the lane requires.
- **Flag action:** a `warning` Alert with the elapsed whole hours, next to the ordinary Stop button.
- **Stop then start:** allowed at any time (current behaviour, no new state).
- **Return shape (default):** `stop_timer` returns the closed entry with the same four columns as `switch_timer`.
- **Feedback (default):** a successful stop redirects with `?status=timer-stopped` and shows "Timer stopped."; a stop with nothing running redirects to the plain workspace with no banner.

## Critical Implementation Details

- **Lock key.** Reuse the literal `'public.timer:'` prefix; see Key Discoveries. Do not introduce a `public.stop_timer:` key.
- **Kitchen-sink determinism.** The card must take an optional `now` prop (default: the real clock) and the kitchen-sink page must pin it, otherwise the existing "tracking" state flips to flagged as the calendar advances and screenshots drift, the same problem `headingIndex` already solves (`WorkspaceCard.astro:21`).

## Phase 1: Database function

### Overview

Add `stop_timer` and prove its behaviour, grants and isolation under pgTAP. No application code changes in this phase.

### Changes Required:

#### 1. `stop_timer` migration

**File**: `supabase/migrations/20260927120000_stop_timer.sql` (new; the `20260927…` prefix is this lane's per `context/foundation/parallel-goals.md:60`; never edit an existing migration)

**Intent**: Add an atomic function that closes the link's single open entry at the current moment, or fails loudly if none is open, serialized against `start_timer` and `switch_timer`.

**Contract**: `stop_timer(p_link_id uuid) returns table (entry_id uuid, project_id uuid, project_name text, started_at timestamptz)`, `language plpgsql`, `security definer`, `set search_path = public`. Takes `pg_advisory_xact_lock(hashtext('public.timer:' || p_link_id::text))`. Finds the link's row with `ended_at is null`; if none, `raise exception … using errcode = 'P0001'` (same code and reasoning as `switch_timer`). Otherwise sets `ended_at = now()` and returns that entry's `id`, `project_id`, `project_name`, `started_at`. `revoke execute … from public, anon, authenticated; grant execute … to service_role`. No table or index changes. Header comment states the purpose and that it shares the lock key with the other timer functions. The return columns share names with `time_entries` columns, so qualify every column reference in the body with a table alias, as `switch_timer` does (`insert into public.time_entries as te … returning te.id, te.project_id`, `20260923120000_switch_timer.sql:88-90`); an unqualified reference fails as ambiguous.

#### 2. pgTAP tests

**File**: `supabase/tests/database/stop_timer.test.sql` (new)

**Intent**: Cover the function's contract in the style of `switch_timer.test.sql` (`begin; … rollback;`, `select plan(n)`, fixed link ids).

**Contract**: Two fixed link ids not used by the existing tests (`…001`–`…005` are taken): `a0000000-0000-0000-0000-000000000006` and `…007`. Cases, about 15 assertions in total:

- Start then stop: exactly one row returned; it names the started entry; `ended_at` is set and not earlier than `started_at`; no open entry remains; the `projects` row count is unchanged.
- Stop with no open entry: `throws_ok` with `P0001`; entry count unchanged.
- Restart after stop: `start_timer` succeeds and leaves exactly one open entry; total entries are two.
- Isolation: stopping one link leaves another link's open entry open.
- Grants: `anon` and `authenticated` cannot execute; `service_role` can.

### Success Criteria:

#### Automated Verification:

- Migration applies on a fresh local database: `npx supabase db reset`
- The pgTAP suite, including the new file, passes: `npx supabase test db`

#### Manual Verification:

- In the local Supabase SQL editor, `start_timer` then `stop_timer` for one link leaves the entry with `ended_at` set and no open entry

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: App logic and stop route

### Overview

Add the TypeScript wrapper, the pure flag logic with unit tests, the status message, and the API route. No UI changes; the route is exercised by curl here and by smoke in Phase 3.

### Changes Required:

#### 1. `stopTimer` wrapper

**File**: `src/lib/timer.ts`

**Intent**: Call `stop_timer` and translate its "nothing running" error to the existing typed error, following `switchTimer`.

**Contract**: `stopTimer(linkId: string): Promise<StartTimerResult>` returning the closed entry. RPC `stop_timer` with `{ p_link_id: linkId }`; Postgres code `P0001` → throw `NoActiveTimerError`; any other error → `Error("stop_timer failed: …")`; success → `parseTimerRow("stop_timer", response.data)`. Update the doc comments that name only `switch_timer` (on `NoActiveTimerError` and `parseTimerRow`) to include `stop_timer`. Keep the edit small and additive; this file is a hot file shared with other lanes (`parallel-goals.md:61`).

#### 2. Flag logic

**File**: `src/lib/timer-flag.ts` (new) and `src/lib/timer-flag.test.ts` (new)

**Intent**: Hold the threshold constant and the pure decision, kept out of `timer.ts` so a unit test does not import the Supabase client (same reason `project-name.ts` is its own module).

**Contract**: `export const LONG_RUNNING_TIMER_HOURS = 12`; `isTimerFlagged(startedAt: string, now: Date): boolean` — true when elapsed time is at least the threshold; false for an unparseable `startedAt` or a `startedAt` after `now`. `elapsedWholeHours(startedAt: string, now: Date): number` — whole hours elapsed, floored, `0` for the same unparseable or future cases. Tests, all with an injected `now`: 11 h 59 m 59 s is not flagged, exactly 12 h 00 m 00 s is flagged, well past the limit is flagged, an invalid date string is not flagged, a future start is not flagged, and `elapsedWholeHours` floors (for example 14 h 03 m gives 14).

#### 3. Status message

**File**: `src/lib/status-messages.ts` and `src/lib/status-messages.test.ts`

**Intent**: Add the success banner code for a stop.

**Contract**: `export const STATUS_TIMER_STOPPED = "timer-stopped"`, mapped in `statusMessage` to `"Timer stopped."`. Extend the existing test the way `STATUS_PROJECT_DELETED` is covered.

#### 4. Stop route

**File**: `src/pages/api/w/[token]/timer/stop.ts` (new)

**Intent**: The only way a timer is stopped, built on the same skeleton as `switch.ts` but with no request body.

**Contract**: `POST` handler: malformed token → `rewrite("/404")`; `findLinkByToken` throws → 503; link not found → `rewrite("/404")`; then `stopTimer(link.id)`. `NoActiveTimerError` → `redirect(\`/w/${token}\`, 303)` (silent race backstop). Success → `redirect(\`/w/${token}?status=timer-stopped\`, 303)`. Other errors → log and `redirect(\`/w/${token}?error=${ERROR_GENERIC}\`, 303)`. `ALL` returns 405 with `Allow: POST`. The link is re-derived from the URL token; the cookie is never trusted.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the new flag and status tests: `npx vitest run`
- Type checking passes: `npx astro check`

#### Manual Verification:

- With the dev server running and a timer started, `POST /api/w/<token>/timer/stop` (with an `Origin` header and a form body) answers 303 to `?status=timer-stopped`; repeating it answers 303 to the plain workspace; a `GET` answers 405

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: UI and smoke coverage

### Overview

Show the Stop button and the long-running warning, keep the kitchen-sink states deterministic, and cover stop, restart and the flag end to end in smoke.

### Changes Required:

#### 1. Workspace card

**File**: `src/components/WorkspaceCard.astro`

**Intent**: While tracking, offer a Stop button, and above it a warning when the timer is flagged.

**Contract**: New props `stopAction: string` (required, next to `startAction`/`switchAction`) and `now?: Date` (default `new Date()`; pinned by the kitchen sink). In the tracking branch (`:99-141`), after the "Currently tracking" line and before the switch section: when `isTimerFlagged(currentTimer.startedAt, now)`, render the existing `Alert` with `variant="warning"` and text along the lines of "This timer has been running for {N} hours. Did you forget to stop it? Stopping or switching now records all of that time." where `{N}` is `elapsedWholeHours(...)`. The wording is the implementer's, but it must state the hours and that both stopping and switching record them, because `switch_timer` also closes the running entry at the current moment. The alert carries a stable `data-long-running-warning` attribute, which smoke matches instead of the prose. Then a `<form method="post" action={stopAction}>` with a single submit button "Stop" using an existing button variant, no fields. Shown only while a timer runs, so no special case for "nothing to stop" exists in the UI.

#### 2. Workspace page

**File**: `src/pages/w/[token].astro`

**Intent**: Pass the new action URL to the card.

**Contract**: Add `const stopAction = \`/api/w/${token}/timer/stop\`` beside `switchAction` (`:62`) and pass `stopAction={stopAction}` to `WorkspaceCard`. Do not pass `now`. Additive edit only (hot file).

#### 3. Kitchen sink

**File**: `src/pages/dev/kitchen-sink.astro`

**Intent**: Keep every state deterministic and add the flagged state.

**Contract**: Add `stopAction: "/dev/kitchen-sink"` and a pinned `now` (for example `new Date("2026-09-24T12:00:00.000Z")`, about 1 h after the existing `running.startedAt`) to `shared`. Add a state `"tracking, flagged"` with the same `currentTimer: running` and its own `now` override at least 12 hours later (for example `new Date("2026-09-25T01:00:00.000Z")`, about 14 h). Per-state props already override `shared` via the spread order at `:57`.

#### 4. Smoke coverage

**File**: `scripts/smoke.mjs`

**Intent**: Prove stop, the silent second stop, restart and the flag through the real HTTP routes, inside the block gated on `SMOKE_SUPABASE_URL` and `SMOKE_SERVICE_ROLE_KEY` (`:154`), after the switch checks that end at `:316`.

**Contract**: Starting from "Acme Widgets" running (fresh, so its page has no flag text): assert the workspace page does not contain the `data-long-running-warning` attribute. `POST …/timer/stop` → 303 to `/w/${token}?status=timer-stopped`; `timeEntries()` shows zero open and all four entries closed; the page then contains "Timer stopped." and offers the start form. A second stop → 303 to `/w/${token}` with no status. `POST …/timer/start` for "Acme Widgets" → one open entry again (restart allowed). Then seed an old timer: close the current entry, insert an open `time_entries` row through the existing `rest()` helper with `started_at` 13 hours in the past and a valid `project_id`/`project_name`, load the workspace, assert the `data-long-running-warning` attribute and "13 hours" appear, then stop it through the route to leave the link clean.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- Smoke passes against a reset local database, including the new stop, restart and flag checks: `npm run smoke:local`

#### Manual Verification:

- In a real browser, clicking Stop on a running timer returns to the start screen with the "Timer stopped." banner (proves the form passes Astro's origin check, per the lesson)
- With a local timer whose `started_at` is pushed back 13 hours in SQL, the workspace shows the warning naming 13 hours above the Stop button; Stop closes it; a freshly started timer shows no warning
- Stopping and then starting the same project again works
- The kitchen-sink "tracking" state shows no warning and the new "tracking, flagged" state shows the warning, both readable in light and dark themes

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- `timer-flag.test.ts`: the 12-hour boundary on both sides, invalid and future timestamps, whole-hour flooring.
- `status-messages.test.ts`: the new `timer-stopped` code, plus the existing unknown/null cases unchanged.

### Integration Tests:

- `stop_timer.test.sql` (pgTAP): close, no-open rejection, restart, per-link isolation, grants.
- `scripts/smoke.mjs`: stop, silent second stop, restart, and the flag with an old seeded entry, through the real routes.

### Manual Testing Steps:

1. Start a timer in a browser, click Stop, confirm the banner and the start form.
2. Push a running entry's `started_at` back 13 hours in local SQL, reload, confirm the warning and hours, click Stop.
3. Open the dev kitchen sink and check the tracking and flagged states in both themes.

## Performance Considerations

None beyond the existing single-row lookups. The flag is a subtraction on a value the page already loads.

## Migration Notes

Purely additive: one new function, no table, index or data changes, so no backfill and no rollback beyond dropping the function. The function is `create or replace`-safe.

## References

- Related research: `context/changes/timer-stop-and-flags/research.md`
- Template to follow: `supabase/migrations/20260923120000_switch_timer.sql:49-95`
- Route template: `src/pages/api/w/[token]/timer/switch.ts:12-59`
- Test template: `supabase/tests/database/switch_timer.test.sql`
- Requirement: `context/foundation/prd.md:72` (FR-004); roadmap item S-04 at `context/foundation/roadmap.md:123-134`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database function

#### Automated

- [x] 1.1 Migration applies on a fresh local database: `npx supabase db reset`
- [x] 1.2 The pgTAP suite, including the new file, passes: `npx supabase test db`

#### Manual

- [x] 1.3 In the local Supabase SQL editor, `start_timer` then `stop_timer` for one link leaves the entry with `ended_at` set and no open entry

### Phase 2: App logic and stop route

#### Automated

- [ ] 2.1 Unit tests pass, including the new flag and status tests: `npx vitest run`
- [ ] 2.2 Type checking passes: `npx astro check`

#### Manual

- [ ] 2.4 With the dev server running and a timer started, `POST /api/w/<token>/timer/stop` (with an `Origin` header and a form body) answers 303 to `?status=timer-stopped`; repeating it answers 303 to the plain workspace; a `GET` answers 405

### Phase 3: UI and smoke coverage

#### Automated

- [ ] 3.1 Linting passes: `npm run lint`
- [ ] 3.2 Type checking passes: `npx astro check`
- [ ] 3.3 Production build succeeds: `npm run build`
- [ ] 3.4 Smoke passes against a reset local database, including the new stop, restart and flag checks: `npm run smoke:local`

#### Manual

- [ ] 3.5 In a real browser, clicking Stop on a running timer returns to the start screen with the "Timer stopped." banner (proves the form passes Astro's origin check, per the lesson)
- [ ] 3.6 With a local timer whose `started_at` is pushed back 13 hours in SQL, the workspace shows the warning naming 13 hours above the Stop button; Stop closes it; a freshly started timer shows no warning
- [ ] 3.7 Stopping and then starting the same project again works
- [ ] 3.8 The kitchen-sink "tracking" state shows no warning and the new "tracking, flagged" state shows the warning, both readable in light and dark themes
