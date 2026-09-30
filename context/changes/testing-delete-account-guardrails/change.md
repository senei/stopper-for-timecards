---
change_id: testing-delete-account-guardrails
title: Testing delete-account scope and confirmation guardrails
status: impl_reviewed
created: 2026-09-29
updated: 2026-09-30
archived_at: null
---

## Notes

Test-plan §3 Phase 3, second half: risk #6 (the irreversible full-account delete fires with the wrong scope, or without a real confirmation step). Split from the link-abuse half by decision on 2026-09-29; see `context/archive/2026-09-29-testing-link-abuse-guardrails/`.

The planning-time notes that were here (an unmerged `delete-account` branch, the phrase `delete my data`, 18 pgTAP assertions, a file `src/lib/delete-confirmation.ts`) were stale and are replaced. Current facts, from `research.md`: S-10 is merged and archived on `main` (`context/archive/2026-09-29-delete-account/`); the phrase is `DELETE` (case-sensitive after trimming); pgTAP has 19 assertions; the phrase check is inline in the route. The old `delete-account` branch and worktree are stale and not a source of truth. Oracle and gaps: `research.md`; decisions and phases: `plan.md`.
