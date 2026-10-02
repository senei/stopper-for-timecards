---
change_id: page-error-boundary
title: Guard page reads and add a 500 page and error boundary
status: implementing
created: 2026-10-02
updated: 2026-10-02
archived_at: null
---

## Notes

guard the two unguarded page reads after the link lookup (w/[token].astro, projects/[projectId]/delete.astro) and add a 500 page and error boundary; facts and limits (streaming errors, headers, null error prop) are in context/changes/turnstile-failure-visibility/frame.md, split from F3/F13 of the observability audit
