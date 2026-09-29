# Delete account (S-10) — Plan Brief

> Full plan: `context/changes/delete-account/plan.md`

## What & Why

Add self-service "Delete all my data" (PRD FR-010): one confirmed action that permanently removes a person's projects, time entries, access-log rows and private link, and frees a slot in the 10-person cap. It is fully irreversible with no admin and no recovery, so confirmation and delete scope get the care.

## Starting Point

Nothing deletes a link today: three foreign keys to `links.id` default to `NO ACTION`, so a delete fails for anyone who ever logged time. Regenerate-link (S-07) is the closest built flow (SQL function, POST route, confirm page) and is the pattern to copy.

## Desired End State

From their workspace a person follows "Delete all my data", types `DELETE` and submits. Their data and link are gone in one transaction, the old link 404s, their remembered-link cookie is cleared, and they land on the home page with a "permanently deleted" banner. Nobody else's data changes, and the freed slot can be used by a new link.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Confirmation | Type `DELETE`, checked on the server too | Hard to misclick or replay, and matches the PRD's own example | Plan |
| Delete mechanism | SQL function `delete_account`, child rows before the link | Atomic, same shape as `regenerate_link`, and no one-way `ON DELETE CASCADE` | Plan |
| Access log | Delete the person's rows | "Delete all my data" must include the IP and user agent stored there | Plan |
| Audit entry | None | Nothing about the person survives; no constraint change | Plan |
| Tests here | One pgTAP file plus a smoke step | The function ships proven; risk-#6 depth stays in the sibling change | Plan |
| Running timer | Deleted with everything else | The action is all-or-nothing | Plan (default) |
| Cookie and landing | Clear cookie only if it holds this token; go to `/?status=account-deleted` | Never wipe a different link's cookie | Plan (default) |

## Scope

**In scope:** the migration and its pgTAP test, the library function and POST route, the confirm page and workspace link, the landing-page banner, a smoke step, and a roadmap decision note.

**Out of scope:** `ON DELETE CASCADE`, a deletion audit entry, soft delete or undo, export, e2e automation, and the two-person isolation and confirmation-guardrail tests (sibling change `testing-delete-account-guardrails`).

## Architecture / Approach

`WorkspaceCard` links to `/w/<token>/delete-account`, whose form posts to `/api/w/<token>/delete-account`. The route re-derives the link from the URL token, requires the phrase `DELETE`, then calls the `delete_account(link_id)` function, which takes the same advisory lock as `start_timer`, deletes `time_entries`, `projects` and `access_log` rows, then the link. The route clears the matching cookie and redirects home.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database function and pgTAP | `delete_account` plus proof it removes only one person's rows | Missing a child table or a bystander leak |
| 2. Route and library | POST route with server-side phrase check, messages, landing banner | Deleting without a valid phrase |
| 3. Confirm page, link and smoke | The visible flow and HTTP proof, plus a real-browser check | Browser-only form failure that smoke cannot see |
| 4. Roadmap and test-plan sync | Decisions recorded; sibling change unblocked | None significant |

**Prerequisites:** local Supabase stack and the smoke setup that `testing-link-abuse-guardrails` already used; no other prerequisite change.
**Estimated effort:** about 3 to 4 sessions across 4 phases; the smoke run costs about 5 minutes.

## Open Risks & Assumptions

- A future table with a `link_id` must be added to `delete_account`, or the delete will fail loudly (accepted trade-off of choosing the function over cascade).
- Anyone holding a leaked link can delete that person's data, and no record is kept (the same accepted model as regeneration lockout).
- The smoke step assumes the create-link throttle allows one more link right after the earlier creations; the implementer confirms this when running it.

## Success Criteria (Summary)

- A person can delete everything they own in one typed-phrase-confirmed action, and their old link stops working.
- No other person's data is touched, and the freed slot can be used.
- pgTAP, smoke and the real-browser check all pass.
