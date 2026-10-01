---
change_id: link-regeneration
title: Regenerate own private link (S-07)
status: archived
created: 2026-09-28
updated: 2026-10-01
archived_at: 2026-10-01T11:28:03Z
---

## Notes

Roadmap slice S-07 (FR-007, US-02): a user can regenerate their own private link from the
workspace page. The old token stops working immediately (404 through `findLinkByToken`), the
new one lands in the same workspace with all projects and entries intact, and no other user's
link changes. The atomic swap belongs in a security-definer SQL function following the
`create_link` / `start_timer` pattern (advisory lock, service_role-only grant), logged via
`logAccess()`, and covered by pgTAP plus a smoke check.

Open, non-blocking question to resolve with a reasonable default in the plan: what the
regenerate confirmation looks like, and whether the new link is shown once or stays visible in
the UI.
