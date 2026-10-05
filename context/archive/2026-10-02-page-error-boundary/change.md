---
change_id: page-error-boundary
title: Guard page reads and add a 500 page and error boundary
status: archived
created: 2026-10-02
updated: 2026-10-05
archived_at: 2026-10-05T06:44:51Z
---

## Notes

guard the two unguarded page reads after the link lookup (w/[token].astro, projects/[projectId]/delete.astro) and add a 500 page and error boundary; facts and limits (streaming errors, headers, null error prop) are in context/changes/turnstile-failure-visibility/frame.md, split from F3/F13 of the observability audit
