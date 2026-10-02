---
change_id: turnstile-failure-visibility
title: Make Turnstile failures visible to the operator
status: implementing
created: 2026-10-02
updated: 2026-10-02
archived_at: null
---

## Notes

make Turnstile failures distinguishable from bot rejections (F2), guard the page reads after the link lookup and add a 500 page and error boundary (F3, F13) from the observability audit

Scope narrowed after /10x-frame (2026-10-02): plan the Turnstile verdict visibility (F2) first. The page error boundary (F3, F13) becomes a separate follow-up change; see frame.md "What Changes for /10x-plan".
