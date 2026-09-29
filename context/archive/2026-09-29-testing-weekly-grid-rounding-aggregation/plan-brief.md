# Testing weekly grid rounding & aggregation — Plan Brief

> Full plan: `context/changes/testing-weekly-grid-rounding-aggregation/plan.md`
> Research: `context/changes/testing-weekly-grid-rounding-aggregation/research.md`

## What & Why

Protect risk #5 in `test-plan.md` — the weekly grid showing wrong per-day rounded totals or the wrong Mon–Sun boundary — by adding tests whose expected values come from the written rounding rule, not from the code. The grid already exists with 12 unit tests, so this closes the remaining gaps.

## Starting Point

`buildWeeklyGrid` and `earliestNavigableWeekStart` have 12 passing unit tests. Raw minutes are summed as floats, which likely rounds an exact 15-minute total up to 30. The query `fetchWeekEntries` and the week helpers in `grid.astro` have no tests.

## Desired End State

Rounding, day/week splitting, row grouping and the overlap query each have a test that goes red when the matching production line is broken. The float bug is fixed, and `test-plan.md` §6 records the patterns.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Rounding oracle | Always round up, per day per row | It is the resolved roadmap rule that the code and test-plan already follow. | Research / Plan |
| Timezone framing | UTC tests worded as "documents current decision" | The roadmap still lists the timezone as open, so tests must not claim it is proven correct. | Plan |
| Production code | Minimal fix allowed, test-first | The float-sum bug is only worth finding if it is fixed in the same change. | Plan |
| Query test layer | Vitest integration on real `fetchWeekEntries` | pgTAP would test a copy of the predicate, not the code that ships. | Plan |
| `grid.astro` helpers | Left untested, noted as a known gap | Testing them needs a production refactor that is out of scope for a testing change. | Plan |
| Execution mode | Phase 1 `/10x-tdd`, others `/10x-implement` | Only phase 1 has a first red test nameable in one sentence. | Plan |

## Scope

**In scope:** float-sum regression and fix; boundary/edge unit cases; gated integration test and harness; cookbook and status sync; one ad hoc Stryker pass.

**Out of scope:** changing the rounding rule; deciding the timezone; refactoring `grid.astro`; pgTAP for the query; Stryker config or CI gate; e2e and purge-job tests.

## Architecture / Approach

Pure core tests stay in vitest and need no database. A separate vitest config with an `astro:env/server` stub runs the opt-in integration test against the local Supabase stack, and the default `npm test` excludes it.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Float-sum bug (`/10x-tdd`) | Red test, then integer-ms accumulation | Fix must not change output shape |
| 2. Boundary/edge units | G1, G3–G9 cases plus deliberate-break checks | Cases that pass immediately prove nothing without the break check |
| 3. Query integration test | Harness plus `fetchWeekEntries` overlap test | Needs local Supabase; shared-stack lesson applies |
| 4. Cookbook + sync | §3/§4/§6 updates, ad hoc Stryker triage | Chasing 100% mutation score |

**Prerequisites:** local Supabase stack running for Phase 3.
**Estimated effort:** ~2 sessions across 4 phases.

## Open Risks & Assumptions

- PRD `prd.md:98` still says "nearest 15 minutes"; only the roadmap says "up". If "nearest" was intended, expected values change.
- The float bug was shown with plain arithmetic, not yet through `buildWeeklyGrid`; Phase 1 confirms it.
- UTC boundary is undecided at product level; those tests will need a revisit if the timezone changes.

## Success Criteria (Summary)

- `npx vitest run` passes with no database; `npm run test:integration` passes against local Supabase.
- Each new test group turns red when its production line is deliberately broken.
- `test-plan.md` §3 row 2 is `complete` with the cookbook filled in.
