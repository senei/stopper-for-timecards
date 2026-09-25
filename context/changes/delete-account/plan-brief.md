# Delete Account (S-10) — Plan Brief

> Full plan: `context/changes/delete-account/plan.md`
> Research: `context/changes/delete-account/research.md`

## What & Why

Let a person permanently delete all of their data (projects, time entries, access-log rows) and their private link in one confirmed action. FR-010 requires it, and it is the only self-service way to free a slot in the 10-person cap. It is irreversible with no accounts and no recovery, so the confirmation has to be hard to do by accident.

## Starting Point

S-02 and S-09 shipped: projects, timers, and a confirm-page-plus-POST-route pattern for deleting a project. Four tables hold `NO ACTION` foreign keys to the person, so deleting a link fails today, and nothing deletes more than one table at a time.

## Desired End State

From the workspace, a person opens "Delete all my data", types `delete my data`, and submits. Everything they own is gone in one transaction, their browser forgets the link, and they land on the home page with a confirmation. The old URL returns 404 and the cap has a free slot. A wrong phrase deletes nothing.

## Key Decisions Made

| Decision            | Choice                                                                       | Why (1 sentence)                                                                          | Source   |
| ------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------- |
| Confirmation UX     | Typed phrase `delete my data`, checked on the server                         | Matches FR-010's own example and works without JavaScript.                                | Plan     |
| Delete mechanism    | One `delete_account` database function, no foreign key changes               | Atomic, matches `create_link`/`start_timer`, and keeps FR-009 and soft delete possible.   | Research |
| `ON DELETE CASCADE` | Rejected                                                                     | It would let deleting a project wipe its time entries, breaking FR-009, and is one-way.   | Plan     |
| `access_log` rows   | Deleted with the link                                                        | FR-010 says "all of their own data" and the rows hold IP and user-agent.                  | Plan     |
| Deletion audit      | None in the database; one console line with no ids                           | Nothing identifying should survive a delete-everything action.                            | Plan     |
| Concurrency         | Function takes the per-link `public.timer:` advisory lock, then a row lock   | Serializes with timer functions and with `access_log` inserts from page views.            | Plan     |
| Cookie              | Cleared only when it equals the deleted token                                | Deleting via a shared link must not log out the visitor's own link.                       | Plan     |
| Code placement      | New `src/lib/account.ts` and `src/lib/delete-confirmation.ts`                | Avoids conflicts with the parallel link-regeneration change touching `links.ts`.          | Plan     |

## Scope

**In scope:** the migration and pgTAP test, phrase check, RPC wrapper, POST route, confirm page, workspace entry point, home-page banner, smoke steps, superseding the stale "links are never deleted" comment, and pointing the owner-only runbook in `infrastructure.md` at the new function.

**Out of scope:** cascades or foreign key changes, a deletion audit record, keeping anonymized access-log rows, running-timer warning, rate limiting, undo or soft delete, purging backups or platform logs, an `access_log` retention job, editing `test-plan.md` or archived files.

## Architecture / Approach

A confirm page at `/w/<token>/delete-account` posts to `/api/w/<token>/delete-account`. The route re-derives the link from the URL token, checks the phrase, and calls `delete_account(link_id)`. That function locks the person, deletes `time_entries`, `projects`, `access_log`, then the link, and returns whether the link existed. Success clears the matching cookie and redirects to `/?status=account-deleted`.

## Phases at a Glance

| Phase                  | What it delivers                                              | Key risk                                             |
| ---------------------- | ------------------------------------------------------------- | ---------------------------------------------------- |
| 1. Database function   | `delete_account` migration, pgTAP test, runbook update        | Wrong delete order or missed table leaves a `23503`  |
| 2. Server logic        | Phrase check, RPC wrapper, messages, POST route               | Route deleting without a correct phrase              |
| 3. UI                  | Confirm page, workspace entry point, home-page banner         | Form blocked by Astro's origin check in a browser    |
| 4. End-to-end check    | Smoke steps plus a real-browser pass                          | Smoke ordering disturbing the existing cap steps     |

**Prerequisites:** S-02 done (it is); local Supabase running for database tests and smoke.
**Estimated effort:** ~2 sessions across 4 phases.

## Open Risks & Assumptions

- The parallel `link-regeneration` change likely edits `WorkspaceCard.astro`; the entry point is kept to one contiguous block to limit conflicts.
- Anyone holding the link can delete everything; that follows the accepted no-accounts model, and the typed phrase is the only guard.
- A timer start racing a delete fails with the generic error and the token then 404s; accepted as harmless.
- Deleting the `access_log` rows removes the trail `infrastructure.md:112` keeps for investigating leaked links: a holder of a leaked link can delete the victim's data and that trail in one action. Accepted in planning; the typed phrase is the only guard.
- "Deleted" covers Stopper's database only. Supabase backups and Cloudflare request logs are outside the app, so the confirm-page copy must not claim otherwise.
- Rollout order matters: push the migration to the remote Supabase project before deploying the Worker, or every user sees the generic error. The production check is by hand, since smoke refuses to run off localhost.

## Success Criteria (Summary)

- A person can delete everything with the typed phrase and lands on a confirmation; the old link 404s
- A wrong phrase, or a direct POST without the phrase, deletes nothing
- The 10-person cap regains a slot, and other people's data is untouched
