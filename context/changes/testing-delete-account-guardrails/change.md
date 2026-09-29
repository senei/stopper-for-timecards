---
change_id: testing-delete-account-guardrails
title: Testing delete-account scope and confirmation guardrails
status: new
created: 2026-09-29
updated: 2026-09-29
archived_at: null
---

## Notes

Test-plan §3 Phase 3, second half: risk #6 (the irreversible full-account delete fires with the wrong scope, or without a real confirmation step). Split from the link-abuse half by decision on 2026-09-29; see `context/changes/testing-link-abuse-guardrails/`. Sequence this one second: it can only cover what is built.

Planning-agent findings (2026-09-29, unverified by research):
- S-10 (delete-account) is only partly built, on branch `delete-account` (worktree `../x10-dev--curse-delete-account`): Phase 1 (database) done, with migration `delete_account(p_link_id)` and `delete_account.test.sql` (18 assertions, including a bystander user, unknown link id, cap slot freed). Phases 2-4 (phrase check `src/lib/delete-confirmation.ts`, POST route, confirm page, smoke) are not built. Nothing of it is on `main`. Start research only after that branch has at least its Phase 2 route.
- pgTAP already covers scope and isolation on the branch. Gaps to consider: a wrong or empty phrase deletes nothing; a non-form body is treated as an empty phrase and never a 500; deletion through the real route or wrapper. A hermetic stub may be enough for the phrase unit test.
- e2e (confirm UX, wrong then right phrase) depends on test-plan Phase 4 creating the real-browser layer; the smoke script sets `Origin` itself and is not enough (risk #3).
- Deliberate-break ideas: delete only by projects, drop the phrase check, delete every link. The fixture must include a bystander user.
- Oracle sources: PRD FR-010 (deletes every project and time entry and the link, one explicit confirmed action, hard-to-misclick confirmation such as a typed phrase, frees a slot in the 10-cap), test-plan §2 risk #6.
- The `delete-account` plan chose, but the PRD does not state: phrase `delete my data` (case-insensitive, trimmed), `access_log` rows deleted with the account, no deletion audit entry, no running-timer warning. These are plan decisions, not PRD facts; tests must label them "current plan decision", or the user must first promote them to the PRD.
- Lessons to apply: shared local Supabase stack per worktree lane; deliberate-break with a multi-user fixture.
