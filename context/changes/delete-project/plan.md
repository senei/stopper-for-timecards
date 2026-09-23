# Delete Project Implementation Plan

## Overview

Let a person delete a project from their workspace, protected from deletion (with a clear explanation) if it has any logged time entries against it. This is roadmap slice **S-09** (FR-009).

## Current State Analysis

- `src/pages/w/[token].astro` lists a link's projects (`listProjects`, `src/lib/projects.ts:9-39`) as one-click "start this project's timer" buttons, with no delete affordance anywhere.
- `time_entries.project_id uuid not null references projects (id)` already exists with no explicit `ON DELETE` clause (`supabase/migrations/20260922150000_projects_and_timer.sql:42`), so it defaults to `ON DELETE NO ACTION` — confirmed against this codebase's own documented convention on the analogous `access_log_link_id_fkey` (`supabase/migrations/20260922100433_access_log_link_fk.sql:5-8`). This FK already makes "can't delete a used project" the database's behavior; **no migration is needed for this plan.**
- `src/lib/timer.ts:24-33` establishes the error-translation pattern this plan reuses: catch a specific Postgres error code from an RPC/query response and re-throw as a named, typed error class (`23505` → `TimerAlreadyRunningError`). This plan needs the same shape for `23503`.
- `src/pages/api/w/[token]/timer/start.ts` sets `?error=invalid-name` and `?error=1` on its redirect-back branches, but `src/pages/w/[token].astro` never reads `Astro.url.searchParams` — those errors are silently dropped today. FR-009's "clear message explaining why" needs somewhere to actually render.
- Ownership/identity is always re-derived from the URL token, never trusted from a cookie or a client-supplied id — `findLinkByToken` (`src/lib/links.ts:35`) is called fresh on every request that needs the link; the same pattern must extend to verifying a `projectId` actually belongs to the requesting link, not just that it exists.

### Key Discoveries:

- **Every project created through the app today already has logged time, always.** `start_timer()` (`supabase/migrations/20260922150000_projects_and_timer.sql:66-98`) is the only project-creation path in the app, and it *always* inserts a `time_entries` row in the same transaction as creating the project (lines 93-96) — there is no way to create a project without simultaneously starting a timer for it. So through the real UI/API, a project can never actually reach the "zero logged time, deletable" state; only a project whose `time_entries` rows have all since been removed (not possible yet — nothing deletes entries until S-08's purge worker is re-pointed at the real table) would qualify. This doesn't block implementing S-09 — the FR still requires the mechanism to exist and will matter once entries age out — but it means the "successful delete" path cannot be exercised end-to-end through the real HTTP flow with today's other shipped slices; both the pgTAP suite and the smoke test need a direct, non-`start_timer` way to create an unused project for that specific assertion (see Testing Strategy).
- `src/lib/projects.ts`'s existing `listProjects` (lines 9-39) already returns `{id, name}` per project — the `id` needed for the delete link/route is already available to the page with no extra query.
- RLS is enabled with zero policies on every table; the service-role client is the sole reader/writer throughout (`supabase/migrations/20260922150000_projects_and_timer.sql:31`). A new `deleteProject` function follows this same access model — no new grants needed beyond what `adminOrThrow()` already provides.

## Desired End State

From the workspace's project-pick view, each listed project has a "Delete" link. Clicking it opens a confirmation page naming the project; confirming deletes it and returns to the workspace with a "Project deleted." message. If the project has any logged time, the confirm step's delete attempt instead returns to the workspace with "That project has logged time and can't be deleted." — the project remains, untouched.

**Verification:** `npm run test`, `npm run lint`, `npx astro check`, `npx supabase test db`, and `npm run smoke` all pass; manually confirmed via the steps in each phase below.

## What We're NOT Doing

- Any UI to pre-check or hide the Delete link for used projects — the delete button always shows; the database enforces the block (see Key Decisions in the brief).
- Fixing every place in the app that might someday want a status/error banner beyond the workspace page — only `src/pages/w/[token].astro` gets one.
- Bulk delete, or deleting a project while its timer is currently running (impossible today anyway: the workspace's pick-list, where Delete lives, only renders when no timer is open for the link).
- Any change to `access_log` — this action isn't a link-access event and doesn't warrant a new audit row (see References, first-timer-start-audit research).
- Re-pointing or otherwise touching the purge worker (S-08) — out of scope, unrelated slice.

## Implementation Approach

`deleteProject(linkId, projectId)` in `src/lib/projects.ts` does a plain `delete from projects where id = $1 and link_id = $2` — no new Postgres function or advisory lock needed (unlike `start_timer`, there's no multi-step find-or-create/insert sequence to make atomic; a single scoped `DELETE` is already atomic, and the existing FK is the only invariant that matters). The `link_id` predicate is what verifies ownership — a `projectId` that exists but belongs to another link, or doesn't exist at all, deletes zero rows, which the caller treats identically to "not found." A Postgres `23503` (foreign-key-violation) response is caught and re-thrown as `ProjectInUseError`, mirroring `TimerAlreadyRunningError`'s exact shape.

Deletion goes through a two-step, no-JS confirm page (`/w/[token]/projects/[projectId]/delete`, GET) before the actual POST action (`/api/w/[token]/projects/[projectId]/delete`) — consistent with the app's redirect-driven, JS-free pattern (the only existing `<script>` is the copy-link/local-time convenience, not a form interaction). Both routes re-derive the link from the token exactly as `/w/[token].astro` and `timer/start.ts` already do, never trusting the URL's `projectId` alone.

A small shared module, `src/lib/status-messages.ts`, exports named constants for every `?error=`/`?status=` code and a lookup function for the friendly text. `timer/start.ts`'s existing literals (`"invalid-name"`, `"1"`) are swapped for the shared constants (no behavior change), and the workspace page uses the same lookup to finally render a banner for both flows — the delete flow's messages, and the pre-existing timer/start ones that have been silently dropped since S-02.

## Critical Implementation Details

**No `logAccess()` call on the new routes.** `timer/start.ts` re-derives the link on every POST but never calls `logAccess()` — only `/w/[token].astro`'s initial page load does, since that's the app's one "did someone open this link" event. The new confirm page and delete route follow that same precedent and must not add their own `logAccess()` calls; doing so would double-count/misrepresent what `access_log` means.

**Test fixtures for the success path bypass `start_timer`.** Per the Key Discovery above, proving `deleteProject` actually succeeds requires a project with zero `time_entries` rows, which the real app can't produce yet. The pgTAP suite creates this by inserting directly into `projects` (already routine in this suite's setup style, e.g. `private_links.test.sql:38-39`), not by calling `start_timer`. The smoke test's equivalent check uses its existing service-role REST access (`hasServiceAccess`, already gating the R-01/R-02 assertions) to insert a project row directly before exercising the real HTTP delete route against it.

## Phase 1: Data layer

### Overview

Add the delete mechanism to `src/lib/projects.ts`, a project-id validator, pgTAP coverage for both the success and blocked paths, and record the new test risk.

### Changes Required:

#### 1. Project id validator

**File**: `src/lib/project-id.ts`

**Intent**: One pure, unit-testable check that a route param is a syntactically valid id before it ever reaches the database — mirrors `isWellFormedToken`'s role for link tokens (`src/lib/link-token.ts:19-21`).

**Contract**: `export function isWellFormedId(value: unknown): value is string` — `typeof value === "string"` and matches a standard UUID shape (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`).

#### 2. Delete + lookup in the projects lib

**File**: `src/lib/projects.ts`

**Intent**: Add the delete operation and a single-project ownership-scoped lookup (for the confirm page to read the project's name), following this file's existing `adminOrThrow()` / typed-result style.

**Contract**:
- `export class ProjectInUseError extends Error` — same shape as `TimerAlreadyRunningError` (`src/lib/timer.ts:12-17`): fixed message, `name = "ProjectInUseError"`.
- `export async function getProject(linkId: string, projectId: string): Promise<Project | null>` — selects `id, name` from `projects` where `id = projectId and link_id = linkId`; `null` if no matching row (covers both "doesn't exist" and "belongs to another link").
- `export async function deleteProject(linkId: string, projectId: string): Promise<boolean>` — deletes from `projects` where `id = projectId and link_id = linkId`, returns whether a row was actually removed. On a Postgres `23503` response, throws `ProjectInUseError` instead of returning:

```ts
export async function deleteProject(linkId: string, projectId: string): Promise<boolean> {
  const admin = adminOrThrow();
  const { data, error } = await admin.from("projects").delete().eq("id", projectId).eq("link_id", linkId).select("id");
  if (error) {
    if (error.code === "23503") {
      throw new ProjectInUseError("This project has logged time and can't be deleted");
    }
    throw new Error(`deleteProject failed: ${error.message}`);
  }
  return (data?.length ?? 0) > 0;
}
```

#### 3. pgTAP coverage

**File**: `supabase/tests/database/delete_project.test.sql`

**Intent**: Prove the invariants this slice depends on, in the same style as `projects_and_timer.test.sql`.

**Contract**: Cover — deleting a directly-inserted project with zero `time_entries` rows removes exactly that row; deleting a project that has any `time_entries` row (via `start_timer`, open or already-closed) is rejected with `23503`, and the project row still exists afterward; deleting a `projectId` that belongs to a different link's `link_id` predicate removes zero rows (ownership scoping, not a cross-link deletion); `anon`/`authenticated` cannot delete from `projects` (existing RLS/no-policy convention), `service_role` can.

#### 4. Record the new test risk

**File**: `context/foundation/test-plan.md`

**Intent**: Document the risk this slice's tests exist to catch, per this file's own stated convention ("New slices add risks here as they're planned").

**Contract**: Add `### R-04: A project with logged time gets deleted, destroying its history` under `## Risks`, sourced from FR-009's "a project with any logged time is protected from deletion... instead of silently destroying history" resolution (`context/foundation/prd.md:83`), covered by `delete_project.test.sql` and the Phase 2 smoke addition. Add a `R-04: covered as of S-09 (delete-project)` line to `## Status`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test` (new `project-id.test.ts`)
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- `npx supabase test db` — full pgTAP suite passes, including the new `delete_project.test.sql`

#### Manual Verification:

- In the local Supabase SQL editor, insert a project directly (no `time_entries` row) and confirm calling the delete path removes it
- Start a timer against a project (via `start_timer`), then attempt to delete that project directly and confirm it fails with a `23503` foreign-key-violation and the project row still exists

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Routes & UI

### Overview

Add the confirm page and delete action, wire a Delete link into the workspace's project list, and add the shared status/error banner (fixing the pre-existing dead `?error=` rendering gap along the way).

### Changes Required:

#### 1. Shared status/error message vocabulary

**File**: `src/lib/status-messages.ts`

**Intent**: One place mapping every `?error=`/`?status=` code this app sets to its user-facing text, shared by every route that sets one of these params and the page that renders them — avoids the params and their meanings drifting apart across files.

**Contract**:

```ts
export const ERROR_INVALID_NAME = "invalid-name";
export const ERROR_PROJECT_IN_USE = "project-in-use";
export const ERROR_GENERIC = "1";
export const STATUS_PROJECT_DELETED = "project-deleted";

export function errorMessage(code: string | null): string | null {
  if (!code) return null;
  const messages: Record<string, string> = {
    [ERROR_INVALID_NAME]: "That project name isn't valid.",
    [ERROR_PROJECT_IN_USE]: "That project has logged time and can't be deleted.",
  };
  return messages[code] ?? "Something went wrong. Please try again.";
}

export function statusMessage(code: string | null): string | null {
  if (!code) return null;
  const messages: Record<string, string> = { [STATUS_PROJECT_DELETED]: "Project deleted." };
  return messages[code] ?? null;
}
```

#### 2. Wire existing timer/start route to the shared constants

**File**: `src/pages/api/w/[token]/timer/start.ts`

**Intent**: Replace the two inline `"invalid-name"` / `"1"` string literals with `ERROR_INVALID_NAME` / `ERROR_GENERIC` from `status-messages.ts` — no behavior change, just removes the duplicate source of truth.

**Contract**: Import and use `ERROR_INVALID_NAME`, `ERROR_GENERIC` in place of the existing literals at both redirect sites.

#### 3. Delete confirmation page

**File**: `src/pages/w/[token]/projects/[projectId]/delete.astro`

**Intent**: A GET page naming the project and asking for confirmation before the destructive POST — the app's no-JS equivalent of a confirm dialog.

**Contract**: Same three no-cache/no-index headers as `/w/[token].astro`. Malformed token or unavailable link → same `rewrite("/404")` / unavailable-503 handling as the workspace page. Malformed `projectId` (`isWellFormedId`) or `getProject(link.id, projectId)` returning `null` → `rewrite("/404")`. Body: "Delete `<project.name>`? This can't be undone." with a `<form method="post" action="/api/w/[token]/projects/[projectId]/delete">` submit button and a plain `<a href="/w/[token]">Cancel</a>`. Does not call `logAccess()` (see Critical Implementation Details).

#### 4. Delete action route

**File**: `src/pages/api/w/[token]/projects/[projectId]/delete.ts`

**Intent**: The only way a project is actually deleted. Re-derives the link from the token exactly as `timer/start.ts` does — never trusts the URL's `projectId` alone as proof of ownership.

**Contract**: `POST` only (`ALL` → 405, mirrors `timer/start.ts`). Malformed token → `rewrite("/404")`; link-lookup failure → `503` response (mirrors `timer/start.ts`'s existing F6 branch); unknown link or malformed `projectId` → `rewrite("/404")`. Calls `deleteProject(link.id, projectId)`: `ProjectInUseError` → redirect to `/w/[token]?error=project-in-use`; any other thrown error → log and redirect to `/w/[token]?error=1`; returns `false` (nothing deleted — not found/not owned) → `rewrite("/404")`; returns `true` → redirect to `/w/[token]?status=project-deleted`. All redirects use status 303, matching `timer/start.ts`.

#### 5. Workspace page: banner + delete link

**File**: `src/pages/w/[token].astro`

**Intent**: Render the status/error banner (covers both timer/start's pre-existing codes and delete's new ones), and add a Delete link next to each listed project.

**Contract**: Read `Astro.url.searchParams.get("error")` / `.get("status")`, resolve via `errorMessage()` / `statusMessage()`, render as a small banner near the top of the available-link branch when non-null. In the existing `projects.map(...)` list (lines 104-120 today), add `<a href={`/w/${token}/projects/${project.id}/delete`}>Delete</a>` alongside each project's existing start button.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test` (new `status-messages.test.ts`)
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- `npm run smoke` passes against a locally running dev server with a freshly reset database

#### Manual Verification:

- Load a workspace with an existing (used) project: click Delete → confirm page shows the project's name → Confirm → redirected to workspace showing "That project has logged time and can't be deleted."; project still listed
- Using the Supabase SQL editor, insert a project with no time entries for the same link, reload the workspace, click its Delete link → confirm page → Confirm → redirected to workspace showing "Project deleted."; project no longer listed
- Click Cancel on a confirm page → returns to the workspace with no change
- Navigate directly to a delete confirm URL with a `projectId` belonging to a different link (or a nonsense id) → 404

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `isWellFormedId`: accepts a well-formed UUID, rejects malformed strings and non-strings
- `errorMessage`/`statusMessage`: known codes map to their exact text, unknown error codes fall back to the generic message, unknown status codes and `null` return `null`

### Integration Tests (pgTAP):

- Deleting an unused (directly-inserted) project succeeds and removes the row (R-04, success path)
- Deleting a project with any `time_entries` row — open or closed — fails with `23503`, project row unchanged (R-04, blocked path)
- A `projectId` scoped to another link's `link_id` deletes zero rows (ownership scoping)
- RLS/grant checks on the new `deleteProject` query path

### User-Perspective Verification (test-plan.md risks):

- R-04 gets both a database-level pgTAP assertion (Phase 1) and a black-box HTTP assertion via the extended smoke script (Phase 2) — same two-layer pattern S-02 used for R-01/R-02: pgTAP proves the invariant exists, the smoke script proves a real request through the app actually hits it.
- Smoke test additions: (1) attempt to delete a project that has logged time via the real HTTP route, assert the redirect lands on `?error=project-in-use` and the project row still exists; (2) using service-role REST access, insert a project with zero time entries, delete it via the real HTTP route, assert the redirect lands on `?status=project-deleted` and the project row is gone.

### Manual Testing Steps:

1. Attempt to delete a used project → blocked with a clear message, project remains
2. Delete a project with no logged time (created via direct DB insert, since the app can't produce one yet) → succeeds, confirmed by the "Project deleted." message and the project disappearing from the list
3. Cancel from the confirm page → no change
4. Tamper with the `projectId` in the confirm URL → 404, not a leak of another link's project name

## Migration Notes

None — no schema change. The FK added in S-02's migration (`supabase/migrations/20260922150000_projects_and_timer.sql:42`) is reused as-is as the enforcement mechanism.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-09: Delete a project)
- PRD: `context/foundation/prd.md` (FR-009)
- Test plan: `context/foundation/test-plan.md` (new R-04)
- Prior audit research (schema/lib verification + readiness analysis this plan is built on): `context/changes/first-timer-start-audit/research.md`
- Error-translation pattern to follow: `src/lib/timer.ts:24-33` (`TimerAlreadyRunningError`)
- Redirect-driven route shape to follow: `src/pages/api/w/[token]/timer/start.ts`
- Token-is-identity / re-derive-link pattern: `src/pages/w/[token].astro`, `src/lib/links.ts:35`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Data layer

#### Automated

- [x] 1.1 Unit tests pass: `npm run test` (new `project-id.test.ts`)
- [x] 1.2 Lint passes: `npm run lint`
- [x] 1.3 Type check passes: `npx astro check`
- [x] 1.4 `npx supabase test db` — full pgTAP suite passes, including new `delete_project.test.sql`

#### Manual

- [x] 1.5 Directly-inserted unused project deletes successfully via the delete path
- [x] 1.6 A project with a `start_timer`-created entry fails deletion with `23503`, row unchanged

### Phase 2: Routes & UI

#### Automated

- [ ] 2.1 Unit tests pass: `npm run test` (new `status-messages.test.ts`)
- [ ] 2.2 Lint passes: `npm run lint`
- [ ] 2.3 Type check passes: `npx astro check`
- [ ] 2.4 `npm run smoke` passes against a freshly reset local database

#### Manual

- [ ] 2.5 Deleting a used project is blocked with a clear message; project remains listed
- [ ] 2.6 Deleting an unused project (DB-inserted) succeeds; "Project deleted." shown, project no longer listed
- [ ] 2.7 Cancel from the confirm page makes no change
- [ ] 2.8 A tampered/foreign `projectId` on the confirm URL 404s
