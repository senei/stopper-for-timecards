---
date: 2026-09-29T15:37:57+02:00
researcher: senei web
git_commit: a64b3fd6a32055a0ad73928fd3ec6ab4280693d0
branch: main
repository: stopper-for-timecards
topic: "Oracle and coverage gaps for delete-account scope and confirmation guardrails (test-plan §3 Phase 3, risk #6)"
tags: [research, testing, delete-account, irreversible-action, isolation, oracle]
status: complete
last_updated: 2026-09-29
last_updated_by: senei web
---

# Research: Delete-account guardrails — oracle and coverage gaps

**Date**: 2026-09-29T15:37:57+02:00
**Researcher**: senei web
**Git Commit**: a64b3fd (S-10 `delete-account` is built, reviewed and archived on `main`; this research reads merged code, not a branch)
**Branch**: main
**Repository**: stopper-for-timecards

## Research Question

For risk #6 in `context/foundation/test-plan.md` §2 ("the irreversible full-account delete fires with the wrong scope, or without a real confirmation step"): what must a test prove (the oracle, from sources), what already protects it, which plausible regressions no current test would catch, and which test layer gives real signal for each gap?

## Summary

1. **The notes in this change's `change.md` are stale and must not be used.** They describe an unmerged `delete-account` branch, a phrase `delete my data`, 18 pgTAP assertions and a file `src/lib/delete-confirmation.ts` (`change.md:15,20`). On `main` all four phases of S-10 are merged, the phrase is `DELETE` (case-sensitive after `trim()`, `src/pages/api/w/[token]/delete-account.ts:7,40`), pgTAP has `plan(19)` (`delete_account.test.sql:5`), and `src/lib/delete-confirmation.ts` does not exist (the phrase check is inline in the route). The old branch and worktree still exist (`../x10-dev--curse-delete-account`, branch `delete-account` at `7e39612`, four planning and Phase 1 commits not on `main`); they are not a source of truth.
2. **The PRD oracle is short.** FR-010 (`prd.md:84-85`): delete every project, every logged time entry and the link, in one explicit confirmed action, with a hard-to-misclick confirmation such as a typed phrase; it frees a slot in the 10-person cap; nobody else's data is touched (`prd.md:90,102`). Everything more specific (the exact phrase, `access_log` deletion, no audit entry, running timer deleted, cookie handling, landing page, 404 for the old URL, leaked-link holder can delete) is a **plan decision**, not a PRD fact, and tests must label it that way, as the sibling change did.
3. **The database half of the risk is well protected; the route-to-database link is not.** pgTAP `delete_account.test.sql` and the smoke S-10 section fail under every scope mutation of the SQL function that was inspected (unscoped link, project, time-entry or access-log delete; forgotten child delete; grants). The two layers that exercise the route (`src/__tests__/delete-account-route.test.ts`, mocked wrapper; smoke) cannot detect a route that deletes the wrong link when the cookie and the URL token differ.
4. **The best new layer is a real-database route test.** The route handler can be called as a plain function under `vitest.integration.config.ts` (alias `@` and the `astro:env/server` stub resolve every import, by reading the import graph; not executed). That gives one opt-in test file that seeds two people with children and asserts the real route deletes exactly one person's rows.
5. **Not testable without a real browser** (deferred to test-plan §3 Phase 4, "not started"): the typed-phrase button gate, the cookie actually cleared by a browser, the banner on the home page, and the confirm form's POST under a real `Origin`. The shipped flow was verified by hand (S-10 plan rows 3.5, 3.6).

## Detailed Findings

### Oracle (from sources, not from code)

- **Scope of deletion**: "permanently delete all of their own data — every project and logged time entry — and their private link itself, in one explicit confirmed action" (`prd.md:84`, FR-010).
- **Confirmation**: "an explicit, hard-to-misclick confirmation step (e.g. typing a confirmation phrase), not a single click" (`prd.md:85`). "e.g." names an example; the PRD fixes no phrase.
- **Irreversibility is the stake**: "one accidental confirm permanently locks someone out and destroys their history" (`prd.md:85`); test-plan §2 risk #6 row and Risk Response Guidance (`test-plan.md:56,84`): "a 200 does not prove scope"; use a multi-user fixture.
- **Cap slot freed**: `prd.md:85` and the FR-007 note superseded by FR-010 (`prd.md:78-80`).
- **Isolation**: nobody sees or affects another person's data (`prd.md:90`, `:102`); each link is that person's identity (`prd.md:28,58,62`). No admin, so nobody else can delete an account (`prd.md:102,106`).
- **The deleted link stops working** is inferred from "no public access" (`prd.md:90`) plus "and their private link itself" (`prd.md:84`). The PRD does not say the old URL returns 404.
- The PRD's Open Questions section says "None" (`prd.md:110`) and is silent on retention of deleted data, audit trail, cookies and landing page.

### Decisions that are plan decisions, not PRD facts (tests must say "documents the current plan decision")

| Decision | Source |
|---|---|
| Phrase `DELETE`; rule `phrase.trim() === "DELETE"` (case-sensitive; a missing or non-string value counts as no phrase) | `context/archive/2026-09-29-delete-account/plan.md:40,45,108`; roadmap `S-10` block; code `src/pages/api/w/[token]/delete-account.ts:7,34-42` |
| The person's `access_log` rows (IP and user agent) are deleted; rows with a null link id stay | archive plan `:44,61,69`; `supabase/migrations/20260928130000_delete_account_timer_lock.sql:37` |
| No deletion audit entry, no `logAccess` call in the route | archive plan `:31,108`; route file has no `logAccess` |
| A running timer is deleted with everything else (a default chosen without asking) | archive plan `:40` |
| The `stopper_link` cookie is cleared only when it holds the deleted token | archive plan `:40,108`; route `:57-60` |
| Landing page `/?status=account-deleted` with a success banner | archive plan `:110-116`; `status-messages.ts` |
| The old and deleted token URLs return 404 | archive plan `:18` and smoke; not a PRD line |
| Whoever holds a link can delete that person's data, and no record is kept | archive plan `:31,34`; impl-review F8c. The PRD accepts the leak scenario only for regeneration (`prd.md:79`), so "PRD-accepted" would overstate it; suggested label: "documents the current accepted model" |

What must stay a **requirement** in tests, because the PRD states it: no phrase, an empty phrase or a wrong phrase deletes nothing; exactly the requester's projects, time entries and link go; nobody else's data changes; a slot is freed.

### What ships (S-10, on `main`)

- **Database**: `delete_account(p_link_id uuid) returns boolean`, security definer, service-role only; takes the advisory lock `hashtext('public.timer:' || id)`, locks the link row `for update`, deletes `time_entries`, `projects`, `access_log`, then `links`; returns false when the id matches no link (`supabase/migrations/20260928130000_delete_account_timer_lock.sql:14-45`; first version in `20260928120000_delete_account.sql`).
- **Library**: `deleteAccount(linkId)` in `src/lib/links.ts:58` (calls the rpc, throws on an rpc error or a non-boolean).
- **Route**: `POST /api/w/[token]/delete-account` (`src/pages/api/w/[token]/delete-account.ts`): malformed token 404; lookup error 503; no link 404; wrong phrase 303 to the confirm page with `error=confirm-phrase`; delete error 303 to the confirm page with `error=1`; delete returning false 404; success clears the cookie only when it equals the token and redirects 303 to `/?status=account-deleted`.
- **UI**: confirm page `src/pages/w/[token]/delete-account.astro` (button disabled until the field reads DELETE), workspace link `src/components/WorkspaceCard.astro:252-255`, home-page banner `src/pages/index.astro:27`.

### What already protects the risk

| Behaviour | Test | Real DB? |
|---|---|---|
| SQL scope: owner's link, projects, time entries and access-log rows gone; bystander's link, project, two entries and log row untouched; null-link log row untouched; repeat and unknown id return false; freed slot at the cap; grants | `supabase/tests/database/delete_account.test.sql` (19 assertions) | yes |
| Route control flow: wrong phrases (none, empty, lower case, extra words) delete nothing; DELETE calls the delete once and redirects; cookie cleared only for the deleted token; unknown link 404; delete throws, returns false, lookup fails | `src/__tests__/delete-account-route.test.ts` (10 tests) | no, wrapper mocked |
| Wrapper: token stops resolving, stayer still resolves, second call false | `src/lib/links.integration.test.ts:57-70` (no children seeded, no bystander child check) | yes, opt-in |
| HTTP flow: refused phrases change no counts; DELETE redirects home; both tokens 404; exactly the owner's rows go; bystander's project and entry survive; log rows for the deleted link gone; cookie cleared; new link creatable; leak headers on the confirm page | `scripts/smoke.mjs` (S-10 section, ~552-660) | yes, needs a fresh local DB |

### Regressions no current test catches (deliberate-break analysis, by reading; nothing was run)

| # | Regression | Why nothing fails | Oracle |
|---|---|---|---|
| G1 | The route looks up or deletes the cookie's link instead of the URL token's | The route test mocks the lookup and never asserts its argument; smoke's cookie equals the URL token, so both links are the same | FR-010 scope; `prd.md:90,102` |
| G2 | The real wrapper mishandles an rpc error or a non-boolean result (returns true or false instead of throwing) | The route test mocks the wrapper; the integration test never forces an rpc error | none stated; reliability of an irreversible action |
| G3 | Malformed token to the delete API is not a 404; non-POST methods are not 405 | The route test always uses well-formed tokens; smoke never posts a malformed token to this route | consistency with the other token routes (test-plan §6.5) |
| G4 | Bystander `access_log` rows and null-link rows are deleted | Only pgTAP checks them; smoke does not seed them | plan decision; pgTAP already covers it |
| G5 | `trim()` removed from the phrase check (a trailing space rejected) | No test posts `"DELETE "` | plan decision (current behaviour) |
| G6 | The lock or the row lock is removed from the function; the deletes are split across separate calls (atomicity) | Every DB test checks only the final state, and no test runs two sessions | none in the PRD |
| G7 | The confirm page's button gate, form field name and action; the workspace link is removed | No test renders the page; smoke posts directly | browser only, or grep-level |

A route in which the delete forgets or over-reaches a table is caught by pgTAP and smoke (mutation rows 1-8 all fail some test); the same holds for a phrase check that is removed, made case-insensitive or moved after the delete (route test and smoke).

### Test-layer feasibility (by reading the import graph; not executed)

- **Real route in the opt-in suite**: `delete-account.ts` imports `@/lib/link-cookie`, `@/lib/link-token`, `@/lib/links`, `@/lib/status-messages` and a type-only `astro` import. `@` is aliased in `vitest.integration.config.ts:9`; `astro:env/server` (reached through `supabase-admin.ts:2`) is aliased to `src/test/astro-env-server-stub.ts` in `:10`; `import.meta.env.PROD` (`link-cookie.ts:16`) is provided by vitest. The unit test already calls `POST` as a function with a fake `APIContext` (`delete-account-route.test.ts:15-32`); the same fake works against the real database. A new `src/**/*.integration.test.ts` file is picked up by `vitest.integration.config.ts:14` and excluded from the default run (`vitest.config.ts:13`), so it stays opt-in.
- **Seeding**: `seedPerson()` and `seedProject()` exist (`src/test/integration-db.ts:49-66`); there is no helper for time entries or `access_log` rows, so a test inserts them through `admin()` (patterns: `projects.integration.test.ts:17-24`, `delete_account.test.sql:28-35`). One open entry per link is allowed. A null-link `access_log` row has no owner, so `cleanupSeeded` would never remove it: the test must delete it itself, keyed by a unique `user_agent`.
- **Cleanup**: `cleanupSeeded` deletes `time_entries`, `projects`, `access_log`, then the link, and throws on a real error (`integration-db.ts:72-83`); deleting zero rows is not an error, so a test that already deleted a link does not break cleanup (an existing test does exactly this, `links.integration.test.ts:58-66`). A killed run leaves seeded links behind; smoke refuses to run while any link exists (`smoke.mjs:116-119`), so a `supabase db reset` is the cleanup.
- **Concurrency**: `Promise.all` of the rpc and an insert issues two real requests, but the interleaving is not controllable, so a green run does not prove the lock and a red run is flaky evidence. No test in the repo races two operations. If wanted, it can only be a labelled best-effort test.

## Code References

- `context/foundation/prd.md:84-85` — FR-010 (scope, confirmation, irreversibility)
- `context/foundation/prd.md:78-80,90,102,106,110` — cap slot, isolation, no admin, no open questions
- `context/foundation/test-plan.md:56,84,97,185-199` — risk #6 rows, Phase 4 "not started", §6.5 cookbook and decided labels
- `supabase/migrations/20260928130000_delete_account_timer_lock.sql:14-45` — current `delete_account`
- `supabase/tests/database/delete_account.test.sql:5` — `plan(19)`
- `src/pages/api/w/[token]/delete-account.ts:7,14-64` — route
- `src/lib/links.ts:58` — `deleteAccount`
- `src/__tests__/delete-account-route.test.ts` — hermetic route tests (wrapper mocked)
- `src/lib/links.integration.test.ts:57-70` — real-DB wrapper test (no children)
- `src/test/integration-db.ts:49-83` — `seedPerson`, `seedProject`, `cleanupSeeded`
- `vitest.integration.config.ts:9-14` — alias, stub, include glob
- `scripts/smoke.mjs` (S-10 section, ~552-660) — HTTP flow

## Architecture Insights

- The safety of the irreversible action rests on two independent guards: the server-side phrase check (route) and the scoped SQL delete (function). The button gate is only a slip guard.
- Existing layers cover each guard separately (route with a mocked wrapper; function against real Postgres); the seam between them (the route passing the right link id to the real function) is where the uncovered wrong-scope regression G1 lives.
- The sibling change's pattern applies unchanged: two-person seed, "real function, not a SQL copy", local-only gating, and "documents the current decision" labels (`test-plan.md:185-199`).

## Historical Context (from prior changes)

- `context/archive/2026-09-29-delete-account/plan.md` — the decisions above and the "not doing" list (no cascade, no audit entry, no e2e code).
- `context/archive/2026-09-29-delete-account/reviews/impl-review.md` — F1 (lock key fixed by a second migration), F2 and F3 (smoke bystander and cookie pre-check), F4 (route failure-path tests), F7 (banner lost when another valid link's cookie exists; accepted), F8c (no audit trail, no throttling; accepted).
- `context/archive/2026-09-29-testing-link-abuse-guardrails/research.md` and `plan.md` — how the oracle labels and the two-layer strategy were applied to risk #4.
- Stale: `context/changes/testing-delete-account-guardrails/change.md:15,20` (see Summary point 1). Contradicted claims: branch not on `main`; Phases 2-4 not built; phrase `delete my data`; 18 assertions; `src/lib/delete-confirmation.ts`.

## Related Research

- `context/archive/2026-09-23-first-timer-start-audit/research.md` — the original FK findings for S-10.
- `context/archive/2026-09-29-testing-link-abuse-guardrails/research.md` — sibling oracle and gap analysis.

## Open Questions

For the planning step (user decisions; none blocks planning):

1. **Label wording** for the non-PRD decisions (proposed: "documents the current plan decision"), and whether to promote any of them to the PRD first (phrase, `access_log` deletion, no audit). The sources leave all of them undecided.
2. **Concurrency**: include a best-effort, labelled race test (non-deterministic, cannot prove the lock) or leave the lock untested?
3. **Route-level extras**: add G3 (malformed token 404, 405) and G5 (`"DELETE "` accepted) as small cases to the existing route test file, or keep this change to the real-DB route test only?
4. **Housekeeping, outside this change**: the stale `delete-account` branch and worktree, and the stale `change.md` notes here, should be cleaned up or replaced by this research.
5. Not verified by execution: the real-DB route test's import resolution (by reading only) and that `afterAll` cleanup runs after a failed `beforeAll`.
