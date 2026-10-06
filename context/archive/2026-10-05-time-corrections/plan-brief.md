# Correct logged time at end of day or start of next day — Plan Brief

> Full plan: `context/changes/time-corrections/plan.md`
> Research: `context/changes/time-corrections/research.md`

## What & Why

S-05 (FR-005) gives a person a safety net for time tracked wrongly: on a new Corrections page they can change the start or end of a closed entry from today or yesterday, or delete it. Today nothing can be edited or deleted and no screen shows individual entries, so a forgotten timer or a late switch can only be lived with. A correction edits raw timestamps through one locked database function that refuses anything that would leave bad data; the weekly grid's read-time 15-minute round-up then stays correct with no change.

**Staying distinct from live tracking:** only today and yesterday (UTC), only closed entries, nothing can be added from scratch, and the page sits beside the weekly grid, not on the timer. **Rounding:** corrections never touch it; they change raw `started_at`/`ended_at`, and the grid still sums raw time per project and UTC day and rounds up once.

## Starting Point

`time_entries` has no edit or delete path (only the timer functions write `ended_at`, at `now()`; only the purge and delete-account delete rows) and no constraint on order or overlap. The grid selects no entry ids. The established patterns to copy are the `stop_timer` function (security definer, `public.timer:` advisory lock, `P0001`), the project-delete route and confirm page, the grid page's headers and 503 view, and the table-driven route tests.

## Desired End State

A Corrections page (linked from the workspace card, and from the 12-hour warning) lists the person's entries from today and yesterday by UTC day. Each closed entry has a form to change its UTC start and end, saved directly with a banner, and a delete link to a confirm page; the running entry is read-only. Every outcome writes one log line with the link and entry ids and never the token. A person can never touch another person's entry, and no correction can create an overlap, an empty or negative range, an end in the future, or a start before yesterday's UTC midnight.

## Key Decisions Made

| Decision               | Choice                                                                                  | Why (1 sentence)                                                                                            | Source                 |
| ---------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------- |
| Operations             | Edit start/end and delete closed entries; no add, no project change, running untouched  | Smallest surface and the closest fit to a safety net; a forgotten timer is stopped, then shortened.         | Research / Plan (user) |
| Edit window            | Today and yesterday (UTC)                                                               | Matches the PRD wording and keeps corrections distinct from reconstruction; keeps edits far from the purge. | Research / Plan (user) |
| Time zone              | UTC, labelled in the form                                                               | One clock end to end (grid, purge, window), no conversion code.                                             | Research / Plan (user) |
| Neighbours             | Refuse overlaps (including the running entry), allow gaps                               | Keeps the grid honest with one locked function and no cascading edits.                                      | Research / Plan (user) |
| Confirmation           | Edit saves directly; delete uses a confirm page                                         | Delete is the only irreversible action; a bad edit can be edited back inside the window.                    | Research / Plan (user) |
| Marker                 | None (no `corrected_at`); each correction is logged                                     | No schema change to a live table; the log still shows how often people correct.                             | Research / Plan (user) |
| Surface                | New `/w/[token]/corrections` page linked from the workspace card                        | Keeps the card focused on live tracking and follows the grid page's pattern.                                | Research / Plan (user) |
| Where validation lives | A `security definer` function under the `public.timer:` lock, refusals as `P0001` codes | The database has no constraints; one atomic function serializes with start, switch and stop.                | Research / Plan        |
| Log context            | Add optional `entryId` to `LogContext`                                                  | Lets a correction event name its entry without abusing `op` or `detail`.                                    | Plan                   |

## Scope

**In scope:** one migration with two functions and pgTAP; `src/lib/time-entries.ts` and `utc-datetime.ts`; two POST routes; the Corrections page and delete confirm page; links on the workspace card; banner codes; unit, route, integration and e2e tests.

**Out of scope:** adding entries, changing an entry's project, correcting the running timer, a `corrected_at` column, local-time input, a wider window, any change to the grid, rounding, purge, project delete or the timer functions, and a new `access_log` outcome.

## Architecture / Approach

Bottom up, one proven layer at a time: database functions (pgTAP), then the TypeScript wrappers and typed errors, then the routes, then the pages, then e2e and the lane's final checks. The routes pass only the looked-up `link.id` to the functions, never an id from the URL, and map the function's refusal codes to banner codes. The migration must be applied to the database before the app code is deployed.

## Phases at a Glance

| Phase                           | What it delivers                                                                         | Key risk                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1. Database functions and pgTAP | `correct_time_entry` and `delete_time_entry` with every refusal proven                   | Validation order and the overlap rule must be exactly right              |
| 2. Data layer                   | Window helper, list query, wrappers, typed errors, `entryId` log field, integration test | Link scoping on every read and write; grid rounds a corrected entry once |
| 3. Routes                       | Edit and delete POST routes, banner codes, UTC parser, route tests                       | Never trusting an id from the URL; no token in any log line              |
| 4. Pages and links              | Corrections page, delete confirm page, card links, real-browser check                    | New forms need a real browser (Origin); wording needs your approval      |
| 5. e2e and final checks         | Playwright spec plus lint, astro check, build, pgTAP and smoke                           | Needs a local stack slot; smoke takes minutes                            |

**Prerequisites:** a local Supabase stack in its own slot (this machine's default config cannot start; see `lessons.md` and `parallel-goals.md`); the migration applied before deploy.
**Estimated effort:** about 4–6 sessions across 5 phases; phase 1 and phase 4 need the most care.

## Open Risks & Assumptions

- Deleting the last entry of a project makes it deletable (FR-009), which changes a past week's grid; accepted as consistent with FR-009.
- A UTC time field can be mistyped by the local offset; mitigated by the label, not by conversion.
- The window start is computed in both the database (authority) and TypeScript (for the list); a request made right at UTC midnight could see them differ by one day, in which case the database refuses.
- The banner and page wording is user-facing copy, confirmed by a human in phase 4.
- Smoke and pgTAP need Docker; if unavailable, the lane's "done when" cannot be fully shown.

## Success Criteria (Summary)

- A person can fix a wrong start or end, or delete a closed entry, from today or yesterday, and the weekly grid shows the corrected, once-rounded total.
- No correction can create an overlap, a bad range or a future end, and nobody can touch another person's entry.
- Every outcome is visible in the logs with the link and entry ids, and never the token.
