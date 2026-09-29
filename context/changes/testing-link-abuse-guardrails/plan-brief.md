# Testing link leak & regeneration guardrails — Plan Brief

> Full plan: `context/changes/testing-link-abuse-guardrails/plan.md`
> Research: `context/changes/testing-link-abuse-guardrails/research.md`

## What & Why

Protect risk #4 in `test-plan.md` — a private link is leaked or forwarded — by adding tests where the research found none. S-07 (link regeneration) is already built and merged, so this is gap-filling: no application code changes, five small test phases.

## Starting Point

The SQL swap has 12 pgTAP assertions and CI smoke covers the HTTP flow. Nothing tests the TypeScript layer against a real database (`findLinkByToken`, `regenerateLink`, the `link_id`-scoped queries), the cookie logic, or the leak-surface headers beyond one page. One existing "ownership" test runs a SQL copy, not the real function.

## Desired End State

Breaking the token lookup, the regenerate swap, any `link_id` scope, the cookie handling, a header on any token page, or RLS on a data table turns a test red. The cookbook records the patterns and the decisions taken.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Lockout by a leaked-link holder | Accepted; tested and labeled "documents the current PRD-accepted model" | PRD FR-007 accepts the leak scenario and offers regeneration as the only mitigation. | Plan (user) |
| Old URL after regeneration | 404, no grace window | Matches test-plan risk #4, parallel-goals Lane 2 and the existing smoke and pgTAP. | Plan (user) |
| Cookie behavior | Hermetic tests titled "documents current behavior" | The only oracle is a code comment, not a PRD line. | Plan (user) |
| Headers vs audit rows | Headers required (smoke, four pages); regenerate audit rows not tested | Headers are a team lesson with a past incident; the PRD has no audit-row line. | Plan (user) |
| Layer for TS logic | Opt-in integration harness, real functions, two seeded people | pgTAP would test a copy and cannot see the TS hashing. | Research |
| Anon exposure | pgTAP as the `anon` role, with an RLS-off control | The claim is about grants and RLS themselves. | Plan |
| Browser paths | Deferred to test-plan Phase 4 | No e2e tool exists yet; smoke sets `Origin` itself. | Research |

## Scope

**In scope:** shared integration helper; link lookup, regeneration and ownership-scoping integration tests; cookie unit tests; header checks in smoke; anon pgTAP test; cookbook and status sync.

**Out of scope:** application-code changes, e2e/browser tests, regenerate audit-row tests, PRD edits, CI wiring for the integration suite, delete-account guardrails (separate change).

## Architecture / Approach

Cheapest layer with real signal per gap: real-database vitest for TypeScript that calls the database, hermetic vitest for pure cookie logic, existing smoke for headers, pgTAP for grants and RLS. Every phase is `/10x-implement` (no first red test exists) and proves its tests with a deliberate-break check.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Real-DB isolation tests | Shared helper; lookup/regeneration and ownership-scoping integration tests | Skipped runs prove nothing; env vars must be set for break-checks |
| 2. Cookie unit tests | `link-cookie.test.ts` as "current behavior" | Weak oracle: tests may need editing if the cookie design changes |
| 3. Headers in smoke | Three headers asserted on four token pages | `smoke:local` resets the shared local DB; one lane at a time |
| 4. Anon pgTAP test | `anon_access.test.sql` with an RLS-off control; full lint | Default privileges may make some tables denied rather than empty |
| 5. Cookbook + sync | `test-plan.md` §6.5 and §3 split status | Recording decisions that are not in the PRD |

**Prerequisites:** local Supabase stack running (phases 1, 3, 4).
**Estimated effort:** ~2 sessions across 5 phases.

## Open Risks & Assumptions

- The lockout, 404 and cookie decisions are plan-level, not PRD facts; they are labeled as such and will need editing if the product changes.
- `link-regeneration`'s own manual browser rows (2.4–2.6) are still unticked; nobody has checked the banner flow in a browser.
- Both `link-regeneration` and `delete-account` touch `WorkspaceCard.astro` and `status-messages.ts`; this change touches neither.

## Success Criteria (Summary)

- `npx vitest run` passes with no database; `npm run test:integration` passes against the local stack; `npx supabase test db` passes.
- Each deliberate break turns its test red.
- `test-plan.md` §6.5 is filled in and §3 row 3 shows the split status.
