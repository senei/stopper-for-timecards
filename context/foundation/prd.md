---
project: "Stoper for Timecards"
version: 1
status: draft
created: 2026-09-14
context_type: greenfield
product_type: desktop
target_scale:
  users: small
  qps: n/a
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

Someone working across multiple projects and tasks during the day does not capture time spent as it happens. By the end of the week, they must fill a company timesheet — a grid of Project / Task / Type / Work Type against Mon–Sun columns — and reconstructing which hours went where from memory is slow and error-prone.

Off-the-shelf time trackers don't fail on the tracking itself — they fail because their output doesn't shape to this exact grid (Project/Task/Type/Work Type × daily columns), so the format mismatch pushes people back to manual reconstruction anyway.

## User & Persona

**Primary persona:** an individual contributor who works across several projects/tasks per day and must submit a weekly timesheet in a fixed Project/Task/Type/Work Type × Mon–Sun grid format. They reach for this product continuously through the workday (logging time as they switch tasks) and lean on it hardest at week's end, when the grid is due.

Coworkers doing the same weekly submission are a plausible future audience but are explicitly out of MVP scope — the MVP serves a single user.

## Success Criteria

### Primary
- The daily flow works end-to-end: start tracking on a project, switch between projects during the day with time correctly allocated at 15-minute precision, end the day, and produce an accurate weekly summary table (Project/Task/Type/Work Type × Mon–Sun).

### Secondary
- Autostart / end-of-day detection or notifications (e.g. reminders to start/stop tracking) so hours aren't missed.

### Guardrails
- Time calculation must be accurate to 15-minute precision — miscalculated durations make the weekly table untrustworthy.
- Project association must be correct — time logged against the wrong project defeats the entire purpose of the tool.

## User Stories

### US-01: User starts tracking time on a project at the beginning of the workday

- **Given** the user is starting their workday
- **When** they open the app and pick a project
- **Then** time is assigned to that project starting from that moment

#### Acceptance Criteria
- Picking a project immediately starts the timer for that project; no separate confirmation step
- Elapsed time accrues to the selected project until the user switches or stops

## Functional Requirements

- FR-001: User can add a new project to the list. Priority: must-have
  > Socrates: Counter-argument considered: "adding/renaming projects mid-week could confuse historical entries." Resolution: kept; data is snapshotted per week, so project edits only affect the current and future weeks, never past ones.
- FR-002: User can pick a project, which auto-starts its timer immediately — no separate manual "start" action. Priority: must-have
  > Socrates: Counter-argument considered: "a manual start step can be forgotten, undermining daily capture." Resolution: revised — starting is implicit in picking a project, removing the forgettable step entirely.
- FR-003: User can switch the active timer to a different project during the day (time splits correctly, 15-min precision). Priority: must-have
  > Socrates: Counter-argument considered: "15-minute rounding could discourage logging short (<15 min) switches." Resolution: kept as-is; simplicity wins over granularity for MVP.
- FR-004: User can stop the timer, ending time tracking for the day; a timer running suspiciously long (e.g. past end of day) is flagged for correction rather than silently accruing hours. Priority: must-have
  > Socrates: Counter-argument considered: "forgetting to stop the timer silently corrupts the rest of the day." Resolution: revised — long-running timers are flagged for correction instead of trusted blindly.
- FR-005: User can add corrections to logged time, at end of day or start of the next day. Priority: must-have
  > Socrates: Counter-argument considered: "easy corrections could erode live-tracking discipline, pushing people back to reconstructing entries after the fact." Resolution: kept as-is; corrections are the safety net for missed live tracking, not a replacement for it.
- FR-006: User can view a weekly summary table of time totals, laid out exactly as Project/Task/Type/Work Type × Mon–Sun so it can be directly copied into the company timesheet. Priority: must-have
  > Socrates: Counter-argument considered: "viewing totals on-screen isn't enough if the shape doesn't match the submission format." Resolution: revised — the table's layout is required to mirror the submission grid, not just show totals.

## Non-Functional Requirements

- Starting or stopping a timer is perceived as instantaneous, with no visible lag.
- Time and project data lives only on the user's device; no data leaves the device by any network path.
- Logged time entries are retained for at least 3 months before they may be purged.
- The project definitions list persists indefinitely, independent of the time-entry retention window.

## Business Logic

The app converts raw start/switch/stop events into precise, 15-minute-rounded durations per project and automatically reshapes them into the exact weekly submission grid — so no manual reconstruction or reformatting is ever needed.

The rule consumes the timestamps of when the user picks a project, switches to another, or stops for the day — nothing more is entered manually except optional corrections. Its output is a per-day, per-project duration rounded to the nearest 15 minutes. The user encounters this rule invisibly all week (as durations silently accrue while they work) and visibly at week's end, when those durations land pre-arranged in the Project/Task/Type/Work Type × Mon–Sun grid, ready to submit.

## Access Control

Local profile; data lives on-device, with no account creation or login step of any kind. Flat single-role model — no admin/member distinction. No sign-up/sign-in gating; the app is usable immediately on-device.

## Non-Goals

- No multi-user / coworker support — no accounts, no shared data, no coworker onboarding. Single user only for this MVP.
- No cloud sync / cross-device access — data stays on the one machine it was recorded on; there is no mechanism to move it elsewhere.

## Open Questions

None — all product-level questions were resolved during shaping (`/10x-shape`); no gaps carried forward.
