---
project: "Stopper for Timecards"
context_type: greenfield
created: 2026-09-14
updated: 2026-09-15
product_type: web-app
target_scale:
  users: small
  qps: n/a
  data_volume: small
timeline_budget:
  mvp_weeks: 5
  hard_deadline: null
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "pain category"
      decision: "hours aren't captured daily; end-of-week reconstruction from memory is the real pain"
    - topic: "insight"
      decision: "format mismatch — generic trackers don't export to the Project/Task/Type/Work Type x daily grid"
    - topic: "primary persona scope"
      decision: "revised 2026-09-15 — multi-user; you and coworkers, each with their own private access link"
    - topic: "access model"
      decision: "revised 2026-09-15 — hosted web app, per-person private access link is the identity (no accounts/passwords); self-service link regeneration; flat role, no admin"
    - topic: "hosting ownership"
      decision: "third-party managed service, not self-hosted"
    - topic: "deployment shape"
      decision: "revised 2026-09-15 — replaces the local desktop design entirely with a hosted web app"
    - topic: "coworker onboarding"
      decision: "self-service — a coworker creates their own link on first visit; hard cap of 10 total users; past the cap, a clear full message and no link created"
    - topic: "timeline re-estimate"
      decision: "revised 2026-09-15 (again) — mvp_weeks bumped from 3 to 5, reflecting the real cost of a backend + database + hosting for a hosted multi-user app, surfaced while entering stack selection"
  frs_drafted: 8
  quality_check_status: accepted
---

# Shape Notes

## Seed idea

> calculating time spend on projects, interface for adding new project with data
> associated to it, and some kind of app that lets me assign hours for each
> project, then at end of week get all data in appropriate way to input it to
> time tables

## Vision & Problem Statement

Someone working across multiple projects and tasks during the day does not capture time spent as it happens. By the end of the week, they must fill a company timesheet — a grid of Project / Task / Type / Work Type against Mon–Sun columns — and reconstructing which hours went where from memory is slow and error-prone.

Off-the-shelf time trackers don't fail on the tracking itself — they fail because their output doesn't shape to this exact grid (Project/Task/Type/Work Type × daily columns), so the format mismatch pushes people back to manual reconstruction anyway.

## User & Persona

**Primary persona:** an individual contributor who works across several projects/tasks per day and must submit a weekly timesheet in a fixed Project/Task/Type/Work Type × Mon–Sun grid format. They reach for this product continuously through the workday (logging time as they switch tasks) and lean on it hardest at week's end, when the grid is due.

**Revised 2026-09-15:** coworkers are now explicitly in scope, not a future audience. Each coworker accesses the tool via their own private access link and manages their own time independently — there is no shared or admin view; everyone's experience is symmetric.

## Access Control

**Revised 2026-09-15:** Hosted web app, reachable by anyone holding a valid private access link. Each person's link *is* their identity — no accounts, no passwords, no shared secret. Flat single-role model — no admin/member distinction; anyone with a link can add/manage projects and log their own time, and sees only their own weekly table, never anyone else's. A person can regenerate their own link at any time, which invalidates the old one without affecting anyone else's access.

## Success Criteria

### Primary
- The daily flow works end-to-end: start tracking on a project, switch between projects during the day with time correctly allocated at 15-minute precision, end the day, and produce an accurate weekly summary table (Project/Task/Type/Work Type × Mon–Sun) — for each person independently, via their own private link.

### Secondary
- Autostart / end-of-day detection or notifications (e.g. reminders to start/stop tracking) so hours aren't missed.

### Guardrails
- Time calculation must be accurate to 15-minute precision — miscalculated durations make the weekly table untrustworthy.
- Project association must be correct — time logged against the wrong project defeats the entire purpose of the tool.

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
  > Socrates: Counter-argument considered: "easy corrections could erode live-tracking discipline, pushing people back to end-of-day backfill." Resolution: kept as-is; corrections are the safety net for missed live tracking, not a replacement for it.
- FR-006: User can view a weekly summary table of time totals, laid out exactly as Project/Task/Type/Work Type × Mon–Sun so it can be directly copied into the company timesheet. Priority: must-have
  > Socrates: Counter-argument considered: "viewing totals on-screen isn't enough if the shape doesn't match the submission format." Resolution: revised — the table's layout is required to mirror the submission grid, not just show totals.
- FR-007: A first-time visitor can self-create their own private access link, which identifies them with no account or password needed, up to a maximum of 10 total users; past that cap, a new visitor sees a clear "full" message and no link is created. A person can regenerate their own existing link at any time, invalidating the old one without affecting anyone else's. Priority: must-have
  > Socrates: Counter-argument considered: "a leaked or forwarded link would let someone else log time as that person, with no way to detect it after the fact." Resolution: revised — added self-service link regeneration so a suspected leak can be invalidated by the affected person alone, without an admin and without touching anyone else's link.
  > Socrates: Counter-argument considered: "with no admin and a hard cap, an 11th coworker has no way in even if an earlier person left the team." Resolution: accepted for MVP — a clear "full" message with no removal mechanism; freeing a slot would require an admin role, which contradicts the flat, no-admin decision already locked in.
- FR-008: System automatically purges logged time entries older than 3 months. Priority: must-have

## Business Logic

The app converts raw start/switch/stop events into precise, 15-minute-rounded durations per project and automatically reshapes them into the exact weekly submission grid — so no manual reconstruction or reformatting is ever needed.

The rule consumes the timestamps of when the user picks a project, switches to another, or stops for the day — nothing more is entered manually except optional corrections. Its output is a per-day, per-project duration rounded to the nearest 15 minutes. The user encounters this rule invisibly all week (as durations silently accrue while they work) and visibly at week's end, when those durations land pre-arranged in the Project/Task/Type/Work Type × Mon–Sun grid, ready to submit.

## Non-Functional Requirements

- Starting or stopping a timer is perceived as instantaneous, with no visible lag.
- **Revised 2026-09-15:** Time and project data is hosted by a third-party managed service, not run by the user. Access is restricted to holders of a valid private link — there is no public access, and no coworker can see another coworker's data.
- Logged time entries are retained for at least 3 months before they may be purged.
- The project definitions list persists indefinitely, independent of the time-entry retention window.

## Non-Goals

- **Revised 2026-09-15 — no longer a non-goal:** multi-user/coworker support is now explicitly in scope (see Access Control). ~~No multi-user / coworker support~~
- **Revised 2026-09-15 — no longer a non-goal:** cross-device access is now explicitly in scope (hosted web app). ~~No cloud sync / cross-device access~~
- No admin or manager view — nobody can see another person's hours. If team-level/aggregate reporting is ever needed, that's out of scope for this MVP.

## Timeline acknowledgment

Acknowledged on 2026-09-15: the MVP now covers a hosted, multi-user scope (per-person access links with self-service regeneration) instead of a single-user local desktop app. The user explicitly re-affirmed the original 3-week after-hours estimate despite the larger scope, understanding the timeline is now tighter.

## User Stories

### US-01: User starts tracking time on a project at the beginning of the workday

- **Given** the user is starting their workday
- **When** they open the app and pick a project
- **Then** time is assigned to that project starting from that moment

#### Acceptance Criteria
- Picking a project immediately starts the timer for that project; no separate confirmation step
- Elapsed time accrues to the selected project until the user switches or stops

### US-02: Coworker accesses the app via their own private link

- **Given** a coworker has been given their own private access link
- **When** they open that link
- **Then** they land directly in their own workspace — their own projects, their own timer, their own weekly table — with no login step

#### Acceptance Criteria
- Opening a valid link never shows another person's data
- The person can regenerate their own link from within the app; the old link stops working immediately and no one else's link is affected
