# Delete account (S-10) Implementation Plan

## Overview

Add self-service "Delete all my data" (PRD FR-010, roadmap S-10): one explicit, typed-phrase-confirmed action that permanently removes a person's projects, logged time entries, access-log rows and their private link, and so frees a slot in the 10-person cap. It is fully irreversible with no admin and no recovery, so the confirmation and the delete scope are the parts that need care.

## Current State Analysis

- No delete-account code, route or migration exists. Regenerate (S-07) is the closest pattern: SQL function `regenerate_link` (`supabase/migrations/20260926120000_regenerate_link.sql`), `regenerateLink` in `src/lib/links.ts:32-52`, POST route `src/pages/api/w/[token]/regenerate.ts`, confirm page `src/pages/w/[token]/regenerate.astro`, entry link in `src/components/WorkspaceCard.astro:244-249`.
- Three foreign keys reference `links.id` and all default to `NO ACTION`: `projects.link_id` (`20260922150000_projects_and_timer.sql:15`), `time_entries.link_id` (same file, `:48-50`) and `access_log.link_id` (`20260922100433_access_log_link_fk.sql:13-15`). `job_runs` has no link reference. Deleting a `links` row today fails for anyone who ever started a timer. `time_entries.project_id` also references `projects` with `NO ACTION`, so children must go before parents.
- `access_log` stores `ip` and `user_agent` per access (`src/lib/access-log.ts:22-27`), and its `outcome` check allows only `success`, `not_found`, `error`.
- The comment in `20260922100433_access_log_link_fk.sql:5-8` ("links are never deleted by any code path") is stale once FR-010 ships.
- After a successful action a browser lands on `/?...`; `src/pages/index.astro:10-14` redirects any browser whose `stopper_link` cookie still resolves to a workspace, and shows only error messages, not status messages.
- Smoke (`scripts/smoke.mjs`) ends with the regenerate section (`:490-540`) and leaves ten links in the database when it finishes; its last check leaves `regeneratedToken` valid.

## Desired End State

A person opens their workspace, follows "Delete all my data" to a confirm page, types `DELETE` and submits. Their projects, time entries, access-log rows and link are gone in one transaction. The old link 404s, their cookie is cleared if it held that link, and they land on the home page with a "permanently deleted" banner and can create a new link if a slot is free (it is: theirs was freed). No other person's data changes. Verified by pgTAP for the function, smoke over HTTP, and a real-browser check of the typed-phrase form.

### Key Discoveries:

- Delete function pattern to copy: `security definer`, `set search_path = public`, advisory lock, `revoke ... from public, anon, authenticated`, `grant ... to service_role` (`regenerate_link.sql:17-43`).
- `start_timer` and `regenerate_link` already lock on `hashtext('public.start_timer:' || link_id)` / `'public.regenerate_link:' || link_id`; taking the `start_timer` key keeps a concurrent timer start from inserting a `time_entries` row between the child deletes and the link delete.
- Origin/referrer: the confirm page has a form, so it must use `Referrer-Policy: strict-origin`, never `no-referrer` (`lessons.md:19`), and the form must be submitted in a real browser, since smoke sets `Origin` itself.
- `create_link` counts rows in `links` (`private_links.sql:27`), so deleting the row frees the slot with no other change.
- Existing migrations are never edited (`parallel-goals.md`), so the stale FK comment is refreshed with `comment on constraint` in the new migration.

## What We're NOT Doing

- No `ON DELETE CASCADE` on any foreign key (decided: it is a one-way door that would make any future link delete silently wipe data).
- No audit entry for the deletion and no `access_log.outcome` change (decided: nothing about the person survives; a leaked-link deleter leaves no record, accepted).
- No soft delete, undo window, export-before-delete or email; there are no accounts.
- No new rate limiting. A person can only delete data reachable through the link they hold.
- No two-person isolation integration tests or confirmation-UX guardrail tests here: those belong to `context/changes/testing-delete-account-guardrails/`. This change ships only the function's pgTAP test and one smoke step.
- No browser/e2e automation; the browser check is manual (test-plan §3 Phase 4 owns e2e).
- No edits to existing migrations.

## Implementation Approach

Mirror regenerate end to end so review is a diff against a known-good shape. Database first (function plus its pgTAP proof), then the route that calls it, then the UI and smoke. Decisions taken with the user in this planning session: confirmation is a typed phrase `DELETE`, checked on the server too; deletion is an explicit SQL function (child rows before the link, one transaction), not FK cascade; the person's `access_log` rows are deleted; no deletion audit entry; tests here are minimal. Defaults chosen without asking: a running timer is deleted with everything else; the cookie is cleared only when it holds the deleted token; the landing page after deletion is `/?status=account-deleted`; migration timestamp `20260928120000` as `parallel-goals.md` reserves for S-10. Phases 1 and 2 have a nameable first red test (for example "`delete_account` removes only the requested person's rows and leaves a bystander's untouched"), so they suit `/10x-tdd`; phase 3 is UI and smoke and suits `/10x-implement`.

## Critical Implementation Details

- **Ordering and locking**: inside `delete_account`, take the `start_timer` advisory lock for the link, then lock the `links` row with `select ... for update`, then delete `time_entries`, `projects`, `access_log`, and last `links`. The row lock is what matters: inserts into the child tables (a workspace page view writes `access_log` on every load; timer actions write `time_entries`) need a key-share lock on that row, so they wait instead of landing between the child deletes and the link delete and failing its foreign key. Found in plan review; the timer functions use a different advisory key (`public.timer:<id>`), so the advisory lock alone would not cover them.
- **Server-side confirmation**: the route must refuse unless the submitted phrase equals `DELETE` exactly after trimming, even though the page also disables the button client-side. The check runs after the link lookup and before any database delete.

## Phase 1: `delete_account` database function and pgTAP test

### Overview

The one place the delete happens, with proof that it deletes exactly one person's rows.

### Changes Required:

#### 1. Migration

**File**: new `supabase/migrations/20260928120000_delete_account.sql`

**Intent**: Add the atomic delete, and refresh the stale "links are never deleted" note.

**Contract**: `delete_account(p_link_id uuid) returns boolean`, `security definer`, `set search_path = public`. Takes the `hashtext('public.start_timer:' || p_link_id::text)` advisory lock, then `select id from links where id = p_link_id for update`; returns `false` without changes when no `links` row has that id, otherwise deletes that link's `time_entries`, `projects`, `access_log` rows, then the `links` row, and returns `true`. `revoke execute ... from public, anon, authenticated`; `grant execute ... to service_role`. Also `comment on constraint access_log_link_id_fkey on access_log` stating that links are now deleted only through `delete_account`, which removes the child rows first.

#### 2. pgTAP test

**File**: new `supabase/tests/database/delete_account.test.sql`

**Intent**: Prove the scope, the false cases, the freed slot and the grants against a real Postgres, following `regenerate_link.test.sql`.

**Contract**: Two people made with `create_link`, each with a project, an open time entry and an `access_log` row (one `not_found` row with a null link id also present). After `delete_account(owner)`: the owner's rows are gone from all four tables; the bystander's link, project, entry and access-log row are untouched; the null-link `access_log` row remains; a second call and an unknown uuid return `false` and change nothing. A cap check: with ten links, `create_link` returns null, and after `delete_account` on one it succeeds. Grant checks: `anon` and `authenticated` cannot execute, `service_role` can. Conventions: `begin`, `create extension if not exists pgtap with schema extensions`, `plan(N)` equal to the assertion count, `finish`, `rollback`.

### Success Criteria:

#### Automated Verification:

- Migration applies and pgTAP passes: `npx supabase db reset && npx supabase test db`

#### Manual Verification:

- Deliberate break: remove the `access_log` delete, or the bystander guard, from the function in a worktree-only edit; the matching pgTAP assertion turns red; restore the file
- `plan(N)` matches the assertion count and the migration comment reads correctly

**Implementation Note**: After automated checks pass, pause for manual confirmation before continuing. Checkboxes for these items live in `## Progress`.

---

## Phase 2: Route and library

### Overview

The HTTP path that checks the link and the typed phrase, calls the function, clears the cookie and redirects.

### Changes Required:

#### 1. Library function and messages

**File**: `src/lib/links.ts`; `src/lib/status-messages.ts`

**Intent**: Call the database function from TypeScript and add the user-facing strings.

**Contract**: `deleteAccount(linkId: string): Promise<boolean>` calling `rpc("delete_account", { p_link_id })` through `adminOrThrow()`, throwing on an rpc error and returning the boolean (mirroring `regenerateLink`'s checks). In `status-messages.ts`: `ERROR_CONFIRM_PHRASE = "confirm-phrase"` with the message "Type DELETE exactly to confirm.", and `STATUS_ACCOUNT_DELETED = "account-deleted"` with the message "Your data and link were permanently deleted."

#### 2. API route

**File**: new `src/pages/api/w/[token]/delete-account.ts`

**Intent**: The only way an account is deleted, deriving the link from the URL token exactly as `regenerate.ts` does.

**Contract**: `POST` only (`ALL` returns 405 with `Allow: POST`). Malformed token → `rewrite("/404")`; lookup throws → 503; no link → `rewrite("/404")`. Then read the form field `confirm`; unless `confirm.trim() === "DELETE"`, redirect 303 to `/w/<token>/delete-account?error=confirm-phrase` and change nothing. Otherwise call `deleteAccount(link.id)`; `false` (raced away) → `rewrite("/404")`; a thrown error → log and redirect 303 to `/w/<token>/delete-account?error=1`. On success: if `cookies.get(LINK_COOKIE)?.value === token`, `clearLinkCookie(cookies)`, then redirect 303 to `/?status=account-deleted`. No `logAccess` call (the link no longer exists).

#### 3. Landing-page banner

**File**: `src/pages/index.astro`

**Intent**: Show the "deleted" confirmation after the redirect.

**Contract**: Read `status` from the query string through `statusMessage()` and render it in a success `Alert` above the create form, next to the existing error alert.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro check`
- Existing unit suite passes: `npx vitest run`
- Format and lint on the touched files pass: `npx eslint src/lib/links.ts src/lib/status-messages.ts "src/pages/api/w/[token]/delete-account.ts" src/pages/index.astro`

#### Manual Verification:

- A POST with a wrong phrase changes nothing (checked with the smoke step in Phase 3, or `curl` against a local dev server)

---

## Phase 3: Confirm page, workspace link and smoke step

### Overview

The visible flow, and HTTP proof that it works end to end.

### Changes Required:

#### 1. Confirm page

**File**: new `src/pages/w/[token]/delete-account.astro`

**Intent**: A confirmation page that makes an accidental delete hard, in the shape of `regenerate.astro`.

**Contract**: Sets `Referrer-Policy: strict-origin`, `Cache-Control: no-store`, `X-Robots-Tag: noindex`. Malformed token → 404 rewrite; lookup error → 503 "Temporarily unavailable" card; no link → 404 rewrite. Shows what will be deleted (all projects, all logged time, the link itself, irreversible, frees the slot), a text input named `confirm` with a label that says to type `DELETE`, a destructive submit button that is `disabled` until the field reads `DELETE` (a small client script, with the server check as the real guard), and a Cancel link back to `/w/<token>`. Renders `errorMessage(?error)` as a destructive alert. The form posts to `/api/w/<token>/delete-account`.

#### 2. Workspace entry point

**File**: `src/components/WorkspaceCard.astro`

**Intent**: Give the person a way to reach the confirm page, without making it prominent.

**Contract**: Below the Regenerate link in the "Your private link" section, add a "Delete all my data" link to `/w/<token>/delete-account`, styled as a secondary button with destructive hover like Regenerate, so it does not sit next to Start/Stop.

#### 3. Smoke step

**File**: `scripts/smoke.mjs`

**Intent**: Prove the whole flow over HTTP and that only the caller's data goes.

**Contract**: Add the four token pages' header check for the new page (extending the existing `checkLeakHeaders` list) before the regenerate section invalidates the token, using the token that is valid at that point. After the regenerate section, using `regeneratedToken` (the person who owns the project and entries): the confirm page opens; a POST with no phrase and with `delete` (lowercase) redirects to the confirm page with `error=confirm-phrase` and leaves counts unchanged; a POST with `DELETE` returns 303 to `/?status=account-deleted`; the old and regenerated tokens both 404; `links`, `projects` and `time_entries` counts drop by exactly that person's rows (nine links remain, zero projects and entries, since only this link had any); `access_log` has no row for the deleted link id; another person's link (`otherToken`) still opens; and a new link can be created afterwards (the freed slot). Existing check names and order stay.

### Success Criteria:

#### Automated Verification:

- Syntax and format pass: `node --check scripts/smoke.mjs` and `npx prettier --check scripts/smoke.mjs`
- Full lint and type check pass: `npm run lint` and `npx astro check`
- Whole unit suite passes: `npx vitest run`
- Smoke passes locally, one lane at a time on the shared stack: `ASTRO_DEV_BACKGROUND=1 npm run smoke:local -- --yes` (about 5 minutes; it resets the local database)

#### Manual Verification:

- In a real browser (the `lessons.md` rule: smoke sets `Origin` itself): open a workspace, go to Delete all my data, confirm the button is disabled until `DELETE` is typed, submit, and land on the home page with the "permanently deleted" banner and no remembered link
- In a real browser, submitting a wrong phrase (enable the button by typing then editing, or post directly) shows the "Type DELETE exactly" error and deletes nothing
- CI `smoke` job is green after the push (observed, not run by the agent)

---

## Phase 4: Roadmap and test-plan sync

### Overview

Record that S-10 exists so the test plan and roadmap reflect reality and the sibling test change can proceed.

### Changes Required:

#### 1. Status sync

**File**: `context/foundation/roadmap.md`; `context/foundation/test-plan.md`

**Intent**: Note the slice is built and unblock `testing-delete-account-guardrails`.

**Contract**: Roadmap S-10: replace the two resolved `Unknowns` lines with the decisions (typed phrase `DELETE`; no audit entry). Status changes are made by `/10x-implement` and `/10x-archive`, not by hand. Test-plan §3 row 3: no wording change beyond noting that `testing-delete-account-guardrails` can now start, since the code it tests exists.

### Success Criteria:

#### Automated Verification:

- Whole unit suite still passes: `npx vitest run`

#### Manual Verification:

- The roadmap S-10 block records both decisions and the test-plan row is accurate

---

## Testing Strategy

### Unit Tests:

- None new: the logic is a SQL function, a route and markup. The phrase check is exercised through smoke (a route test would only rewrite it).

### Integration Tests:

- pgTAP `delete_account.test.sql`: scope (owner's rows gone from four tables, bystander and null-link log row untouched), false cases, freed slot at the cap, grants.

### Manual Testing Steps:

1. Run the Phase 1 deliberate break and confirm the pgTAP test goes red, then restore.
2. Run `smoke:local` once, in one lane.
3. Do the two real-browser checks in Phase 3 (typed phrase with the button gating; wrong phrase).

## Performance Considerations

None: four deletes by an indexed `link_id` (`time_entries_link_id_idx`, `access_log_link_id_accessed_at_idx`) for one person.

## Migration Notes

One new migration, additive (a function and a constraint comment). It never runs a delete on its own; existing data is untouched until someone confirms in the app. No rollback beyond dropping the function.

## References

- PRD: `context/foundation/prd.md:84-85` (FR-010), `:78-80` (FR-007, slot freeing), `:90` (no public access)
- Roadmap: `context/foundation/roadmap.md` S-10; `context/foundation/parallel-goals.md` Lane 4
- Audit findings: `context/archive/2026-09-23-first-timer-start-audit/research.md`
- Pattern to follow: `supabase/migrations/20260926120000_regenerate_link.sql`, `src/pages/api/w/[token]/regenerate.ts`, `src/pages/w/[token]/regenerate.astro`, `supabase/tests/database/regenerate_link.test.sql`
- Lessons: `context/foundation/lessons.md:19` (strict-origin on form pages), `:33` (record how manual rows were verified)
- Sibling change: `context/changes/testing-delete-account-guardrails/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: `delete_account` database function and pgTAP test

#### Automated

- [x] 1.1 Migration applies and pgTAP passes: `npx supabase db reset && npx supabase test db` — 344b8c4

#### Manual

- [x] 1.2 Removing the `access_log` delete or the bystander guard turned the matching pgTAP assertion red, and the file was restored — 344b8c4
- [x] 1.3 `plan(N)` matches the assertion count and the migration comment reads correctly — 344b8c4

### Phase 2: Route and library

#### Automated

- [ ] 2.1 Type check passes: `npx astro check`
- [ ] 2.2 Existing unit suite passes: `npx vitest run`
- [ ] 2.3 Lint on the touched files passes: `npx eslint src/lib/links.ts src/lib/status-messages.ts "src/pages/api/w/[token]/delete-account.ts" src/pages/index.astro`

#### Manual

- [ ] 2.4 A POST with a wrong phrase changes nothing

### Phase 3: Confirm page, workspace link and smoke step

#### Automated

- [ ] 3.1 Syntax and format pass: `node --check scripts/smoke.mjs` and `npx prettier --check scripts/smoke.mjs`
- [ ] 3.2 Full lint and type check pass: `npm run lint` and `npx astro check`
- [ ] 3.3 Whole unit suite passes: `npx vitest run`
- [ ] 3.4 Smoke passes locally, one lane at a time: `ASTRO_DEV_BACKGROUND=1 npm run smoke:local -- --yes`

#### Manual

- [ ] 3.5 In a real browser, the delete button stays disabled until `DELETE` is typed, submitting lands on the home page with the "permanently deleted" banner, and no link is remembered
- [ ] 3.6 In a real browser, a wrong phrase shows the "Type DELETE exactly" error and deletes nothing
- [ ] 3.7 CI `smoke` job is green after the push

### Phase 4: Roadmap and test-plan sync

#### Automated

- [ ] 4.1 Whole unit suite still passes: `npx vitest run`

#### Manual

- [ ] 4.2 The roadmap S-10 block records both decisions and the test-plan row is accurate
