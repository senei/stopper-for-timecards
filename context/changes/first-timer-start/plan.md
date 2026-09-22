# First Timer Start Implementation Plan

## Overview

Replace the placeholder `time_entries` table with the real data model for this feature and turn the empty "No projects yet." workspace page into a working flow: a person adds a project (by typing its name, or picking one they've used before) and its timer starts immediately, with no separate confirmation step. This is roadmap slice **S-02** (FR-001, FR-002, US-01).

## Current State Analysis

- `src/pages/w/[token].astro` already verifies the token, looks up the link, and renders the workspace shell — but the body is a static "No projects yet." with no project or timer UI (`src/pages/w/[token].astro:61`).
- `time_entries` (added in `supabase/migrations/20260918082739_phase_b_c_purge_and_access_log.sql:9-16`) is an explicit placeholder: `link_id uuid not null` with no FK, and a free-text `project` column. Its own comment says it is "not the final FR-001-006 model."
- The prior implementation review (`context/archive/2026-09-21-private-link-access/reviews/impl-review.md`, finding F1) deliberately left `time_entries.link_id` unconstrained, "pending rework by a later roadmap slice (S-02)" — this plan is that rework.
- There is no `projects` table yet. The roadmap's resolved data model (`context/foundation/roadmap.md`, S-02 entry) says a project needs only a `name`; `task` (optional free text), `type` (default `"Regular"`), and `work_type` (default `""`) are editable per-project fields, expected to cover ~99% of real usage.
- `supabase/tests/database/private_links.test.sql:38` inserts a row into `time_entries` using the current placeholder shape (`link_id, project, started_at`) — this will need to track the new schema.
- Identity model: the URL token is authoritative, re-checked against the database on every request (`findLinkByToken` in `src/lib/links.ts:35`); the `stopper_link` browser cookie is only a convenience "remember my link" affordance, never a source of authorization (`src/lib/link-cookie.ts:5`).

### Key Discoveries:

- Atomic invariants in this codebase are enforced in the database, not the application: `create_link` (`supabase/migrations/20260921120000_private_links.sql:16-34`) uses `pg_advisory_xact_lock` plus a `security definer` function to make its 10-person cap race-safe. The "one running timer per link" invariant this plan needs follows the same shape.
- Every table gets `alter table ... enable row level security;` with **no policies** — the service-role client is the only reader/writer (`supabase/migrations/20260921120000_private_links.sql:44-47`). `projects` follows the same pattern.
- `src/lib/links.ts` is the reference shape for a DB-access module: a thin wrapper returning typed results, throwing on unexpected DB shapes, with `adminOrThrow()` for the service-role client.
- `src/pages/api/links.ts` is the reference shape for a form-posting API route: plain `FormData`, redirect-based responses, no client-side JS.
- Pure, DB-free logic gets a co-located `*.test.ts` (`link-token.test.ts`, `creation-closed.test.ts`); DB-touching logic is verified through pgTAP (`supabase/tests/database/*.test.sql`) and the smoke script (`scripts/smoke.mjs`) instead — `links.ts` itself has no unit test file.

## Desired End State

A person opens their workspace (`/w/<token>`). If no timer is running today, they see a text field to name a project plus a list of projects they've used before; typing a new name or clicking an existing project starts that project's timer immediately and the page now shows a static "Currently tracking `<project>` — started at `HH:MM`" state. Reloading the page, or opening the link from another device, shows the same tracking state — the pick-a-project UI only reappears once a timer has been stopped (a later slice, S-04). Retyping the name of a project already used today or earlier reuses that same project rather than creating a duplicate.

**Verification:** `npm run test`, `npm run lint`, `npx astro check`, `npx supabase test db`, and `npm run smoke` all pass; manually confirmed via the steps in each phase below.

## What We're NOT Doing

- Switching the running timer to another project (S-03) — the pick-a-project UI is simply hidden while a timer runs.
- Stopping the timer, or flagging a suspiciously long-running one (S-04).
- Corrections to logged time (S-05).
- The weekly Project/Task/Type/Work Type × Mon–Sun grid (S-06).
- Editing a project's `task`, `type`, or `work_type` after creation — these are stored with their resolved defaults and are schema-ready for a future editing UI, but no such UI ships in this slice.
- A live-updating (ticking) elapsed-time display — the tracking state is a static timestamp.
- Link regeneration (S-07) and the purge worker rework (S-08) — untouched by this plan.

## Implementation Approach

One new Postgres function, `start_timer(link_id, project_name)`, is the single entry point for both "type a new project name" and "pick an existing one": it finds a case-insensitive name match for that link, creates the project if none exists, then inserts a new `time_entries` row — all inside one advisory-locked transaction, so a concurrent double-submit can't create two projects with the same name or two running timers for the same link. The `time_entries` row denormalizes the project's `name`, `task`, `type`, and `work_type` at the moment it's created, which is what lets a later project edit (whenever that ships) leave past entries untouched, per the PRD's FR-001 Socrates resolution ("project edits only affect the current and future weeks, never past ones") — without that, a future weekly-grid slice would have no way to reconstruct what a project's fields were on a given day.

A partial unique index (`time_entries` rows where `ended_at is null`, one per `link_id`) makes "only one running timer per link" a database-level guarantee, not just a UI convention — the same belt-and-suspenders style as the existing cap and RLS.

The workspace page decides what to render by checking for an open `time_entries` row first: present, it renders the static tracking state (reading `project_name`/`started_at` straight off that row — no join needed, thanks to denormalization); absent, it renders the add/pick form. The new `/api/w/[token]/timer/start` route re-derives the link the same way `/w/[token].astro` already does (hash the token, look it up), rather than trusting the `stopper_link` cookie, keeping the token-is-identity model consistent everywhere it's checked.

## Phase 1: Data model & atomic start function

### Overview

Add the `projects` table, rework `time_entries` into its real shape, and add the `start_timer` function that does both jobs (find-or-create the project, start its timer) atomically.

### Changes Required:

#### 1. New migration

**File**: `supabase/migrations/20260922150000_projects_and_timer.sql`

**Intent**: Create `projects`; replace `time_entries`'s placeholder `project` text column with a real project reference plus a denormalized snapshot of the project's fields at entry-creation time; enforce one running timer per link; add the `start_timer` function.

**Contract**:
- `projects(id uuid pk, link_id uuid not null references links(id), name text not null, task text, type text not null default 'Regular', work_type text not null default '', created_at timestamptz not null default now())`, RLS enabled, no policies.
- Unique index on `projects (link_id, lower(name))` — case-insensitive per-person uniqueness, which is what makes retyping an existing project's name reuse it instead of duplicating it.
- `time_entries`: drop `project`; add `project_id uuid not null references projects(id)`, `project_name text not null`, `task text`, `type text not null default 'Regular'`, `work_type text not null default ''`; add the FK `time_entries.link_id references links(id)` that F1 deliberately deferred to this slice; add index on `project_id`.
- Unique partial index `time_entries (link_id) where ended_at is null` — at most one open entry per link.
- `start_timer(p_link_id uuid, p_project_name text)` — `security definer`, advisory-locked per `link_id`, `revoke ... from public, anon, authenticated; grant ... to service_role` (same grant shape as `create_link`). Non-obvious enough to spell out:

```sql
create or replace function start_timer(p_link_id uuid, p_project_name text)
returns table (entry_id uuid, project_id uuid, project_name text, started_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_name text;
  v_task text;
  v_type text;
  v_work_type text;
begin
  perform pg_advisory_xact_lock(hashtext('public.start_timer:' || p_link_id::text));

  select id, name, task, type, work_type
    into v_project_id, v_name, v_task, v_type, v_work_type
    from public.projects
    where link_id = p_link_id and lower(name) = lower(trim(p_project_name));

  if v_project_id is null then
    insert into public.projects (link_id, name)
    values (p_link_id, trim(p_project_name))
    returning id, name, task, type, work_type
      into v_project_id, v_name, v_task, v_type, v_work_type;
  end if;

  return query
    insert into public.time_entries (link_id, project_id, project_name, task, type, work_type, started_at)
    values (p_link_id, v_project_id, v_name, v_task, v_type, v_work_type, now())
    returning id, project_id, project_name, started_at;
end;
$$;
```

#### 2. Existing pgTAP test needs updating for the new `time_entries` shape

**File**: `supabase/tests/database/private_links.test.sql`

**Intent**: Its RLS/FK setup rows (line 38) insert directly into `time_entries` using the old `project` text column; update that insert to the new columns so the suite still applies cleanly after this migration.

**Contract**: Insert must supply a `projects` row for the link first, then reference it via `project_id`/`project_name` instead of `project`.

#### 3. New pgTAP test suite

**File**: `supabase/tests/database/projects_and_timer.test.sql`

**Intent**: Prove the invariants this slice depends on, in the same style as `private_links.test.sql`.

**Contract**: Cover — `start_timer` with a new name creates one `projects` row and one open `time_entries` row; calling it again with a differently-cased/whitespace-padded version of the same name reuses the existing project (still one `projects` row); a second `start_timer` call for a link that already has an open entry is rejected (`23505`, the partial unique index); `anon`/`authenticated` cannot execute `start_timer` or read `projects`, `service_role` can execute it.

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` applies the new migration cleanly
- `npx supabase test db` — full pgTAP suite passes, including the updated `private_links.test.sql` and the new `projects_and_timer.test.sql`

#### Manual Verification:

- In the local Supabase SQL editor, call `select * from start_timer('<a real link id>', 'Acme')` twice with different casing (`'acme'`) and confirm only one `projects` row exists and the second call returns the same `project_id`
- Calling `start_timer` a third time for the same link (any name) fails with a unique-violation, confirming the one-running-timer guard

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: API route & lib helpers

### Overview

Wrap `start_timer` and the "what's running now" / "what projects exist" reads in typed lib functions, and expose a form-postable API route that mirrors `/api/links.ts`'s shape.

### Changes Required:

#### 1. Project name validation

**File**: `src/lib/project-name.ts`

**Intent**: One pure, unit-testable rule for a valid project name, shared by the API route (before calling the database) and reusable by the UI layer — mirrors `isWellFormedToken`'s role for tokens.

**Contract**: `isValidProjectName(value: unknown): value is string` — trims, rejects empty, rejects over 200 characters.

#### 2. Timer lib

**File**: `src/lib/timer.ts`

**Intent**: Typed wrapper around `start_timer` and the "is a timer running right now" read, following `links.ts`'s `adminOrThrow()` / typed-result style.

**Contract**:
- `export type StartTimerResult = { entryId: string; projectId: string; projectName: string; startedAt: string };`
- `export async function startTimer(linkId: string, projectName: string): Promise<StartTimerResult>` — calls the `start_timer` RPC; a `23505` (Postgres unique-violation) error code from the RPC response is thrown as a distinguishable `TimerAlreadyRunningError`, everything else as a generic error (same pattern as `createLink`'s `create_link` failure handling).
- `export type CurrentTimer = { projectName: string; startedAt: string } | null;`
- `export async function getCurrentTimer(linkId: string): Promise<CurrentTimer>` — selects the open (`ended_at is null`) `time_entries` row for the link, if any.

#### 3. Projects lib

**File**: `src/lib/projects.ts`

**Intent**: List a link's projects for the pick list.

**Contract**: `export type Project = { id: string; name: string };` `export async function listProjects(linkId: string): Promise<Project[]>` — ordered by `name` ascending.

#### 4. API route

**File**: `src/pages/api/w/[token]/timer/start.ts`

**Intent**: The only way to start a timer. Re-derives the link from the URL token exactly as `/w/[token].astro` does — never trusts the `stopper_link` cookie — then calls `startTimer`.

**Contract**: `POST` only (`ALL` returns 405 like `api/links.ts`); form body field `projectName`; malformed token or unknown link → same 404 behavior as the workspace page; invalid name (per `isValidProjectName`) → redirect back with an error query param; `TimerAlreadyRunningError` → redirect back unchanged (the UI shouldn't have shown the form, so this is a race backstop, not a primary path); success → redirect to `/w/[token]`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test` (new `project-name.test.ts` covering `isValidProjectName`)
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`

#### Manual Verification:

- `curl -X POST` to `/api/w/<token>/timer/start` with a fresh project name against a local dev server creates a project and an open time entry, then redirects to the workspace
- Repeating the same request for the same link (timer already running) does not create a second open entry

---

## Phase 3: Workspace UI & smoke test

### Overview

Replace the static "No projects yet." body with the real add/pick/tracking states, and extend the smoke test to cover the new flow.

### Changes Required:

#### 1. Workspace page

**File**: `src/pages/w/[token].astro`

**Intent**: After the existing link lookup succeeds, call `getCurrentTimer` and `listProjects` and render one of two states: tracking (read-only) or add/pick (form + list). Replace the current "No projects yet." block.

**Contract**: No client-side JS beyond the existing copy-link script — the add/pick form is a plain HTML `<form method="post" action="/api/w/[token]/timer/start">` with a text input (new name) and one submit button per listed project (each a distinct `<button name="projectName" value="<project.name>">`), matching the no-JS, redirect-driven pattern already used for link creation. Tracking state renders `project_name` and a formatted `started_at` with no interactivity.

#### 2. Smoke test

**File**: `scripts/smoke.mjs`

**Intent**: Extend the existing local-only smoke script to cover starting a timer on a freshly created link, verifying the two risks `context/foundation/test-plan.md` assigns to this slice (R-01: wrong project attribution, R-02: two concurrent timers) from outside the app, the way a person's browser would exercise it.

**Contract**: After creating a link (existing flow), `POST` to `/api/w/<token>/timer/start` with a project name, assert the redirect lands back on the workspace, and (when `hasServiceAccess`) assert via `rest()`:
- exactly one `projects` row and one open `time_entries` row now exist for that link, and the entry's `project_name` equals the name that was submitted (R-01 — catches a mix-up, not just a missing row)
- a second `POST` with a different project name to the same link does not create a second open `time_entries` row, and the original entry's `project_name` is unchanged (R-02)

### Success Criteria:

#### Automated Verification:

- `npm run smoke` passes against a locally running dev server with a freshly reset database
- Lint and type check pass: `npm run lint`, `npx astro check`

#### Manual Verification:

- Load a fresh `/w/<token>`: see the name field and (empty) project list, no "No projects yet." text
- Type a new project name and submit: timer starts, page now shows "Currently tracking `<name>` — started at `HH:MM`"
- Reload the page: the same tracking state persists (not the form)
- Open the same link in a different browser: same tracking state (proves it's link-scoped, not cookie-scoped)
- Manually clear the open `time_entries` row in the database, reload: the add/pick form reappears with the project now listed for one-click reuse

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `isValidProjectName`: trims, rejects empty/whitespace-only, rejects >200 chars, accepts normal names (including purely numeric "project numbers")

### Integration Tests (pgTAP):

- New-name start creates project + open entry (R-01)
- Re-typed existing name (any case/whitespace) reuses the project, no duplicate (R-01)
- Second start while one is running is rejected (R-02)
- RLS/grant checks on `projects` and `start_timer`

### User-Perspective Verification (test-plan.md risks):

- R-01 (wrong project attribution) and R-02 (two concurrent timers) each get a database-level pgTAP assertion (Phase 1) **and** a black-box HTTP assertion via the extended smoke script (Phase 3) — the pgTAP suite proves the invariant exists, the smoke script proves a real request through the app actually hits it.

### Manual Testing Steps:

1. Fresh link → add first project → timer starts, tracking state shown
2. Reload and cross-browser open → tracking state persists
3. (DB-assisted) clear the open entry → form reappears, previously-used project is one click away

## Migration Notes

`time_entries` currently has no production rows (the table has never been written to by shipped code), so this migration alters it in place rather than migrating existing data.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-02: First timer start)
- PRD: `context/foundation/prd.md` (FR-001, FR-002, US-01)
- Test plan: `context/foundation/test-plan.md` (R-01: wrong project attribution, R-02: two concurrent timers — both traced to this slice's pgTAP suite and its Phase 3 smoke-test extension)
- Prior slice's plan (reference shape for phases/migrations/lib modules): `context/archive/2026-09-21-private-link-access/plan.md`
- Prior slice's review, finding F1 (why `time_entries.link_id` has no FK yet): `context/archive/2026-09-21-private-link-access/reviews/impl-review.md`
- Cap/atomicity pattern to follow: `supabase/migrations/20260921120000_private_links.sql:16-34`
- Token-is-identity pattern to follow: `src/pages/w/[token].astro`, `src/lib/link-cookie.ts:5`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Data model & atomic start function

#### Automated

- [x] 1.1 `npx supabase db reset` applies the new migration cleanly — b30eaf3
- [x] 1.2 `npx supabase test db` — full pgTAP suite passes (updated + new tests) — b30eaf3

#### Manual

- [x] 1.3 `start_timer` called twice with differently-cased names reuses the same project — b30eaf3
- [x] 1.4 A third `start_timer` call for the same link fails with a unique-violation — b30eaf3

### Phase 2: API route & lib helpers

#### Automated

- [x] 2.1 `npm run test` passes (`project-name.test.ts`) — 6fe7915
- [x] 2.2 `npm run lint` passes — 6fe7915
- [x] 2.3 `npx astro check` passes — 6fe7915

#### Manual

- [x] 2.4 `curl` POST to `/api/w/<token>/timer/start` creates a project + open entry and redirects — 6fe7915
- [x] 2.5 Repeating the request for the same link does not create a second open entry — 6fe7915

### Phase 3: Workspace UI & smoke test

#### Automated

- [x] 3.1 `npm run smoke` passes against a fresh local database — c92348a
- [x] 3.2 `npm run lint` and `npx astro check` pass — c92348a

#### Manual

- [x] 3.3 Fresh workspace shows the add/pick UI, not "No projects yet." — c92348a
- [x] 3.4 Adding a project starts its timer and shows the tracking state — c92348a
- [x] 3.5 Reload and cross-browser open both show the same tracking state — c92348a
- [x] 3.6 Clearing the open entry brings back the form with the project available for one-click reuse — c92348a
