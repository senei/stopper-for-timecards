---
date: 2026-09-29T08:46:00+02:00
researcher: senei web
git_commit: 0e4ed49d6c7d46c424147cf3d510e4078f07adbe
branch: main
repository: stopper-for-timecards
topic: "Oracle and coverage gaps for weekly grid rounding & aggregation (test-plan §3 Phase 2, risk #5)"
tags: [research, testing, weekly-grid, rounding, aggregation, oracle]
status: complete
last_updated: 2026-09-29
last_updated_by: senei web
---

# Research: Weekly grid rounding & aggregation — oracle and coverage gaps

**Date**: 2026-09-29T08:46:00+02:00
**Researcher**: senei web
**Git Commit**: 0e4ed49 (working tree has unrelated uncommitted `.claude/`, `CLAUDE.md` and `test-plan.md` edits)
**Branch**: main
**Repository**: stopper-for-timecards

## Research Question

For risk #5 ("weekly grid shows wrong per-day rounded totals or the wrong Mon–Sun boundary", `context/foundation/test-plan.md` §2): what must a test prove (the oracle, taken from sources, not from the implementation), what is already covered, and what is left uncovered?

## Summary

1. **The grid is already built and partly tested.** S-06 shipped `buildWeeklyGrid` with 7 unit tests (`src/lib/weekly-grid.test.ts`) and `earliestNavigableWeekStart` with 5 (`src/lib/weekly-grid-retention.test.ts`). All 12 pass on this commit (`npx vitest run` on those two files). `test-plan.md` §3 assumed a "still-unbuilt weekly grid", so this phase is **gap-filling**, not oracle-before-code.
2. **The rounding oracle exists in the roadmap, and the PRD wording disagrees with it.** Roadmap S-03 (resolved 2026-09-23): round each project's time *per day*, not per segment, *always up* to the next 15 minutes (`context/foundation/roadmap.md:119`). PRD says "rounded to the nearest 15 minutes" (`prd.md:98`). The test-plan (§2 row #5) and the shipped code follow the roadmap. This research treats the roadmap as the oracle; see Open Questions.
3. **The Mon–Sun boundary is a plan decision, not a PRD fact.** UTC was chosen in the weekly-grid-summary interview (`context/changes/weekly-grid-summary/plan-brief.md`, Key Decisions). Roadmap S-06 still lists the timezone as an open unknown (`roadmap.md:157`). Tests can prove "UTC boundaries as decided", not "the right boundary for the user".
4. **One confirmed latent defect (derivable from the oracle):** `buildWeeklyGrid` accumulates raw minutes as floating point and then applies `Math.ceil`. In a JS reproduction (`node -e`, this session), 45 segments of exactly 20 s (exactly 15 min in total) summed to `15.000000000000009` and would round to **30**, not 15. The scenario is contrived at whole-second granularity, but it is the same "silently overstates hours" class as the risk. Not reproduced through `buildWeeklyGrid` itself, only through the same arithmetic.
5. **Coverage gaps** (table below) are mostly boundary and edge cases. `fetchWeekEntries` and the page-local helpers have no tests.

## Detailed Findings

### Oracle (from sources, not from code)

- Per-day rounding, up, per (Project/Task/Type/Work Type) row: `roadmap.md:119`; restated in `test-plan.md` §2 row #5 and its Risk Response Guidance ("Rounding each segment and summing equals rounding the daily total" must be challenged).
- 15-minute precision as a guardrail: `prd.md:39`, FR-003 at `prd.md:70`.
- Grid shape Project/Task/Type/Work Type × Mon–Sun: FR-006 at `prd.md:76`.
- Row identity is the full snapshot tuple, so later project edits never rewrite past rows: FR-001 snapshot decision (cited at `roadmap.md:152`) and plan-brief Key Decisions ("Row grouping").
- Expected values the roadmap rule implies, usable by tests: 15 min → 15; 15 min 1 s → 30; 0 → 0 (row omitted); 50 min → 60.

### `buildWeeklyGrid` (`src/lib/weekly-grid.ts:39-97`)

- Groups by the JSON-encoded 4-tuple (`:26-28`), splits segments at UTC day bounds (`:44-47`, `:64-70`), sums raw minutes per cell as float (`:69`), rounds each cell once (`:22-24`, `:77-85`), drops all-zero rows (`:86`), sorts by `localeCompare` on `projectName` (`:91`).
- Silently skips entries with non-finite times or `end <= start` (`:60`).
- Open entries (`endedAt === null`) are credited up to `nowUtc` (`:59`).

### Existing tests vs the risk (this inspected file pair only)

- `weekly-grid.test.ts` covers: single-day round-up (50 → 60); midnight split with per-day rounding (20 → 30, 50 → 60); sum-before-round (10 + 5 → 15, not 30); open entry up to `nowUtc`; distinct rows for differing task/type/workType; a row entirely before the week omitted; alphabetical order.
- `weekly-grid-retention.test.ts` covers: mid-week cutoff, exact-Monday cutoff, time-of-day sensitivity, month-end rollover, always-Monday-00:00.
- Expected values in both files are written by hand from the rule, with the arithmetic in comments; the mirror-implementation anti-pattern is not present in these files.

### Gaps (each is a candidate test; expected values come from the oracle above)

| # | Gap | Oracle source | Layer |
|---|---|---|---|
| G1 | Exact multiples stay put (15 min → 15, 60 → 60) and 1 s over rounds up (15:01 → 30) | roadmap:119 | unit |
| G2 | Float accumulation: many fractional-minute segments totalling exactly 15 min must yield 15 (arithmetic suggests 30 today) | roadmap:119 ("up" means only excess rounds up) | unit; likely first red test; fix = sum integer ms |
| G3 | Week-boundary crossing: Sunday 23:50 → next Monday 00:10 credits only the Sunday part (index 6) to this week; entry ending exactly at week start credits nothing | UTC Mon–Sun decision | unit |
| G4 | Segment ending exactly at midnight puts no minutes on the next day | UTC day rule | unit |
| G5 | Segment longer than 24 h (stale timer) spans 3 days, each day rounded on its own portion | roadmap:119 per-day rule | unit |
| G6 | Open entry crossing midnight is split up to `nowUtc`; `nowUtc` before `startedAt` credits nothing | plan-brief "Live/open timer" | unit |
| G7 | `task: null` and `task: ""` are distinct rows; identical tuples merge across non-adjacent segments | FR-001 snapshot rule | unit, `it.each` |
| G8 | Rounding is per (row, day): two rows on the same day do not share or leak rounding | roadmap:119 ("each project's tracked time per day") | unit |
| G9 | Zero-length, negative-length and malformed entries add no minutes | invariant, not a PRD line; low value | unit, optional |
| G10 | `fetchWeekEntries` overlap filter (`src/lib/weekly-grid-query.ts:20-33`: `started_at < weekEnd` and `ended_at is null or ended_at > weekStart`) has no test. The plan named `weekly-grid-query.test.ts` (`weekly-grid-summary/plan.md:262`); the file that exists tests only the retention helper, under a different name. | boundary-spanning entries must appear | integration (real DB); a mock would only echo the filter back |
| G11 | Page-local logic in `src/pages/w/[token]/grid.astro` is untested: `utcMondayOf` (`:41-46`, a copy of the unexported helper at `weekly-grid-retention.ts:8-13`), `parseViewedWeekStart` (`:56-69`), `toWeekParam`, `formatMinutes` (`:112-119`). The duplicated helper can drift. Testing needs an extraction first (a production refactor). | plan-brief navigation rules | unit after extraction; plan decides |

### Layer choice (cost × signal)

- Rounding and aggregation are pure TypeScript, so a vitest unit test is the cheapest layer with full signal. `vitest.config.ts` already includes `src/**/*.test.{ts,tsx}`, so the unit work needs no new runner and no environment phase.
- The `time_entries` overlap query is a real-SQL rule, so it belongs to the integration layer per the `test-plan.md` two-layer table. pgTAP (`supabase/tests/database/`, established in Phase 1) can assert the same predicate on seeded rows, but that tests equivalent SQL, not the PostgREST builder call. The plan decides.
- No hermetic-stub case applies to this path: the grid is a single read with no multi-step write sequence.

## Code References

- `src/lib/weekly-grid.ts:22-24` — round-up helper (`Math.ceil(raw / 15) * 15`)
- `src/lib/weekly-grid.ts:64-70` — float minute accumulation per day (source of G2)
- `src/lib/weekly-grid.test.ts` — 7 existing cases
- `src/lib/weekly-grid-retention.ts:36-45` — earliest navigable week
- `src/lib/weekly-grid-retention.test.ts` — 5 existing cases
- `src/lib/weekly-grid-query.ts:20-33` — overlap query, no tests
- `src/pages/w/[token]/grid.astro:41-119` — page-local week and format helpers
- `supabase/migrations/20260925120000_purge_time_entries.sql:32` — `started_at < now() - interval '3 months'`, the retention rule the helper mirrors
- `context/foundation/roadmap.md:119,157` — rounding rule; open timezone unknown

## Architecture Insights

- Layering is pure core → thin query wrapper → SSR page. The codebase convention is that thin wrappers have no dedicated test (`plan-brief.md`, Architecture). That convention is why G10 and G11 are unprotected.

## Historical Context (from prior changes)

- `context/changes/weekly-grid-summary/plan-brief.md` — UTC boundary, per-day rounding, midnight split, hidden zero rows, alphabetical order. It explicitly leaves "deliberate-break/pgTAP test coverage" to this test-plan phase. Supported.
- `context/changes/testing-timer-guardrails/` (Phase 1, complete) — pgTAP deliberate-break pattern (`test-plan.md` §6). Reusable for G10 if pgTAP is chosen.
- `test-plan.md` §3 row 2 calls the grid "still-unbuilt": contradicted by the shipped S-06 (commits `0bebd4d`, `f22b04a`). The row's goal text needs a sync in the cookbook phase.

## Related Research

- `context/changes/testing-timer-guardrails/research.md` — segment boundary chaining, same oracle family.

## Open Questions

> Update 2026-09-29: questions 1 and 2 were resolved during planning (round up; UTC documented as the current decision) and the PRD Business Logic section (`prd.md:98`) now states both. Question 3 was resolved (minimal fix allowed, done in Phase 1) and question 4 (helpers in `grid.astro`) was left untested.

1. **Rounding wording conflict (user to confirm):** PRD says "nearest 15 minutes" (`prd.md:98`); roadmap and code say always up. This research uses roadmap round-up as the oracle because it is the later, explicit resolution. If "nearest" was intended, the G1/G2 expected values change.
2. **Timezone:** Is UTC acceptable? For a user east of UTC, work after local midnight but before UTC midnight lands on the previous day. Roadmap marks this "Block: no", so tests should record UTC as a documented current decision, in the same "documents current behavior, not correctness" framing used in timer-guardrails Phase 2.
3. **G2 fix ownership:** the G2 red test suits `/10x-tdd` (one-sentence first failing assertion), but the fix changes production code in `weekly-grid.ts`. Confirm that is in scope for a "testing" change.
4. **G11:** extract the page helpers into `src/lib` (production refactor), or leave them untested?
