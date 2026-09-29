# Regenerate own private link (S-07) — Plan Brief

> Full plan: `context/changes/link-regeneration/plan.md`

## What & Why

FR-007/US-02: a person can regenerate their own private link from their workspace page. This is the
self-service response to a leaked or forwarded link — the affected person alone can invalidate it,
without an admin and without touching anyone else's access. The old token must 404 immediately; the
new one must land in the exact same workspace (same projects, same history).

## Starting Point

`links` is a person-per-row table (`id` stable, `token_hash` the only mutable identity field).
`create_link` and `start_timer` are the two existing security-definer, advisory-locked,
service_role-only SQL functions this change follows as precedent. `findLinkByToken` resolves a
token to a link everywhere; nothing currently changes a `token_hash` once created.

## Desired End State

From the workspace, the person clicks "Regenerate link," confirms, and lands on a new `/w/<token>`
URL — same projects, same timer state, same history — with a banner reminding them to save the new
link. Their old URL 404s on the next request. Nobody else's link is affected.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Atomic swap location | New `regenerate_link(old_hash, new_hash)` SQL function | Follows `create_link`/`start_timer`'s exact precedent (security definer, advisory lock, service_role-only grant) rather than a client-side read-then-write | Plan |
| Lock scope | Advisory lock keyed on the resolved link `id` | Same key space `start_timer` already uses per link; closes the lookup→update race even though a losing concurrent call already fails on `token_hash` mismatch | Plan |
| Confirmation UX (open question, resolved) | Dedicated GET confirmation page, same shape as delete-project's confirm/cancel page | Reuses an existing, already-reviewed pattern rather than inventing a JS `confirm()` dialog | Plan |
| New-link visibility (open question, resolved) | No special one-time reveal; shown via the URL bar and the existing always-visible "Your private link" box | Matches how a freshly created link is already presented; a second reveal affordance would be inconsistent and isn't required by US-02's acceptance criteria | Plan |
| Cookie update on regenerate | Unconditionally set `stopper_link` to the new token | This is the person's own explicit action on their own session, unlike the passive "only if empty" rule used when opening an arbitrary link | Plan |
| `[token].astro` edits | None | The new status banner reuses existing `statusMessage()` plumbing; the "Regenerate" link only needs the `token` prop `WorkspaceCard` already has | Plan |

## Scope

**In scope:**
- `regenerate_link` SQL function + pgTAP coverage
- `regenerateLink()` lib wrapper, confirmation page, API route, cookie update, `logAccess()` call
- Additive "Regenerate link" UI affordance in `WorkspaceCard.astro`
- `scripts/smoke.mjs` end-to-end coverage

**Out of scope:**
- Cap/create-link logic, `findLinkByToken`'s signature
- New `access_log.outcome` values (existing `success`/`not_found`/`error` cover it)
- A one-time-reveal modal or any change to `src/pages/w/[token].astro`
- Rate limiting on regeneration

## Architecture / Approach

`links.token_hash` is the only field that changes. `regenerate_link` looks the row up by the old
hash, advisory-locks on its `id`, and swaps `token_hash` to the new value in one statement — every
other table (`projects`, `time_entries`, `access_log`) keys off `links.id`, which never changes, so
nothing else needs to move. The app layer mirrors the existing confirm-then-POST pattern used by
project deletion, re-deriving authorization from the URL token at every step, never the cookie.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database | Atomic `regenerate_link` function + pgTAP | Getting the race/idempotency semantics right (old-hash precondition, concurrent-call loser) |
| 2. Application | Confirm page, API route, cookie, UI affordance | Keeping `[token].astro` untouched while still wiring the new banner |
| 3. Coverage | `smoke.mjs` end-to-end flow | Placement must not disturb later checks that assume the original token/cookie |

**Prerequisites:** local Supabase running (shared across worktrees — check `npx supabase status` first).
**Estimated effort:** ~1 session across 3 phases; small, well-precedented surface area.

## Open Risks & Assumptions

- Assumes the 256-bit token space makes a `token_hash` collision on regeneration negligible (same
  assumption `create_link` already makes and doesn't handle).
- Assumes no other in-flight lane changes `links`' schema or `create_link`/`start_timer`'s grant
  shape before this merges (parallel worktree; migrations are prefix-isolated per
  `parallel-goals.md`).

## Success Criteria (Summary)

- Regenerating replaces the token; the old one 404s on the very next request.
- The new link opens the identical workspace (same projects, same time entries).
- No other person's link changes as a side effect.
