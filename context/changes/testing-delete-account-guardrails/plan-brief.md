# Testing delete-account scope and confirmation guardrails — Plan Brief

> Full plan: `context/changes/testing-delete-account-guardrails/plan.md`
> Research: `context/changes/testing-delete-account-guardrails/research.md`

## What & Why

Protect test-plan risk #6 (the irreversible account delete fires with the wrong scope, or without a real confirmation step) by filling the gaps the research found. S-10 is built and merged; the SQL function is well tested, but the route's link to the real database is only tested against a mock, so a route that deleted the wrong person's link would pass every test.

## Starting Point

`delete_account` has 19 pgTAP assertions and a smoke section; the route has hermetic tests with the wrapper mocked; the wrapper has one thin integration test. The opt-in real-database harness from the two previous test changes exists (`seedPerson`, `seedProject`, gating, cleanup).

## Desired End State

One opt-in test calls the real route handler against the local database with two people who both own children and shows that exactly the URL token's person is deleted and the other person, and their cookie, are untouched. A few cheap hermetic cases pin the rest of the route and the wrapper's error handling. The cookbook records the patterns and labels the non-PRD decisions "current plan decision".

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Main new layer | Real route handler against the real database, opt-in | The gap is the seam between route and database, which a mock cannot see | Research |
| Non-PRD decisions | Labelled "documents the current plan decision"; no PRD edit | Matches the sibling change; only PRD facts are stated as requirements | Plan |
| Concurrency | No test; lock covered by the implementation review only | A green race test would not prove the lock | Plan |
| Hermetic extras | Add lookup-argument, malformed-token, 405 and trimmed-phrase cases plus wrapper unit tests | Closes gaps G1, G2, G3, G5 at almost no cost | Plan |
| Executor | `/10x-implement` for all phases | The code exists, so there is no first red test to name | Plan |

## Scope

**In scope:** the real-database route test, the extra hermetic route cases, the `deleteAccount` wrapper unit tests, deliberate-break checks, the cookbook and rollout-status update, and replacing this change's stale notes.

**Out of scope:** application-code changes, browser/e2e tests, a concurrency test, a PRD edit, and cleaning the stale `delete-account` branch and worktree.

## Architecture / Approach

Each gap gets the cheapest layer with real signal: the route-to-database seam through the opt-in integration harness, route control flow and wrapper errors through hermetic vitest, and the docs through a plain edit. Every phase proves its tests can fail with worktree-only breaks, run with the integration env vars actually set.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Real-database route test | Two-person, with-children route test plus breaks | The import graph resolves only by reading; may need a small adjustment when run |
| 2. Hermetic additions | Four route cases, wrapper unit tests, full lint | Tests that mirror the code instead of the oracle |
| 3. Cookbook and status sync | §6.5, §3 row 3, `change.md` notes | None significant |

**Prerequisites:** the local Supabase stack, and the env vars from `npx supabase status -o env` for the integration runs.
**Estimated effort:** about 2 to 3 sessions across 3 phases.

## Open Risks & Assumptions

- The claim that the route handler runs under the integration config comes from reading the import graph, not execution; Phase 1 finds out.
- A killed integration run leaves seeded links behind, which blocks the next smoke run until `supabase db reset`.
- The null-link `access_log` row is not covered by `cleanupSeeded`; the test removes it itself.

## Success Criteria (Summary)

- The real route deletes exactly the URL token's person, with both people's children present, and leaves the other person and their cookie alone.
- A wrong or empty phrase leaves all data untouched against the real database.
- Every new test turns red under a targeted break, and the cookbook records the labels and deferred items.
