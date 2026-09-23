# Delete Project — Plan Brief

> Full plan: `context/changes/delete-project/plan.md`

## What & Why

Let a person delete a project from their workspace list, protected from deletion (with a clear explanation) if it has any logged time entries against it. This is roadmap slice S-09 (FR-009) — the audit of shipped S-02 found the enforcement mechanism (a foreign key) already in place, so this is a small, low-risk addition rather than new architecture.

## Starting Point

`src/pages/w/[token].astro` lists a link's projects as one-click "start timer" buttons, with no delete affordance. `time_entries.project_id references projects(id)` already defaults to `ON DELETE NO ACTION` (`supabase/migrations/20260922150000_projects_and_timer.sql:42`), so the database already refuses to delete a used project — it just doesn't produce a friendly message yet, and nothing calls it. Separately, the workspace page has never rendered the `?error=` param that `timer/start.ts` has been setting since S-02 — those errors are silently dropped today.

## Desired End State

Each project in the pick-list has a "Delete" link. It opens a plain confirm page naming the project; confirming either deletes it (workspace then shows "Project deleted.") or, if it has logged time, is rejected with "That project has logged time and can't be deleted." — and the project stays exactly as it was.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Confirmation UX | Two-step confirm page (GET page, then POST) | Keeps the app's no-JS, redirect-driven pattern intact rather than introducing the first non-copy-link client-side script | Plan |
| Error/status display scope | Fix the workspace page's dead `?error=` rendering generally, not just for delete | The gap already silently drops timer/start's own error messages; one shared fix serves both flows | Plan |
| Enforcement mechanism | Always show Delete; let the existing FK reject and translate the error | Single source of truth (the FK), no extra query, no precheck/delete race window | Plan |
| Delete mechanism | Plain scoped `DELETE ... WHERE id = $1 AND link_id = $2` | No multi-step sequence to make atomic, unlike `start_timer`; the FK is the only invariant that matters | Plan |
| Whether the FK alone satisfies FR-009 | No — it needs an app-level 23503 → friendly-message translation | A raw FK violation isn't a "clear message explaining why" | Research |

## Scope

**In scope:**
- `deleteProject`/`getProject` in `src/lib/projects.ts`, with `ProjectInUseError` translation
- Confirm page + delete API route, both re-deriving the link from the token
- A shared `status-messages.ts` vocabulary, wired into both the new delete flow and the existing (currently silent) timer/start error codes
- pgTAP + smoke coverage for both the success and blocked delete paths
- A new R-04 entry in `context/foundation/test-plan.md`

**Out of scope:**
- Hiding/disabling the Delete button for used projects ahead of time (no precheck)
- Any change to `access_log` or the purge worker (S-08)
- Deleting a project while a timer is running for it (already impossible — the pick-list this lives on only renders when no timer is open)

## Architecture / Approach

No schema change — S-02's FK is reused as-is. `deleteProject()` is a single scoped `DELETE`, not a new Postgres function (no multi-step sequence needs an advisory lock, unlike `start_timer`). Both new routes mirror `timer/start.ts`'s exact re-derive-link-from-token shape. A small shared `status-messages.ts` module is the single source of truth for every `?error=`/`?status=` code and its user-facing text, referenced by both the pre-existing timer/start route and the new delete flow.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data layer | `deleteProject`/`getProject`/`ProjectInUseError`, pgTAP coverage, test-plan.md R-04 | The "successful delete" path needs a project with zero logged time, which the real app can't produce yet — tests must insert directly rather than via `start_timer` |
| 2. Routes & UI | Confirm page, delete route, workspace banner + Delete link, smoke coverage | Reusing `timer/start.ts`'s exact route shape correctly (503 vs. 404 vs. redirect branches) |

**Prerequisites:** S-02 (first-timer-start), already shipped and archived.
**Estimated effort:** ~1 session across 2 phases — no schema change, small, precedented surface area.

## Open Risks & Assumptions

- No project created through today's shipped app can actually reach the "zero logged time" state — the success-delete path is real but currently only reachable via direct DB manipulation (tests) until S-08's purge worker eventually ages out old entries. This doesn't block shipping S-09; it's a fact about what's exercisable end-to-end right now.
- The workspace-page banner fix touches `timer/start.ts` (swapping two string literals for shared constants) — a previously-shipped S-02 file, not just net-new code.

## Success Criteria (Summary)

- A person can delete a project with no logged time and it disappears from their list
- A person attempting to delete a used project sees a clear explanation and the project is untouched
- Canceling the confirm step makes no change; a tampered/foreign project id 404s rather than leaking another link's project name
