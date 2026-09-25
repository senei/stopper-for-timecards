# Research: Delete account (S-10), carried over from the first-timer-start audit

Source: `context/archive/2026-09-23-first-timer-start-audit/research.md` (read-only, archived). The audit stopped at research and never became a plan, so these findings were not in any plan. Line references below come from the audit and were true on 2026-09-23. Re-verify them at `/10x-plan` time.

## Research Question

What does it take to let a user permanently delete every project, every time entry, and their private link in one confirmed action, freeing their slot in the 10-person cap?

## Findings

### Current state (fully greenfield)

- Three foreign keys reference `links.id`, all defaulting to `NO ACTION`:
  - `projects.link_id` (`supabase/migrations/20260922150000_projects_and_timer.sql:15`)
  - `time_entries.link_id` via `time_entries_link_id_fkey` (same file, lines 48-50)
  - `access_log.link_id` via `access_log_link_id_fkey` (`supabase/migrations/20260922100433_access_log_link_fk.sql:13-15`)
- `time_entries.project_id` also references `projects (id)` with no `ON DELETE` clause (same S-02 migration, line 42).
- `job_runs` has no link reference.
- Deleting a `links` row today fails with an FK violation for any account that has ever started a timer.
- No `ON DELETE CASCADE` exists anywhere, and no multi-table delete function exists in any migration.
- `logAccess()` (`src/lib/access-log.ts:15-37`) is not a drop-in fit for a deletion audit entry. Its `outcome` is limited to `'success' | 'not_found' | 'error'` by a DB check constraint (`supabase/migrations/20260918082739_phase_b_c_purge_and_access_log.sql:47`) and by the TS type. Nothing represents "account deleted".

### Patterns to reuse

- Atomic invariants live in the database. `create_link` and `start_timer` use `pg_advisory_xact_lock` inside a `security definer` function with grants restricted to `service_role`. A new delete function should follow that shape.
- Error translation catches a specific Postgres code and rethrows a named typed error (`src/lib/timer.ts:28-33`, `23505` to `TimerAlreadyRunningError`). See `context/archive/2026-09-23-delete-project/` for how S-09 applied it to `23503`.
- RLS is enabled on every table with zero policies. The service-role client is the only reader and writer.

## Open Questions

Owner is the user unless noted.

1. **Cascade vs manual delete function (architecture, not previously in the roadmap).** A hard `ON DELETE CASCADE` is a one-way door. It forecloses any future soft-delete or archive feature on links. A manual multi-table delete function is more auditable, but it must delete children before parents to avoid the same `NO ACTION` violations. Decide at `/10x-plan`.
2. **Deletion audit log** (`roadmap.md:208`). Options:
   - add a new `access_log.outcome` value, which is a schema change
   - use a separate mechanism
   - keep no audit entry
   The audit confirmed this is a real design question, because `access_log` has an FK to `links` and the link is being deleted.
3. **Confirmation UX** (`roadmap.md:207`). Typed phrase vs two-step confirm. The roadmap calls this the highest-consequence single click in the app, with no undo. Give it real scrutiny at plan time.

## Improvements

Small items surfaced by the audit that are not tied to a product decision.

- [ ] **Fix the stale comment** in `supabase/migrations/20260922100433_access_log_link_fk.sql:5-8`. It says links are never deleted by any code path, "by design, see FR-007". FR-010 adds exactly that path. Do this in a new migration or comment change, not by editing history.
- [ ] **Apply the migration precondition rule** from `context/foundation/lessons.md` (recorded after finding F2 of the first-timer-start review) to any destructive migration this change adds. F2 itself stays accepted for the shipped S-02 migration.
- [x] **FR-007 wording** already says it is superseded by FR-010 (`context/foundation/prd.md:80`); nothing to change.

## Related

- Roadmap: `context/foundation/roadmap.md`, S-10 (line ~198)
- Prior art: `context/archive/2026-09-23-delete-project/` (S-09, FK-error translation)
- Audit source: `context/archive/2026-09-23-first-timer-start-audit/research.md`
