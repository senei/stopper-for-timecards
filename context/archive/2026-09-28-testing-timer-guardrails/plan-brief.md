# Timer Precision & Attribution Regression Guard — Plan Brief

> Full plan: `context/changes/testing-timer-guardrails/plan.md`
> Research: `context/changes/testing-timer-guardrails/research.md`

## What & Why

Test-plan §3 Phase 1 hardens the two highest-ranked risks — wrong project
attribution (#1) and a timer switch/stop silently dropping or
double-counting a segment (#2) — by adding **deliberate-break** tests: tests
that prove the DB-level unique-index guardrails, not just the application
pre-checks that already have coverage, are what actually catch a violation.

## Starting Point

Project resolution and timer transitions live entirely in three
`security definer` Postgres functions (`start_timer`, `switch_timer`,
`stop_timer`), each called via one RPC round-trip — atomic by construction.
Existing pgTAP tests already cover the happy path and the app-level `P0001`
rejection path for each function. What's missing: proof the unique indexes
themselves are the backstop, a chained-segment boundary check, and an
explicit assertion of the "reuse keeps first-seen casing" behavior.

## Desired End State

A new `supabase/tests/database/timer_guardrails.test.sql` runs under the
existing `npx supabase test db` / CI `smoke` job with no config changes, and
proves five things: no-gap/no-overlap segment chaining, the open-row index
is the real backstop (not just switch/stop's pre-check), the project
uniqueness index is the real backstop (not just start/switch's lookup),
casing canonicalization on reuse, and one non-ASCII case-fold snapshot.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Index-backstop proof method | Direct-insert bypass, not constraint-drop mutation | Mirrors the existing proven pattern for `start_timer` (`projects_and_timer.test.sql:61-66`); no precedent in this codebase for disabling a constraint inside a test | Plan (interview) |
| Duration/boundary test | Boundary-chaining (exact timestamp equality), not wall-clock summation | `now()` is transaction-scoped in Postgres — every call inside one pgTAP file's `begin;…rollback;` returns the same value, so real elapsed-time summation isn't meaningfully testable here | Plan (technical finding during research) |
| Unicode/case-folding scope | Snapshot one non-ASCII case now | Closes the exact gap the migration's own comment names, at near-zero cost | Plan (interview) |
| Concurrency/race testing | Deferred, documented as accepted | pgTAP's one-transaction-per-file model isn't built for it; low cost×signal for this link-scoped app | Plan (interview) |
| Casing-canonicalization contract | Assert "first-seen casing wins" explicitly | Closes an ambiguity research found unasserted anywhere as intended or a bug | Plan (interview) |
| Test file organization | New dedicated file (`timer_guardrails.test.sql`) | Boundary-chaining spans start+switch+stop — no single existing per-function file is its natural home | Plan (interview) |

## Scope

**In scope:**
- Segment-boundary chaining test (start→switch→switch→stop)
- Direct-insert bypass tests for both unique indexes (`time_entries` open-row, `projects` case-insensitive name)
- Casing-canonicalization contract test
- One non-ASCII case-fold snapshot test
- Cookbook (`test-plan.md` §6.2) and rollout-status (§3) sync

**Out of scope:**
- Any change to `start_timer`, `switch_timer`, `stop_timer`, or application code — test-only phase
- True concurrent-request/race testing
- Real elapsed-wall-clock-time duration summation (belongs to §3 Phase 3's grid-aggregation work)
- A full case/whitespace test matrix (existing ASCII variant + one new non-ASCII variant only)
- Constraint-drop mutation testing

## Architecture / Approach

One new pgTAP file following this directory's established boilerplate
(`begin;`/`plan(N)`/`finish();`/`rollback;`, self-contained fixtures with a
fresh UUID block). Index-backstop cases bypass the RPC layer with a direct
`insert` to isolate the constraint being proven; the boundary-chaining and
canonicalization cases use the real RPC calls since they need the functions'
actual behavior, not a bypass.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Segment-boundary chaining & index-backstop tests | Boundary-chaining case + both direct-insert-bypass index tests | Getting the bypass insert's required columns right for `time_entries`/`projects` |
| 2. Casing-canonicalization contract & Unicode snapshot | Two more cases in the same file; finalizes `plan(N)` | Framing the Unicode case as "documents current behavior," not a correctness guarantee |
| 3. Cookbook & rollout-status sync | `test-plan.md` §6.2 note + §3 row flipped to `complete` | None — mechanical doc update |

**Prerequisites:** Local Supabase stack running (Docker), `npx supabase db reset` clean.
**Estimated effort:** ~1 session across 3 phases — one new test file, no application code changes.

## Open Risks & Assumptions

- Assumes `now()`'s transaction-scoping in Postgres (verified against the existing suite's own `ended_at >= started_at` weak-inequality assertion at `stop_timer.test.sql:36-40`, consistent with all timestamps in a file being equal) — if this assumption is wrong, Phase 1's boundary-chaining assertions would need to switch from exact equality to a tolerance check.
- Assumes `dblink`/`pg_background` availability was not confirmed for this Supabase stack — if a future phase needs true concurrency testing, that availability must be checked first.

## Success Criteria (Summary)

- `npx supabase db reset && npx supabase test db` passes locally and in CI with the new file included, no config changes needed
- A regression in switch/stop's close-then-open ordering, or in either unique index, would now be caught by a test that isolates that specific guardrail
- `test-plan.md` §3 Phase 1 row reads `complete` and §6.2 documents the deliberate-break pattern for future phases
