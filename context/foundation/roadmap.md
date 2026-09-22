---
project: "Stopper for Timecards"
version: 1
status: draft
created: 2026-09-21
updated: 2026-09-22
prd_version: 3
main_goal: speed
top_blocker: capacity
milestone_id: core-timecard-flow
milestone_seq: 1
milestone_status: open
---

# Roadmap: Stopper for Timecards

> Derived from `context/foundation/prd.md` (v3) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-01: Core timecard flow** — Status: open

- **Intent:** A person opens their own private link, tracks time across projects during the day at 15-minute precision, and reads off a weekly grid they can copy into the company timesheet.
- **Source materials:** `context/foundation/prd.md` (v3)
- **Done when:** every F-NN and S-NN below is `done`.
- **Scope anchors:** FR-001 – FR-008, US-01, US-02 (all must-have FRs of PRD v3).

## Vision recap

People who work across several projects a day don't capture time as it happens, then reconstruct it from memory to fill a weekly Project/Task/Type/Work Type × Mon–Sun timesheet grid. Off-the-shelf trackers fail because their output doesn't match that exact grid, so people fall back to manual reconstruction. Each person uses their own private access link as their identity (no accounts or passwords), for up to 10 users.

## North star

**S-02: User can add a project and pick it to start the timer inside their own private workspace** — this is the first end-to-end flow (link identity, data, timer logic, UI) and, with `speed` as the goal, everything else only matters if it works.

> "North star" here means the smallest end-to-end slice whose delivery would prove the core product idea works — placed as early as its prerequisites allow. Its only prerequisite, S-01, is placed directly before it.

## At a glance

| ID   | Change ID                | Outcome (user can …)                                                     | Prerequisites | PRD refs                     | Status   |
| ---- | ------------------------ | ------------------------------------------------------------------------ | ------------- | ---------------------------- | -------- |
| S-01 | private-link-access      | create their own private link and open it to land in their own workspace | —             | FR-007, US-02                | done        |
| S-02 | first-timer-start        | add a project and pick it to start the timer instantly                   | S-01          | FR-001, FR-002, US-01, NFR   | in-progress |
| S-03 | timer-switch-rounding    | switch the running timer to another project with 15-min-rounded splits   | S-02          | FR-003                       | proposed |
| S-04 | timer-stop-and-flags     | stop the timer for the day and see long-running timers flagged           | S-02          | FR-004                       | proposed |
| S-05 | time-corrections         | correct logged time at end of day or start of next day                   | S-03, S-04    | FR-005                       | proposed |
| S-06 | weekly-grid-summary      | view a weekly Project/Task/Type/Work Type × Mon–Sun table to copy        | S-03, S-04    | FR-006, FR-001               | proposed |
| S-07 | link-regeneration        | regenerate their own link, invalidating the old one                      | S-01          | FR-007, US-02                | proposed |
| S-08 | time-entry-purge-verified| have entries older than 3 months purged automatically                    | S-02          | FR-008                       | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below.

| Stream | Theme               | Chain                                | Note                                                                      |
| ------ | ------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| A      | Core tracking flow  | `S-01` → `S-02` → `S-03` → `S-06`    | The must-have path to the weekly grid; carries the north star.            |
| B      | Day-end handling    | `S-04` → `S-05`                      | Branches from Stream A at `S-02`; `S-05` also needs `S-03` from Stream A. |
| C      | Link security       | `S-07`                               | Only needs `S-01`; parallel with everything after it.                     |
| D      | Retention           | `S-08`                               | Only needs the real time-entry data from `S-02`; parallel with the rest.  |

## Baseline

What's already in place in the codebase as of `2026-09-21` (auto-researched + user-confirmed).

- **Frontend:** partial — Astro + React starter with stock email/password auth pages; no timer, project, or weekly-grid UI.
- **Backend / API:** partial — only starter `/api/auth/*` routes; no private-link lookup route.
- **Data:** partial — one migration with a placeholder `time_entries` table (its comment says it is not the FR-001–006 model), plus `job_runs` and `access_log`; no link or project tables.
- **Auth:** partial — starter email/password flow present but contradicts the PRD's link identity; `logAccess()` written but not called (`// TODO(FR-007)`).
- **Deploy / infra:** present — live on Cloudflare Workers, CI fixed, Cloudflare Builds deploy (`context/deployment/deploy-plan.md`), FR-008 purge worker written in `workers/purge-job`.
- **Observability:** partial — `job_runs` outcome table covers the purge job; no app-level error tracking.

## Foundations

None. Deploy/infra is already present, and every other technical element (link identity, projects, time-entry model, grid layout) is needed by a specific user-facing slice, so it is introduced in the first slice that uses it rather than as a separate enabler.

## Slices

### S-01: Private link creation and access

- **Outcome:** user can create their own private link (up to 10 total users, clear "full" message after that) and open it to land in their own empty workspace, with no login step.
- **Change ID:** private-link-access
- **PRD refs:** FR-007, US-02
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Retire the starter's email/password pages, or keep them unlinked? — Owner: user. Block: no.
- **Risk:** First because everything else is keyed to a person's link; the PRD's identity model differs from the starter's auth, so this is where the largest rework happens. Also the first call site for the access log.
- **Status:** done

### S-02: First timer start

- **Outcome:** user can add a project and pick it to start its timer instantly, with no separate start step.
- **Change ID:** first-timer-start
- **PRD refs:** FR-001, FR-002, US-01, NFR (start/stop perceived as instantaneous)
- **Prerequisites:** S-01
- **Parallel with:** S-07
- **Blockers:** —
- **Unknowns:** —
- **Data model (resolved 2026-09-22):** adding a project only requires a name. Task, Type and Work Type are editable fields on the project — Task is optional free text (nice-to-have, may be left blank); Type defaults to `"Regular"`; Work Type defaults to `""`. Defaults are expected to cover ~99% of real usage, but both remain user-editable per project, not hardcoded. See Open Roadmap Questions for the full resolution.
- **Risk:** North star; sets the real time-entry data model that replaces the placeholder table, so mistakes here propagate to every later slice.
- **Status:** in-progress

### S-03: Switch timer between projects

- **Outcome:** user can switch the active timer to another project mid-day, with time split between projects at 15-minute precision.
- **Change ID:** timer-switch-rounding
- **PRD refs:** FR-003
- **Prerequisites:** S-02
- **Parallel with:** S-04, S-07, S-08
- **Blockers:** —
- **Unknowns:**
  - Rounding rule for sub-15-minute switches (round each segment, or round per-day totals)? — Owner: user. Block: no.
- **Risk:** Correctness guardrail (15-minute precision, right project) lives here, so it is sequenced right after the first timer.
- **Status:** proposed

### S-04: Stop timer and flag long-running timers

- **Outcome:** user can stop the timer for the day and is prompted to correct a timer that has been running suspiciously long.
- **Change ID:** timer-stop-and-flags
- **PRD refs:** FR-004
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-07, S-08
- **Blockers:** —
- **Unknowns:**
  - What threshold counts as "suspiciously long" / past end of day? — Owner: user. Block: no.
- **Risk:** Protects the rest of the day from silent corruption; touches the same timer logic as S-03, so parallel runs need care.
- **Status:** proposed

### S-05: Correct logged time

- **Outcome:** user can add corrections to logged time at end of day or start of the next day.
- **Change ID:** time-corrections
- **PRD refs:** FR-005
- **Prerequisites:** S-03, S-04
- **Parallel with:** S-06, S-07, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Needs both real switching and stopping to have something meaningful to correct; must not become a substitute for live tracking.
- **Status:** proposed

### S-06: Weekly grid summary

- **Outcome:** user can view a weekly table laid out exactly as Project/Task/Type/Work Type × Mon–Sun, ready to copy into the company timesheet.
- **Change ID:** weekly-grid-summary
- **PRD refs:** FR-006, FR-001 (per-week snapshot of project edits)
- **Prerequisites:** S-03, S-04
- **Parallel with:** S-05, S-07, S-08
- **Blockers:** —
- **Unknowns:**
  - Which time zone defines the Mon–Sun day boundaries? — Owner: user. Block: no.
- **Risk:** This slice is the product's differentiator (output shaped like the company grid). Unblocked 2026-09-22 — see S-02's data model and Open Roadmap Questions for the resolution (Task optional per project, Type fixed to "Regular", Work Type blank).
- **Status:** proposed

### S-07: Regenerate own link

- **Outcome:** user can regenerate their own link from within the app; the old link stops working immediately and no one else's link is affected.
- **Change ID:** link-regeneration
- **PRD refs:** FR-007, US-02
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03, S-04, S-05, S-06, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Only mitigation for a leaked link in a no-account model; has no dependency on timer slices so it can run in parallel whenever capacity allows.
- **Status:** proposed

### S-08: Automatic purge of old time entries

- **Outcome:** user's time entries older than 3 months are purged automatically, while project definitions remain.
- **Change ID:** time-entry-purge-verified
- **PRD refs:** FR-008
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04, S-05, S-06, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The purge worker already exists but targets a placeholder table; this slice re-points it at the real entry model and verifies it end to end in production, including that projects are untouched.
- **Status:** proposed

## Backlog Handoff

GitHub issues created 2026-09-21 in `senei/stopper-for-timecards`.

| Roadmap ID | Change ID | Suggested issue title | Ready for `/10x-plan` | GitHub issue | Notes |
| --- | --- | --- | --- | --- | --- |
| S-01 | private-link-access | Private link creation and access (10-user cap) | yes | [#1](https://github.com/senei/stopper-for-timecards/issues/1) | Run `/10x-plan private-link-access` |
| S-02 | first-timer-start | Add project and start timer on pick | no | [#2](https://github.com/senei/stopper-for-timecards/issues/2) | Needs S-01 |
| S-03 | timer-switch-rounding | Switch timer between projects with 15-min rounding | no | [#3](https://github.com/senei/stopper-for-timecards/issues/3) | Needs S-02 |
| S-04 | timer-stop-and-flags | Stop timer and flag long-running timers | no | [#4](https://github.com/senei/stopper-for-timecards/issues/4) | Needs S-02 |
| S-05 | time-corrections | Correct logged time | no | [#5](https://github.com/senei/stopper-for-timecards/issues/5) | Needs S-03, S-04 |
| S-06 | weekly-grid-summary | Weekly Project/Task/Type/Work Type × Mon–Sun table | no | [#6](https://github.com/senei/stopper-for-timecards/issues/6) | Needs S-03, S-04 |
| S-07 | link-regeneration | Regenerate own private link | no | [#7](https://github.com/senei/stopper-for-timecards/issues/7) | Needs S-01 |
| S-08 | time-entry-purge-verified | Verify automatic purge of entries older than 3 months | no | [#8](https://github.com/senei/stopper-for-timecards/issues/8) | Needs S-02 |

## Open Roadmap Questions

1. **Where do Task, Type and Work Type come from for the weekly grid?** The PRD lists them as grid columns but no requirement captures them. — Owner: user. Block: S-06 (and shapes S-02's project model).
   **RESOLVED 2026-09-22:** adding a project (FR-001) requires only a name. Task, Type and Work Type are editable fields on the project, not hardcoded — Task is optional free text (nice-to-have, may be left blank); Type defaults to `"Regular"`; Work Type defaults to `""` (blank). Defaults are expected to cover ~99% of real usage, but the user can change either per project when needed. This is not a PRD change — FR-001/FR-006 are silent on these fields, so the resolution lives here until/unless a future PRD revision makes it explicit. S-02 and S-06 updated to reflect this; S-06 is unblocked.

## Parked

- **Admin or manager view** — Why parked: PRD §Non-Goals; nobody sees another person's hours.
- **Autostart / end-of-day detection and reminders** — Why parked: PRD Secondary success criterion with no FR; not on the must-have path, and the goal is speed.
- **Freeing a user slot after the 10-user cap is reached** — Why parked: FR-007 Socrates note accepts a "full" message with no removal mechanism for MVP.

## Milestone History

## Done

- **S-01: create their own private link and open it to land in their own workspace** — Archived 2026-09-22 → `context/archive/2026-09-21-private-link-access/`. Lesson: —.
