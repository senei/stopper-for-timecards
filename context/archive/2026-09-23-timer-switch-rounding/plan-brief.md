# Timer Switch Rounding — Plan Brief

> Full plan: `context/changes/timer-switch-rounding/plan.md`

## What & Why

Let a person switch their running timer to a different project mid-day, closing the current segment at the exact switch moment and opening a new one immediately — no separate stop/confirm step. This is roadmap slice S-03 (FR-003), the next link in the north-star chain (`S-01 → S-02 → S-03 → S-06`) and the prerequisite for the weekly-grid summary.

## Starting Point

`start_timer()` is the only function touching `time_entries` today, and it only ever inserts — nothing closes an entry. The workspace page shows either the add/pick form (no timer running) or a static "Currently tracking…" line (timer running), with no way to act while tracking; S-02 deliberately deferred switching to this slice.

## Desired End State

While tracking, the workspace shows a "Switch to a different project" section — a name field plus a button per other project (the current one excluded). Picking one closes the running segment and starts a new one instantly.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Rounding architecture | Round each project's total *per day*, not per segment | Avoids compounding rounding error across several quick switches in one day | Plan |
| Rounding direction | Always round up | No logged time silently disappears from the grid, even a very short switch | Plan |
| Same-project switch | Exclude the current project from the switch list entirely | Makes the case structurally impossible rather than needing special-case handling; the backend stays general-purpose | Plan |
| Rounding *implementation* scope | Recorded now, built in S-06 | The "day" in "per-day total" depends on the Mon–Sun timezone question, still open and owned by S-06 — building against a guess risks rework | Plan |

## Scope

**In scope:**
- `switch_timer()` Postgres function (shares `start_timer`'s advisory lock key, generalized in the same migration)
- `switchTimer()`/`NoActiveTimerError` in `src/lib/timer.ts`, plus `CurrentTimer` gaining `projectId`
- `src/pages/api/w/[token]/timer/switch.ts`
- Workspace UI: switch form + other-projects list while tracking
- pgTAP + smoke coverage
- Recording the rounding rule in `roadmap.md` and `test-plan.md`

**Out of scope:**
- The actual rounding/aggregation computation (S-06, blocked on the day-boundary decision)
- Stopping the timer or flagging long-running ones (S-04)
- Any elapsed-time or "switched!" display — no reporting UI exists yet

## Architecture / Approach

`switch_timer` mirrors `start_timer`'s exact shape (`security definer`, advisory-locked, find-or-create) but closes the currently-open entry first, then runs the same insert logic. Both functions now share one lock key per link, so they can never race each other. No same-project special-casing exists anywhere — the UI's exclusion is the only place that case is prevented, and a direct API call naming the same project is harmless by design (two consecutive segments, summed correctly under per-day-total rounding).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data layer | `switch_timer`, shared lock key, pgTAP, rounding rule recorded in docs | Redefining `start_timer`'s lock key without breaking its existing behavior/tests |
| 2. API route | `timer/switch.ts` | Getting the `NoActiveTimerError` race-backstop redirect right (unchanged, no error shown) |
| 3. UI & smoke | Switch form + other-projects list, smoke coverage | Correctly excluding the current project from the list by id, not name |

**Prerequisites:** S-02 (first-timer-start), already shipped and archived.
**Estimated effort:** ~1-2 sessions across 3 phases — one new Postgres function plus a UI addition, following S-02's proven pattern closely.

## Open Risks & Assumptions

- R-03 (time calculation precision) stays only partially closed after this slice — the rule is decided and recorded, but not implemented, until S-06 resolves the day-boundary question.
- `start_timer`'s lock-key redefinition is a same-migration, behavior-preserving change with no external dependents, but it does touch previously-shipped S-02 code, not just net-new files.

## Success Criteria (Summary)

- A person can switch their running timer to another project with one click, no confirmation step
- The previous segment always closes exactly when the new one opens — never two open entries, never a gap
- Switching to a project used earlier reuses it; switching to a new name creates it, same as starting
