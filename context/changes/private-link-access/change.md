---
change_id: private-link-access
title: Private link creation and access with 10-user cap
status: implemented
created: 2026-09-21
updated: 2026-09-22
archived_at: null
---

## Notes

Roadmap item S-01 (M-01: Core timecard flow), GitHub issue #1 (https://github.com/senei/stopper-for-timecards/issues/1). PRD refs: FR-007, US-02.

Outcome: user can create their own private link (up to 10 total users, clear "full" message after that) and open it to land in their own empty workspace, with no login step.

Known unknown: retire the starter's email/password pages, or keep them unlinked? (owner: user, non-blocking). Wire the existing logAccess() helper (TODO(FR-007) in src/lib/access-log.ts) into the link lookup route.
