# Delete Account (S-10) Implementation Plan

## Overview

Let a person permanently delete every project, every logged time entry, their access-log rows and their private link in one confirmed action, which frees their slot in the 10-person cap. The action sits behind a confirm page where the user types a phrase, and runs as one atomic database function so it can never leave a half-deleted account.

## Current State Analysis

- Four tables reference the person, all with the default `NO ACTION` foreign keys: `time_entries.link_id`, `projects.link_id`, `access_log.link_id`, plus `time_entries.project_id` to `projects`. Deleting a `links` row today fails with `23503` for anyone who has ever started a timer.
- No `ON DELETE CASCADE` exists and no multi-table delete function exists. FR-009's protection (a project with logged time can't be deleted) depends on `time_entries.project_id` staying `NO ACTION`.
- Timer functions serialize per person with `pg_advisory_xact_lock(hashtext('public.timer:' || link_id))` (`supabase/migrations/20260923120000_switch_timer.sql`). A delete that doesn't take the same lock can race a timer start.
- S-09 (delete project) shipped the pattern to copy: confirm page, POST route that re-derives the link from the URL token, typed error, pgTAP test and smoke steps.
- `clearLinkCookie` already exists (`src/lib/link-cookie.ts:20`). `WorkspaceCard.astro` has a "Your private link" block at the bottom where the entry point belongs.
- The comment in `supabase/migrations/20260922100433_access_log_link_fk.sql:5-8` says links are never deleted. FR-010 makes that untrue.
- `context/foundation/infrastructure.md:90-98` already documents the same four deletes, in the same order, as an owner-only support runbook (raw SQL, no locks) and says to plan S-10 if the need becomes routine. It will drift from `delete_account` unless it is pointed at the function.
- `context/foundation/infrastructure.md:112` says `access_log` exists so a leaked link can be investigated. Deleting the rows (decided in planning) means a holder of a leaked link can delete the victim's data and erase that trail in one action; this is accepted and recorded in the brief.

## Desired End State

From the workspace, a person opens "Delete all my data", types `delete my data`, and submits. Every row belonging to their link is gone in one transaction, their browser's remembered link is cleared if it was that link, and they land on the home page with a confirmation message. Their old URL now returns 404, and the 10-person cap has one free slot again. A wrong phrase deletes nothing and shows an error on the confirm page.

Verify with the pgTAP tests, the smoke script over real HTTP, and a manual pass in a real browser.

### Key Discoveries:

- Cascading `time_entries.project_id` would break FR-009 (deleting a project would wipe its entries), so foreign keys stay untouched: `supabase/migrations/20260922150000_projects_and_timer.sql:42`.
- `access_log` rows hold IP and user-agent per link, and FR-010 says "all of their own data", so they are deleted with the link (decision below).
- `start_timer` racing a delete fails on the `time_entries_link_id_fkey` foreign key after the delete commits; that surfaces as the existing generic error and the token then 404s. Acceptable, no extra handling.
- Cookie handling: `src/pages/w/[token].astro:48-52` only remembers a link for a browser that has none, so opening a shared link never replaces the visitor's own. Deletion must mirror that and clear the cookie only when it equals the deleted token.
- Lesson (`context/foundation/lessons.md`): any page with a form uses `Referrer-Policy: strict-origin`, and every new form is submitted in a real browser, because smoke and curl set `Origin` themselves.

## What We're Not Doing

- No `ON DELETE CASCADE` and no foreign key changes.
- No deletion audit record, and no new `access_log.outcome` value. The route logs one console line with no ids.
- No anonymize-and-keep option for `access_log`; the rows are deleted.
- No warning about a running timer on the confirm page; it is deleted like everything else.
- No rate limiting, undo, soft delete or grace period.
- No change to `context/foundation/test-plan.md`, and no edit to the archived audit or to existing migration files (the stale comment is superseded by a new migration).
- No touching link regeneration; the parallel `link-regeneration` change owns that.
- No purge of data outside the app's database: Supabase backups keep deleted rows until they roll off, and Cloudflare request logs (live tail only) contain the token in the URL and the IP. "Deleted" means deleted from Stopper's database.
- No retention job for `access_log`. Hits on a deleted link's old URL still log a `not_found` row with the IP and user-agent, as any unknown token does today; a retention job would be its own slice.

## Implementation Approach

Database first, so the irreversible logic is tested before any UI exists. One `security definer` function `delete_account(p_link_id uuid)` does all the work, following `create_link` and `start_timer`. The app layer is thin: a confirmation check, an RPC call, a POST route, a confirm page, and an entry point. The confirmation phrase is validated on the server so it works without JavaScript and cannot be skipped by posting directly. Linting is slow here, so the full `npm run lint` runs once, in Phase 4, instead of after every phase; between phases rely on `npx astro check` and editor diagnostics, and fix any lint findings in one pass at the end.

## Critical Implementation Details

- **State sequencing:** the function deletes `time_entries`, then `projects`, then `access_log`, then `links`. Deleting `projects` before `time_entries` fails on the `NO ACTION` foreign key. It first takes the advisory lock and then a `for update` row lock on the link: every workspace view inserts an `access_log` row without the timer lock, and without the row lock such an insert committing mid-delete would fail the final link delete with `23503` and roll the whole call back. It returns `false` (and has deleted nothing) when the link id doesn't exist.
- **State sequencing:** the route clears the link cookie only when the cookie's token equals the deleted token; deleting via someone else's shared link must not log out the visitor's own.

## Phase 1: Database function

### Overview

Add the atomic delete function, prove it with pgTAP, supersede the stale "links are never deleted" note, and bring the owner-side runbook in line with the function.

### Changes Required:

#### 1. New migration

**File**: `supabase/migrations/20260928120000_delete_account.sql` (new; the `20260928…` prefix is this lane's per `context/foundation/parallel-goals.md:60`; never edit an existing migration)

**Intent**: Create `delete_account` and record that the old "links are never deleted" note is superseded, without editing the archived migration.

**Contract**: `delete_account(p_link_id uuid) returns boolean`, `security definer`, `set search_path = public`. Takes `pg_advisory_xact_lock(hashtext('public.timer:' || p_link_id::text))`, then locks the link row with `select id from public.links where id = p_link_id for update` and returns `false` at once when there is none. Only then deletes from `time_entries`, `projects`, `access_log` (all `where link_id = p_link_id`) and finally `links where id = p_link_id`, returning `true`. `revoke execute ... from public, anon, authenticated; grant execute ... to service_role` as in `create_link`. Also `comment on constraint access_log_link_id_fkey on access_log` stating that FR-010 now deletes links through `delete_account`. No drops or column changes, so the lessons.md precondition rule does not apply.

#### 2. pgTAP test

**File**: `supabase/tests/database/delete_account.test.sql`

**Intent**: Prove the delete is complete, scoped, atomic in effect and locked down, in the style of `delete_project.test.sql`.

**Contract**: Fixed link ids distinct from other tests. Cases: (a) a link with projects, an open entry, a closed entry and access_log rows is fully removed and the function returns `true`; (b) a second link's rows in all four tables are untouched; (c) an unknown link id returns `false` and changes nothing; (d) the links count drops by one, so the cap slot is free; (e) `anon` and `authenticated` cannot execute it and `service_role` can, via `has_function_privilege` as in `projects_and_timer.test.sql:68-82`.

#### 3. Owner-only runbook

**File**: `context/foundation/infrastructure.md` (the "Owner-only data deletion" bullet, lines 90-98)

**Intent**: Keep the one documented owner-side removal in step with the function, instead of four raw `delete` statements that skip the locks and will drift as tables are added.

**Contract**: Replace the four statements with `select public.delete_account('<link-id>');` (returns `true` if the link existed, `false` otherwise), stating that it is the same function the S-10 route calls. Reword the "never build this into the app" sentence so it covers owner-initiated removal only; the S-10 route lets a link holder delete their own data, which does not recreate an admin role. Drop the "if this need becomes routine, plan S-10" sentence, since S-10 is now planned. Documentation only; no other line in that file changes.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly on a reset database: `npx supabase db reset`
- All database tests pass, including the new file: `npx supabase test db`
- The owner-only runbook calls the function and no longer lists raw deletes: `grep -n "delete_account" context/foundation/infrastructure.md`

#### Manual Verification:

- `\d+ access_log` in psql shows the new constraint comment on `access_log_link_id_fkey`

**Implementation Note**: After this phase's automated checks pass, pause for manual confirmation before Phase 2. Checkbox state lives in `## Progress`.

---

## Phase 2: Server logic

### Overview

The app-side pieces with no UI: the phrase check, the RPC wrapper, status messages and the POST route.

### Changes Required:

#### 1. Confirmation phrase check

**File**: `src/lib/delete-confirmation.ts` and `src/lib/delete-confirmation.test.ts`

**Intent**: A pure, unit-tested check that the typed text is the confirmation phrase.

**Contract**: `DELETE_PHRASE = "delete my data"`; `isDeleteConfirmed(value: unknown): boolean` is true only for a string that equals the phrase after trimming and lowercasing. Internal whitespace is not collapsed, so `"delete  my data"` (two spaces) is rejected and `" Delete My Data "` is accepted. Tests cover both, plus empty, non-string and a near miss.

#### 2. RPC wrapper

**File**: `src/lib/account.ts`

**Intent**: Call the database function through the service-role client and return whether a link was deleted, in the style of `createLink`.

**Contract**: `deleteAccount(linkId: string): Promise<boolean>` using `adminOrThrow()` and `admin.rpc("delete_account", { p_link_id: linkId })`; throws on an RPC error or a non-boolean result. A new file rather than `links.ts`, to avoid conflicts with the parallel link-regeneration work.

#### 3. Status messages

**File**: `src/lib/status-messages.ts` and `src/lib/status-messages.test.ts`

**Intent**: Add the two new user-facing messages and extend the existing tests.

**Contract**: `ERROR_CONFIRM_MISMATCH = "confirm-mismatch"` mapped in `errorMessage` to `That phrase didn't match. Type "delete my data" exactly to confirm.`; `STATUS_ACCOUNT_DELETED = "account-deleted"` mapped in `statusMessage` to `Your data and your private link have been deleted.`

#### 4. POST route

**File**: `src/pages/api/w/[token]/delete-account.ts`

**Intent**: The only way an account is deleted. Re-derives the link from the URL token like `projects/[projectId]/delete.ts`, checks the phrase on the server, deletes, clears the cookie, redirects.

**Contract**: `POST` only (`ALL` returns 405 with `Allow: POST`). Order: malformed token rewrites to `/404`; link lookup failure returns 503; unknown link rewrites to `/404`; the phrase is read from the `confirmation` form field the way `timer/start.ts:33-39` reads `projectName` (a body that isn't a form counts as an empty phrase, never a 500); a phrase that fails `isDeleteConfirmed` redirects 303 to `/w/<token>/delete-account?error=confirm-mismatch` with nothing deleted; `deleteAccount` returning `false` rewrites to `/404`; an exception logs to the console (no ids) and redirects 303 to the confirm page with `error=1`; success clears the link cookie only if `cookies.get(LINK_COOKIE)?.value === token`, then redirects 303 to `/?status=account-deleted`. The success path logs one console line with no ids.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test -- --run`
- Type check passes: `npx astro check`

#### Manual Verification:

- With the dev server and a local database, posting to the route with `curl` and a wrong phrase returns 303 to the confirm page with `error=confirm-mismatch` and leaves the data intact; the right phrase returns 303 to `/?status=account-deleted` and the rows are gone

**Implementation Note**: Pause for manual confirmation before Phase 3. Checkbox state lives in `## Progress`.

---

## Phase 3: UI

### Overview

The confirm page, the entry point on the workspace, and the success banner on the home page.

### Changes Required:

#### 1. Confirm page

**File**: `src/pages/w/[token]/delete-account.astro`

**Intent**: A confirm page modeled on `projects/[projectId]/delete.astro` that explains what will be lost and asks for the typed phrase.

**Contract**: Same headers (`Referrer-Policy: strict-origin`, `Cache-Control: no-store`, `X-Robots-Tag: noindex`) and the same token, lookup and 503/404 handling. Copy states that every project, time entry and the private link are deleted permanently from Stopper, that it frees the person's spot, and that it can't be undone. It claims only what the app controls: it does not say that backups or platform logs are erased. A form posts to `/api/w/<token>/delete-account` with one text input named `confirmation` (labelled with the phrase, `autocomplete="off"`, `required`), a destructive submit button and a Cancel link back to `/w/<token>`. Shows the `error` query param through `errorMessage` in a destructive `Alert`.

#### 2. Entry point

**File**: `src/components/WorkspaceCard.astro`

**Intent**: A clearly separate "Delete all my data" link at the bottom of the card, away from the everyday actions.

**Contract**: One new block after the "Your private link" section, inside the non-unavailable branch: a secondary button-styled link to `/w/${token}/delete-account`, styled like the per-project Delete link (`hover:text-destructive-text`). No new props. Keep the edit to one contiguous block to limit merge conflicts with the parallel link-regeneration change.

#### 3. Home page banner

**File**: `src/pages/index.astro`

**Intent**: Show the "deleted" confirmation after the redirect.

**Contract**: Read `status` from the query, map it with `statusMessage`, and render a success `Alert` (`variant="success"`, `role="status"`) above the create form when present. When `status` maps to a message, skip the auto-redirect to a remembered workspace (`index.astro:11-14`) so the banner is shown even to a browser that holds a different valid link; its create button still returns that browser to its own workspace through `/api/links`.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro check`
- Build passes: `npm run build`

#### Manual Verification:

- The workspace shows "Delete all my data" below the private link and it opens the confirm page
- In a real browser, submitting the confirm form works (no 403 from Astro's origin check) and a wrong phrase shows the mismatch message on the same page
- The confirm page and banner hold up at phone width

**Implementation Note**: Pause for manual confirmation before Phase 4. Checkbox state lives in `## Progress`.

---

## Phase 4: End-to-end check

### Overview

Prove the whole flow over real HTTP with the smoke script, then once in a real browser.

### Changes Required:

#### 1. Smoke steps

**File**: `scripts/smoke.mjs`

**Intent**: Extend the existing script, inside the `hasServiceAccess` block after the access-log and anon checks so the earlier cap steps are undisturbed.

**Contract**: The script has exactly 10 links at that point (`scripts/smoke.mjs:341-370`; the jar's `stopper_link` is the first link's token, and the throttle allows 3 creations per 10 minutes). Hoist the first link's `linkId` (currently block-scoped) or re-query it by token hash. In order:

1. `GET /w/<token>/delete-account` on the first link returns 200 with `Referrer-Policy: strict-origin` (the guard `lessons.md` asks for on form pages).
2. A wrong phrase, and a JSON body, each give 303 to `/w/<token>/delete-account?error=confirm-mismatch`, and every row of the first link remains.
3. Delete the 10th (second-created) link with the right phrase while the jar still holds the first link's cookie: 303 to `/?status=account-deleted`, `stopper_link` stays in the jar, `GET /?status=account-deleted` with that jar returns 200 showing the banner (no redirect), and the link count goes 10 to 9.
4. Create a new link (9 to 10, succeeds), then create again and expect `/?full=1`; this is the cap-slot proof.
5. Delete the first link with the right phrase: 303 to `/?status=account-deleted`, its rows are gone from `time_entries`, `projects`, `access_log` and `links`, `stopper_link` is removed from the jar, `GET /w/<token>` is 404, and other links still open.

### Success Criteria:

#### Automated Verification:

- Lint passes (run once, here; CI runs it again on the PR): `npm run lint`
- Smoke test passes against a freshly reset local database: `npm run smoke:local`

#### Manual Verification:

- In a real browser: start a timer, delete everything with the typed phrase, land on the home page with the success message, and reload the old workspace URL to get 404
- The home page then offers to create a new link, and the 10-person cap has one free slot

**Implementation Note**: This is the last phase; after manual confirmation the change is ready for `/10x-impl-review`. Checkbox state lives in `## Progress`.

---

## Testing Strategy

### Unit Tests:

- `isDeleteConfirmed`: exact phrase, mixed case, surrounding whitespace accepted; internal double space, near miss, empty and non-string rejected
- `errorMessage` and `statusMessage` for the two new codes

### Integration Tests:

- pgTAP: full removal for the target link, isolation of another link, unknown id returns `false`, slot freed, grants
- Smoke over HTTP as described in Phase 4

### Manual Testing Steps:

1. Delete an account that has a running timer and several projects
2. Try a wrong phrase, then a phrase with different case and extra outer spaces
3. Open the deleted URL and confirm 404
4. Delete from a second browser that holds a different remembered link and confirm that browser stays logged in

## Performance Considerations

None. The delete touches one person's rows behind indexed `link_id` columns.

## Migration Notes

Additive only: one new function and one constraint comment. No existing data changes and no rollback beyond dropping the function.

**Production rollout order.** Push the migration to the remote Supabase project first (`npx supabase db push`, human-run, against the direct connection on port 5432 per `context/deployment/deployment-plan.md:185`), then deploy the Worker. Deploying the route first would call a function that doesn't exist and show every user the generic error. A Worker rollback (`wrangler rollback`) does not revert the migration; schema changes are a separate rollback surface (`infrastructure.md:88`), and here dropping the function is enough.

**Production check.** `scripts/smoke.mjs` refuses to run off localhost, so verify in production by hand: create a throwaway link, delete it through the confirm page, and confirm the old URL returns 404. This is safe now because deleting frees the slot, which earlier throwaway links could not.

## References

- Related research: `context/changes/delete-account/research.md`
- Source audit: `context/archive/2026-09-23-first-timer-start-audit/research.md`
- Pattern to copy: `src/pages/api/w/[token]/projects/[projectId]/delete.ts`, `src/pages/w/[token]/projects/[projectId]/delete.astro`, `supabase/tests/database/delete_project.test.sql`
- Lock and grants pattern: `supabase/migrations/20260923120000_switch_timer.sql`
- Requirements: `context/foundation/prd.md` FR-010, FR-007; roadmap S-10

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database function

#### Automated

- [ ] 1.1 Migration applies cleanly on a reset database: `npx supabase db reset`
- [ ] 1.2 All database tests pass, including the new file: `npx supabase test db`
- [ ] 1.3 The owner-only runbook calls the function and no longer lists raw deletes: `grep -n "delete_account" context/foundation/infrastructure.md`

#### Manual

- [ ] 1.4 `\d+ access_log` in psql shows the new constraint comment on `access_log_link_id_fkey`

### Phase 2: Server logic

#### Automated

- [ ] 2.1 Unit tests pass: `npm test -- --run`
- [ ] 2.2 Type check passes: `npx astro check`

#### Manual

- [ ] 2.3 With the dev server and a local database, posting to the route with `curl` and a wrong phrase returns 303 to the confirm page with `error=confirm-mismatch` and leaves the data intact; the right phrase returns 303 to `/?status=account-deleted` and the rows are gone

### Phase 3: UI

#### Automated

- [ ] 3.1 Type check passes: `npx astro check`
- [ ] 3.2 Build passes: `npm run build`

#### Manual

- [ ] 3.3 The workspace shows "Delete all my data" below the private link and it opens the confirm page
- [ ] 3.4 In a real browser, submitting the confirm form works (no 403 from Astro's origin check) and a wrong phrase shows the mismatch message on the same page
- [ ] 3.5 The confirm page and banner hold up at phone width

### Phase 4: End-to-end check

#### Automated

- [ ] 4.1 Lint passes (run once, here; CI runs it again on the PR): `npm run lint`
- [ ] 4.2 Smoke test passes against a freshly reset local database: `npm run smoke:local`

#### Manual

- [ ] 4.3 In a real browser: start a timer, delete everything with the typed phrase, land on the home page with the success message, and reload the old workspace URL to get 404
- [ ] 4.4 The home page then offers to create a new link, and the 10-person cap has one free slot
