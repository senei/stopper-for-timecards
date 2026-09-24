# Timer Switch Rounding Implementation Plan

## Overview

Let a person switch their running timer to a different project mid-day: the current segment closes at the exact switch moment and a new one opens for the target project, with no separate stop/confirm step. This is roadmap slice **S-03** (FR-003).

## Current State Analysis

- `time_entries.ended_at` (nullable `timestamptz`) already exists, added by the placeholder migration and never used by any code path — nothing has ever closed an entry.
- `start_timer(p_link_id, p_project_name)` (`supabase/migrations/20260922150000_projects_and_timer.sql:66-98`) is the only function that touches `time_entries`. It always *inserts*, never updates, and its advisory lock key is `'public.start_timer:' || p_link_id::text` — scoped to itself only.
- `src/pages/w/[token].astro` only ever shows one of two states: the add/pick form (no timer running) or a static "Currently tracking…" line (timer running), with no way to act while tracking — S-02's plan explicitly deferred switching to this slice.
- No rounding/duration math exists anywhere in the codebase (confirmed via search — the only "round" hits are Tailwind CSS classes).

### Key Discoveries:

- **The rounding rule's "day" concept depends on an already-open roadmap question.** The Mon–Sun day-boundary/timezone decision for the weekly grid is still unresolved (`context/foundation/roadmap.md`, S-06's Open Roadmap Questions). Since the chosen rounding architecture rounds a *per-day* total, building that aggregation now would mean guessing a timezone likely to need rework once S-06 settles it. This plan records the rounding rule (see Implementation Approach) but defers building the aggregation function itself to S-06.
- Every atomic invariant in this codebase lives in the database via `pg_advisory_xact_lock` + `security definer` functions (`start_timer`, `create_link`). `switch_timer` follows the identical shape.
- `start_timer`'s advisory lock key needs to become shared with `switch_timer` so the two can never race for the same link — a safe, behavior-preserving `create or replace function` (no data migration, no external dependents on the lock key string itself).

## Desired End State

While a timer is running, the workspace shows the tracking line plus a "Switch to a different project" section — a text field for a new name and a button per other project (the currently-tracked project excluded). Picking one closes the current segment at that instant and starts a new one for the target project, with no separate confirmation. Switching to a project not yet used today (or ever) creates it, exactly like starting a fresh timer does.

**Verification:** `npm run test`, `npm run lint`, `npx astro check`, `npx supabase test db`, and `npm run smoke` all pass; manually confirmed via the steps in each phase below.

## What We're NOT Doing

- Building the rounding/aggregation function itself (the actual "round this project's total today, rounding up to 15 minutes" computation) — blocked on S-06's day-boundary/timezone decision. This slice stores exact, correct raw timestamps; S-06 implements the math against them.
- Stopping the timer, or flagging a suspiciously long-running one (S-04).
- Any display of elapsed time, segment duration, or a "switched!" confirmation — no reporting UI exists until S-06; this slice's UI stays as minimal as S-02's.
- Any UI/backend handling for "switch to the project already being tracked" — resolved by excluding it from the switch list entirely, so the case can't arise through the app. A direct HTTP call naming the same project is still harmless (see Implementation Approach) but isn't a UI path.
- Corrections to logged time (S-05), the weekly grid (S-06).

## Implementation Approach

`switch_timer(p_link_id, p_project_name)` is a new Postgres function with the same shape as `start_timer`: `security definer`, advisory-locked on the same key (`'public.timer:' || p_link_id::text` — `start_timer` is redefined to use this same generalized key string, so the two functions serialize against each other for a given link, not just against themselves). It looks up the link's open entry — if none exists, raises a distinguishable exception (`P0001`, race backstop, same philosophy as `TimerAlreadyRunningError`) — closes it (`ended_at = now()`), then runs the exact same find-or-create-and-insert logic `start_timer` already uses for the new project. Because the close happens before the new insert, the partial unique index (`time_entries (link_id) where ended_at is null`) never sees two open rows at once.

Switching to the currently-tracked project is made structurally impossible by excluding it from the UI's project list (the decided approach) rather than special-cased in `switch_timer` itself — the function stays general-purpose. If it were ever called with the same project name anyway (e.g. a direct API call), the result is just two consecutive segments for the same project, which is harmless under the decided rounding rule (a per-day-per-project total sums however many segments there were).

**Rounding rule (recorded, not yet implemented — see Key Discoveries):** round each project's total tracked time *per day* — not per individual segment — always rounding up to the next 15-minute increment. This is decided now (and recorded in `roadmap.md`/`test-plan.md`) so S-06 doesn't have to re-litigate it once the day-boundary question resolves.

## Phase 1: Data layer

### Overview

Generalize `start_timer`'s lock key, add `switch_timer`, its pgTAP coverage, the `timer.ts` lib additions, and record the rounding-rule decision in the foundation docs.

### Changes Required:

#### 1. New migration

**File**: `supabase/migrations/20260923120000_switch_timer.sql`

**Intent**: Redefine `start_timer` to use a lock key shared with the new `switch_timer`, and add `switch_timer` itself.

**Contract**: `create or replace function start_timer(...)` — identical body except the advisory lock key changes from `'public.start_timer:' || p_link_id::text` to `'public.timer:' || p_link_id::text`. New function:

```sql
create or replace function switch_timer(p_link_id uuid, p_project_name text)
returns table (entry_id uuid, project_id uuid, project_name text, started_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open_id uuid;
  v_project_id uuid;
  v_name text;
  v_task text;
  v_type text;
  v_work_type text;
begin
  perform pg_advisory_xact_lock(hashtext('public.timer:' || p_link_id::text));

  select id into v_open_id
    from public.time_entries
    where link_id = p_link_id and ended_at is null;

  if v_open_id is null then
    raise exception 'no active timer to switch' using errcode = 'P0001';
  end if;

  update public.time_entries set ended_at = now() where id = v_open_id;

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
    insert into public.time_entries as te (link_id, project_id, project_name, task, type, work_type, started_at)
    values (p_link_id, v_project_id, v_name, v_task, v_type, v_work_type, now())
    returning te.id, te.project_id, te.project_name, te.started_at;
end;
$$;

revoke execute on function switch_timer(uuid, text) from public, anon, authenticated;
grant execute on function switch_timer(uuid, text) to service_role;
```

#### 2. Timer lib additions

**File**: `src/lib/timer.ts`

**Intent**: Wrap `switch_timer`, following `startTimer`'s exact typed-result/error-translation style. Also expose the currently-tracked project's id (needed by the UI to exclude it from the switch list), which `CurrentTimer` doesn't carry today.

**Contract**:
- `export class NoActiveTimerError extends Error` — same shape as `TimerAlreadyRunningError`, message "No timer is running for this link", checks `response.error.code === "P0001"`.
- `export async function switchTimer(linkId: string, projectName: string): Promise<StartTimerResult>` — calls the `switch_timer` RPC, same response validation as `startTimer`, translates `P0001` to `NoActiveTimerError`.
- `CurrentTimer` gains `projectId: string` alongside the existing `projectName`/`startedAt` fields; `getCurrentTimer`'s select and row-shape validation extend to include `project_id`.

#### 3. pgTAP coverage

**File**: `supabase/tests/database/switch_timer.test.sql`

**Intent**: Prove the invariants this slice depends on, in the same style as `projects_and_timer.test.sql`.

**Contract**: Cover — switching to a different (new) project closes the previously-open entry (`ended_at` set) and opens exactly one new open entry for the target project; switching to an existing project name (any case/whitespace) reuses that project, same as `start_timer`; calling `switch_timer` when no timer is running is rejected with `P0001` and no entries change; two consecutive switches to the *same* project name both succeed, producing two closed/open segments for that one project (proves the "harmless" claim from Implementation Approach); `anon`/`authenticated` cannot execute `switch_timer`, `service_role` can.

#### 4. Record the rounding-rule decision

**File**: `context/foundation/roadmap.md`

**Intent**: Resolve S-03's open Unknown now that it's decided.

**Contract**: Replace the `- **Unknowns:** - Rounding rule for sub-15-minute switches...` line under `### S-03` with a resolution note (matching the style already used for S-02's project-fields resolution): round each project's tracked time per day (not per segment), always rounding up to the next 15-minute increment; recorded now, implementation deferred to S-06 pending its day-boundary/timezone decision.

**File**: `context/foundation/test-plan.md`

**Intent**: Update R-03's status to reflect the decision without claiming it's implemented.

**Contract**: Add a note under `### R-03` recording the decided rule (per-day-per-project total, round up) and that it remains unimplemented, blocked on S-06's day-boundary decision — do not change R-03's "Not yet implemented" characterization.

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` applies the new migration cleanly
- `npx supabase test db` — full pgTAP suite passes, including the new `switch_timer.test.sql` and the existing `projects_and_timer.test.sql` (proving `start_timer` still works after its lock-key change)
- Unit tests pass: `npm run test`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`

#### Manual Verification:

- In the local Supabase SQL editor, call `start_timer` then `switch_timer` for the same link and confirm the first entry now has `ended_at` set and exactly one new open entry exists for the new project
- Call `switch_timer` for a link with no running timer and confirm it fails with `P0001`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: API route

### Overview

Expose `switchTimer` through a form-postable route, mirroring `timer/start.ts`'s exact shape.

### Changes Required:

#### 1. Switch route

**File**: `src/pages/api/w/[token]/timer/switch.ts`

**Intent**: The only way a running timer is switched. Re-derives the link from the token exactly as `timer/start.ts` does.

**Contract**: `POST` only (`ALL` → 405, same as `timer/start.ts`). Malformed token → `rewrite("/404")`; link-lookup failure → `503` (same pattern as `timer/start.ts`); unknown link → `rewrite("/404")`; invalid `projectName` (`isValidProjectName`) → redirect `` `/w/${token}?error=${ERROR_INVALID_NAME}` ``, 303. Calls `switchTimer(link.id, rawName)`: `NoActiveTimerError` → redirect to `` `/w/${token}` `` unchanged (race backstop, same treatment `timer/start.ts` gives `TimerAlreadyRunningError`); any other thrown error → log and redirect `` `/w/${token}?error=${ERROR_GENERIC}` ``, 303; success → redirect `` `/w/${token}` ``, 303 (plain, no status param — matches `timer/start.ts`'s own success redirect).

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`

#### Manual Verification:

- `curl -X POST` to `/api/w/<token>/timer/switch` with a fresh project name against a local dev server, while a timer is already running, closes the running entry and opens a new one, then redirects to the workspace
- The same request against a link with no running timer redirects to the workspace unchanged, with no new entry created

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: UI & smoke test

### Overview

Add the switch affordance to the tracking view and extend the smoke test to cover switching end to end.

### Changes Required:

#### 1. Workspace page

**File**: `src/pages/w/[token].astro`

**Intent**: While tracking, show a way to switch to a different project — reusing the add/pick form's shape, posting to the new switch route, with the currently-tracked project excluded from the list.

**Contract**: Inside the `currentTimer` branch, below the existing tracking line, add a heading ("Switch to a different project"), a text input + submit button posting to `` `/api/w/${token}/timer/switch` `` (mirrors the existing new-name form, labelled "Switch" instead of "Start"), and a list of every other project (`projects.filter((p) => p.id !== currentTimer.projectId)`) as one-button-per-project forms posting to the same switch route (mirrors the existing pick-list, same styling).

### Success Criteria:

#### Automated Verification:

- `npm run smoke` passes against a locally running dev server with a freshly reset database
- Lint and type check pass: `npm run lint`, `npx astro check`

#### Manual Verification:

- Start a timer, then load the workspace: see "Switch to a different project" with a name field and every *other* project listed (not the one currently tracked)
- Type a new name and submit: the previous segment closes, the new one starts, tracking line updates to the new project
- Reload: the same new tracking state persists
- Switch back to the original project by typing its name again: succeeds, tracking line shows it again

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- No new pure-logic unit tests — `switchTimer`/`NoActiveTimerError` are DB-touching, verified through pgTAP + smoke, same as `startTimer`/`TimerAlreadyRunningError` (neither has a unit test file today).

### Integration Tests (pgTAP):

- New-project switch closes the old entry, opens exactly one new open entry (R-01, R-02)
- Existing-project switch (any case/whitespace) reuses the project, no duplicate (R-01)
- Switching with no running timer is rejected with `P0001`, no entries change
- Two consecutive same-project switches both succeed (validates the "harmless" design decision)
- RLS/grant checks on `switch_timer`

### User-Perspective Verification (test-plan.md risks):

- R-02 (more than one timer running) extends naturally: a switch must never leave two open entries — covered by the partial unique index plus this slice's pgTAP close-then-insert ordering, and a smoke assertion that exactly one open entry exists after a switch.
- Smoke test addition: start a timer, switch to a new project via the real HTTP route, assert the old entry closed (`ended_at` set) and the new one is open and attributed to the new project name; switch again to a third project and assert the same; switch back to the first project by name and assert it reuses that project (not a duplicate) and correctly reopens.

### Manual Testing Steps:

1. Start a timer, switch to a new project → old segment closes, new one starts, no separate confirmation
2. Reload and cross-browser open → same new tracking state persists
3. Switch to a project used earlier today → reuses it, doesn't duplicate
4. (DB-assisted) call `switch_timer` with no running timer → fails cleanly, no entries change

## Migration Notes

`start_timer`'s redefinition changes only its internal advisory lock key string — no signature, return shape, or caller-visible behavior changes, so no data migration or caller updates are needed beyond the SQL function replace itself.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-03: Switch timer between projects)
- PRD: `context/foundation/prd.md` (FR-003, Business Logic, Non-Functional Requirements)
- Test plan: `context/foundation/test-plan.md` (R-02, R-03)
- Prior audit research (S-03 readiness analysis this plan is built on): `context/changes/first-timer-start-audit/research.md`
- Function pattern to follow: `supabase/migrations/20260922150000_projects_and_timer.sql:66-98` (`start_timer`)
- Error-translation pattern to follow: `src/lib/timer.ts:24-33` (`TimerAlreadyRunningError`)
- Redirect-driven route shape to follow: `src/pages/api/w/[token]/timer/start.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Data layer

#### Automated

- [x] 1.1 `npx supabase db reset` applies the new migration cleanly — c619b72
- [x] 1.2 `npx supabase test db` — full pgTAP suite passes, including new `switch_timer.test.sql` — c619b72
- [x] 1.3 Unit tests pass: `npm run test` — c619b72
- [x] 1.4 Lint passes: `npm run lint` — c619b72
- [x] 1.5 Type check passes: `npx astro check` — c619b72

#### Manual

- [x] 1.6 `start_timer` then `switch_timer` for the same link closes the first entry and opens exactly one new one — c619b72
- [x] 1.7 `switch_timer` with no running timer fails with `P0001` — c619b72

### Phase 2: API route

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — a3d37c3
- [x] 2.2 Type check passes: `npx astro check` — a3d37c3

#### Manual

- [x] 2.3 `curl` POST to `/api/w/<token>/timer/switch` while tracking closes the old entry, opens a new one, redirects — a3d37c3
- [x] 2.4 Same request with no running timer redirects unchanged, no new entry — a3d37c3

### Phase 3: UI & smoke test

#### Automated

- [x] 3.1 `npm run smoke` passes against a freshly reset local database
- [x] 3.2 `npm run lint` and `npx astro check` pass

#### Manual

- [x] 3.3 Tracking view shows "Switch to a different project" with every other project listed, current one excluded
- [x] 3.4 Switching to a new name closes the old segment and starts the new one, no confirmation step
- [x] 3.5 Reload persists the new tracking state
- [x] 3.6 Switching back to the original project by name reuses it correctly
