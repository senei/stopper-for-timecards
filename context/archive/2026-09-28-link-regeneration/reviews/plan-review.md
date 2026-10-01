<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Regenerate own private link (S-07) Implementation Plan

- **Plan**: context/changes/link-regeneration/plan.md
- **Mode**: Deep (grounding via direct reads/greps in-session; no sub-agent dispatch needed — all
  claimed files/symbols were already read in full during planning)
- **Date**: 2026-09-28
- **Verdict**: SOUND
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | PASS    |
| Plan Completeness     | PASS    |

## Grounding

Paths: 8/8 ✓ (`supabase/migrations/20260921120000_private_links.sql`,
`supabase/migrations/20260922150000_projects_and_timer.sql`, `src/lib/links.ts`,
`src/lib/link-token.ts`, `src/lib/link-cookie.ts`, `src/lib/status-messages.ts`,
`src/pages/w/[token]/projects/[projectId]/delete.astro`,
`src/pages/api/w/[token]/projects/[projectId]/delete.ts`, `src/components/WorkspaceCard.astro`,
`scripts/smoke.mjs`, `supabase/tests/database/private_links.test.sql`).
Symbols: 7/7 ✓ (`create_link`, `start_timer`, `findLinkByToken`, `createLink`, `logAccess`,
`AccessOutcome`, `generateToken`/`hashToken`).
Brief↔plan: ✓ (Key Decisions table matches plan's "Open, resolved UX decision" and Phase 2 contracts
verbatim).
Blast radius: grepped `token_hash` (only referenced inside `src/lib/links.ts`, nowhere else — safe
to add a second writer), `findLinkByToken`/`createLink` callers (5 call sites, all already read;
none need changes), and `WorkspaceCard` usage (`src/pages/dev/kitchen-sink.astro` spreads shared
props into multiple card states — the new additive "Regenerate link" anchor renders harmlessly
there too, no prop changes required).
Progress↔Phase consistency: ✓ — 3 `## Phase N:` headers, 3 matching `### Phase N:` in Progress;
every Success Criteria bullet (1.1–1.2, 2.1–2.6, 3.1) has exactly one matching Progress row; Phase
blocks use plain `- ` bullets only, no checkboxes outside `## Progress`.

## Findings

### O1 — Multi-device cookie staleness after regenerate isn't addressed explicitly

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; no action needed
- **Dimension**: Blind Spots
- **Location**: Phase 2, item 4 (API route)
- **Detail**: If the same person has the link open in two browsers/devices, regenerating in one
  leaves the other's `stopper_link` cookie pointing at the now-dead token. The plan doesn't call
  this out. In practice this self-heals: `resolveCookieLink()` (`src/lib/link-cookie.ts`) already
  clears any cookie whose token no longer resolves on its next use, and the URL itself (not the
  cookie) is the source of truth everywhere mutations happen. No plan change needed — this is the
  same behavior a lost/bookmarked stale link already has today.
- **Decision**: ACCEPTED — existing `resolveCookieLink` self-heal covers this; no plan change.

### O2 — Confirmation page copy left to the implementer

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2, item 3 (confirmation page)
- **Detail**: The plan says the page "states the consequence plainly" but doesn't give exact copy.
  This matches the level of detail the plan gives for `delete.astro`-style pages elsewhere in this
  codebase (the plan names structure/contract, not literal UI strings), so it's consistent with
  house style rather than a gap.
- **Decision**: ACCEPTED — consistent with existing plan-writing convention in this codebase; no
  change needed.
