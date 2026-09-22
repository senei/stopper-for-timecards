# First Timer Start — Plan Brief

> Full plan: `context/changes/first-timer-start/plan.md`
> Test plan: `context/foundation/test-plan.md`

## What & Why

A person opens their private workspace, types (or picks) a project name, and its timer starts instantly — no separate confirmation step. This is roadmap slice S-02, the "north star" of the whole product: the first end-to-end proof that link identity, real time-entry data, and the timer actually work together.

## Starting Point

`/w/[token].astro` already verifies the link and shows the workspace shell, but its body is a static "No projects yet." `time_entries` is an explicit placeholder table (no FK, free-text `project` column) that a prior review deliberately left unconstrained, pending this slice's rework. There is no `projects` table yet.

## Desired End State

Opening the workspace with no timer running shows a name field plus a list of previously used projects; submitting either starts that project's timer immediately and the page now shows "Currently tracking `<project>` — started at `HH:MM`." That state persists across reloads and devices (it's link-scoped, not cookie-scoped) until a timer is stopped — a later slice.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Project fields at creation | Name only; `task`/`type`/`work_type` get their resolved defaults silently | Keeps this slice a true one-step "start," matching FR-002's no-confirmation requirement; editing UI is a future slice | Plan (user-confirmed) |
| Page state while a timer runs | Read-only "Currently tracking…"; pick-UI hidden until switch (S-03) or stop (S-04) exist | This slice only owns starting the first timer of the day, not a second one | Plan (user-confirmed) |
| Elapsed-time display | Static "started at HH:MM," no live-ticking counter | Zero added frontend complexity; NFR only requires feeling instantaneous | Plan (user-confirmed) |
| Repeated project name | Case-insensitive match reuses the existing project (no duplicate, no error) | Matches how projects are actually used — the same code typed daily | Plan |
| Task/Type/Work Type snapshotting | Denormalized onto each `time_entries` row at creation | Satisfies the PRD's requirement that project edits never change past weeks, without extra machinery later | Plan |
| One running timer per link | Database-level partial unique index, not just UI logic | Same belt-and-suspenders style as the existing link cap; safe under races/double-submits | Plan |
| Test coverage | Two named risks (R-01 wrong project, R-02 concurrent timers) each get a pgTAP assertion *and* a black-box smoke-script assertion | DB tests prove the invariant exists; smoke tests prove a real HTTP request actually hits it, from the user's perspective | Plan |

## Scope

**In scope:** `projects` table, reworked `time_entries` schema, atomic `start_timer` DB function, `/api/w/[token]/timer/start` route, workspace UI (add/pick form + tracking state), pgTAP + smoke coverage.

**Out of scope:** switching (S-03), stopping/flagging (S-04), corrections (S-05), the weekly grid (S-06), editing a project's task/type/work_type after creation, a live-ticking timer display, link regeneration (S-07), purge rework (S-08).

## Architecture / Approach

One Postgres function, `start_timer(link_id, name)`, handles both "new name" and "pick existing" in one advisory-locked transaction: find-or-create the project, then insert a `time_entries` row with the project's name/task/type/work_type copied onto it. A partial unique index (`ended_at is null`, one per link) makes "one running timer" a database guarantee. The workspace page checks for an open entry first to decide which UI state to render; the API route re-derives the link from the URL token, never the cookie, keeping the existing token-is-identity model consistent.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data model & atomic start function | `projects` table, reworked `time_entries`, `start_timer` function, pgTAP | Getting the atomicity (advisory lock + partial unique index) right, same as the existing link cap |
| 2. API route & lib helpers | `timer.ts`, `projects.ts`, `/api/w/[token]/timer/start` | Re-deriving the link from the token rather than trusting the cookie |
| 3. Workspace UI & smoke test | Add/pick form, tracking state, extended smoke script | No-JS form correctness (one submit button per project) |

**Prerequisites:** S-01 (private-link-access) — done. Local Supabase (`supabase start`) for migrations and pgTAP.
**Estimated effort:** 3 phases, one `/10x-implement` run each.

## Open Risks & Assumptions

- `time_entries` has no production rows yet, so this plan alters the table in place rather than migrating data — confirmed safe by the table's own "placeholder, not final model" comment and the fact that no shipped code writes to it.
- Task/Type/Work Type editing has no assigned roadmap slice yet; defaults (`"Regular"` / `""`) are expected to cover ~99% of real usage per the roadmap's own resolution, but a future slice will need to add that editing UI eventually.

## Success Criteria (Summary)

- Picking or typing a project name starts its timer with no separate confirmation step (FR-002, US-01).
- The tracking state is consistent across reloads and devices, proving it's driven by the database, not browser state.
- Retyping an already-used project name never creates a duplicate project.
- `test-plan.md`'s R-01 (wrong project) and R-02 (concurrent timers) risks each have a passing database test and a passing black-box HTTP test.
