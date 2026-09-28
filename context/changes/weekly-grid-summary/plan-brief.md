# Weekly Grid Summary (S-06) — Plan Brief

> Full plan: `context/changes/weekly-grid-summary/plan.md`

## What & Why

Build the weekly grid summary page (roadmap S-06, PRD FR-006) — a
navigable, read-only view laid out exactly as Project/Task/Type/Work Type
× Mon–Sun, with 15-minute-rounded daily totals, ready to copy into the
company timesheet. This is the product's own named differentiator and the
payoff of the "Core tracking flow" roadmap stream.

## Starting Point

`time_entries` already carries every column the grid needs
(`project_name`, `task`, `type`, `work_type`, `started_at`, `ended_at`),
snapshotted at entry-creation time — no schema changes needed. But no
aggregation, rounding, or date-bucketing logic exists anywhere yet, and
there's no table/grid UI component or precedent in the codebase. The
Mon–Sun timezone question S-03 explicitly deferred here is resolved by
this plan (UTC).

## Desired End State

A person opens a link from their workspace to `/w/[token]/grid`, sees the
current week's time laid out as Project/Task/Type/Work Type rows × Mon–Sun
columns with correct 15-minute-rounded totals (including their
currently-running timer), can navigate back through any past week that's
still fully within the 3-month retention window, and reads the table
directly to copy into their company timesheet.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Day-boundary timezone | UTC | Matches the server's existing storage/timestamp convention with zero added conversion logic; no signal anywhere favored a different zone | Plan (interview) |
| Week scope | Navigable to any past week (within retention) | Matches the real scenario of missing a submission deadline and needing to go back | Plan (interview) |
| Row grouping | Full (Project, Task, Type, Work Type) tuple | Zero information loss; matches FR-001's guarantee that project edits never retroactively change past entries | Plan (interview) |
| Copy interaction | On-screen table only | Simplest; no clipboard script to write/verify | Plan (interview) |
| Live/open timer | Included, live-updating | The grid is most often viewed mid-workday; excluding the running segment would look wrong | Plan (interview) |
| Midnight-spanning entries | Split across both days | Genuinely accurate attribution, same correctness class this project already treats as high-risk | Plan (interview) |
| Empty rows | Omitted (zero-time rows hidden) | Projects persist indefinitely; showing every ever-created project would grow unbounded | Plan (interview) |
| Row order | Alphabetical by project name | Predictable, stable week-over-week, matches existing `listProjects` convention | Plan (interview) |
| Page location | New dedicated route | Grid is a distinct "review at week's end" mode, separate from continuous daily timer use | Plan (interview) |
| Purge-window handling | Restrict navigation to whole weeks fully within 3 months | Corrected mid-interview: prevents any partially-purged week from ever being reachable, so no incomplete-data banner is needed at all | Plan (interview, corrected) |

## Scope

**In scope:**
- Pure, unit-tested aggregation/rounding/midnight-split logic
- Supabase data-access layer for a given UTC week + retention-window boundary
- New `/w/[token]/grid` page with week navigation and empty-week state
- Link from the main workspace page; kitchen-sink visual-QA registration

**Out of scope:**
- Copy-to-clipboard button, per-viewer timezone, incomplete-data banner
- Any new npm date/timezone dependency
- S-05 (time-corrections) — separate roadmap slice
- Deliberate-break/pgTAP test coverage — separate `test-plan.md` §3 Phase 2 work
- Schema/migration changes

## Architecture / Approach

Layered: a pure TypeScript aggregation module (testable in isolation) →
a thin Supabase query module (matching the codebase's existing
wrapper-with-no-dedicated-test convention) → a new SSR Astro page (reusing
the existing tokenized-route auth pattern, no new API/JSON route since
this is read-only) → wiring + visual QA.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Aggregation & rounding core logic | Pure, unit-tested `buildWeeklyGrid` function | Rounding-order bug (per-segment vs per-cell) silently overstates hours |
| 2. Weekly-grid data access | `fetchWeekEntries` + retention-window boundary helper | Entry-overlap query missing a boundary-spanning entry |
| 3. Grid page, route, and UI | `/w/[token]/grid` page with navigation | UTC-vs-local date bugs if local `Date` getters slip in anywhere |
| 4. Wiring, kitchen-sink, visual QA | Workspace link + registered QA states | None significant — mechanical wiring |

**Prerequisites:** S-03, S-04 (both done); local Supabase stack running for manual verification.
**Estimated effort:** ~1-2 sessions across 4 phases.

## Open Risks & Assumptions

- Assumes Postgres session timezone stays UTC with no future config override — if that changes, the UTC-boundary assumption throughout this plan would need revisiting.
- The empty-week/omitted-rows design means a user who worked zero hours on a project won't see an explicit "0:00" confirmation line — flagged during the interview as an accepted tradeoff, not re-litigated here.

## Success Criteria (Summary)

- `npx vitest run src/lib/weekly-grid.test.ts` and `weekly-grid-query.test.ts` pass
- Loading the grid page for seeded multi-week data renders correct rows/totals, correct midnight-split attribution, correct mid-week-edit row grouping, and correctly restricts navigation to the retention window
- Verified in both light and dark theme
