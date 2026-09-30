# Testing delete-account scope and confirmation guardrails Implementation Plan

## Overview

Protect risk #6 in `context/foundation/test-plan.md` §2 ("the irreversible full-account delete fires with the wrong scope, or without a real confirmation step") — the second half of test-plan §3 Phase 3. S-10 (delete-account) is built, reviewed and archived on `main`, so this is a gap-filling change: three small phases that add real-signal coverage where the research (`research.md`) found none, without touching application code.

## Current State Analysis

- S-10 is on `main` (`context/archive/2026-09-29-delete-account/`): the SQL function `delete_account` (`supabase/migrations/20260928130000_delete_account_timer_lock.sql:14-45`), `deleteAccount` in `src/lib/links.ts:58`, the POST route `src/pages/api/w/[token]/delete-account.ts`, the confirm page and the workspace link.
- The database half of the risk is well protected: `supabase/tests/database/delete_account.test.sql` (19 assertions) and the smoke S-10 section (`scripts/smoke.mjs`, ~552-660) fail under every scope mutation of the SQL function the research inspected.
- The seam between the route and the real database is not protected. `src/__tests__/delete-account-route.test.ts` mocks `@/lib/links` and never asserts which link the route looks up; smoke's cookie always equals the URL token. A route that deletes the cookie's link instead of the URL token's would pass every test (research G1).
- `src/lib/links.integration.test.ts:57-70` covers the wrapper with no child rows and no check that a bystander's children survive. Nothing tests the wrapper's error handling (G2), the malformed-token 404 or the 405 (G3), or the phrase's whitespace trimming (G5).
- The opt-in integration harness exists: `vitest.integration.config.ts` (aliases `@` and `astro:env/server`, includes `src/**/*.integration.test.ts`), `src/test/integration-db.ts` (`hasEnv`, `integrationTitle`, `admin()`, `seedPerson`, `seedProject`, `cleanupSeeded`).
- This change's `change.md` notes are stale (they describe an unmerged branch, the phrase `delete my data`, 18 assertions and a file `src/lib/delete-confirmation.ts` that does not exist); `research.md` supersedes them.

### Key Discoveries:

- Oracle (`research.md` §Oracle): PRD FR-010 (`prd.md:84-85`), `prd.md:78-80,90,102`, and test-plan risk #6 rows (`test-plan.md:56,84`). Everything more specific is a plan decision and is labelled "documents the current plan decision" in tests.
- The route handler is a plain async function of `{params, request, cookies, redirect, rewrite}`; the unit test already calls it that way (`delete-account-route.test.ts:15-32`). Under `vitest.integration.config.ts` every import resolves (alias `@`, the `astro:env/server` stub, `import.meta.env.PROD`), by reading the import graph; it was not executed.
- `seedPerson()` and `seedProject()` exist; there is no helper for time entries or `access_log` rows, so tests insert them through `admin()`. One open entry per link is allowed. A null-link `access_log` row has no owner, so `cleanupSeeded` never removes it: the test deletes it itself, keyed by a unique `user_agent` (`integration-db.ts:72-83`).
- `cleanupSeeded` throws on a real error only; deleting zero rows is fine, so a test that already deleted a link does not break cleanup (`links.integration.test.ts:58-66` already does this).
- Decisions taken in this planning session: non-PRD decisions are labelled "current plan decision" (no PRD edit); the lock and atomicity stay untested (no concurrency test); the cheap route cases are added.

## What We're NOT Doing

- No application-code changes. If a phase finds a bug, stop and ask (a fix would be its own decision); none was found in research.
- No browser or e2e tests (typed-phrase button gate, browser cookie clearing, home-page banner, the confirm form under a real `Origin`): deferred to test-plan §3 Phase 4, "not started".
- No concurrency or atomicity test (decided: a green race test would not prove the lock; the lock is covered by the S-10 implementation review only, and the cookbook says so).
- No PRD edit: the phrase, `access_log` deletion, no audit entry, running-timer deletion, cookie rule, 404 and the leaked-link-holder model stay plan decisions, labelled as such.
- No new tests for behaviour pgTAP and smoke already fail on (scope mutations of the SQL function, grants, bystander log rows).
- No Stryker or CI wiring for the integration suite (stays ad hoc, as in `test-plan.md` §4).
- No cleanup of the stale `delete-account` branch and worktree (`../x10-dev--curse-delete-account`); that is housekeeping outside this change.

## Implementation Approach

Cheapest layer with real signal per gap. The route-to-database seam is TypeScript that calls the database → the opt-in vitest integration harness, calling the real route handler with a fake context (pgTAP would test a copy). Route control flow the mock can express and the wrapper's error handling → hermetic vitest. Cookbook and status → a doc edit. All phases use `/10x-implement`: the code already exists, so there is no first red test to name, and each phase proves its tests protect something with a deliberate-break check (with the integration env vars actually set; an unset run skips everything and proves nothing). Full `npm run lint` runs once, in Phase 2, the last code phase.

## Phase 1: Real-database route test (G1, wrapper with children)

### Overview

One opt-in test file that calls the real POST handler against the local Supabase stack with two people who both own children.

### Changes Required:

#### 1. Real-database route test

**File**: new `src/__tests__/delete-account.integration.test.ts`

**Intent**: Prove the whole delete path (route, real `findLinkByToken`, real `deleteAccount`, real `delete_account`) removes exactly the URL token's person and leaves the other person, and their cookie, alone.

**Contract**: Gated with `describe.skipIf(!hasEnv)(integrationTitle(...))`. A small in-file fake `APIContext` (params, a `FormData` request, a cookie jar with `get` and `delete` spies, `redirect` returning a 303 `Response` with `Location`, `rewrite` spy) like the one in `delete-account-route.test.ts`. Two people A and B from `seedPerson()`, each with a project (`seedProject`), one closed and one open `time_entries` row and one `access_log` row inserted through `admin()`; plus one `access_log` row with a null link id and a unique `user_agent`, deleted in `afterAll` together with `cleanupSeeded`. Cases, with expected values from the oracle (PRD FR-010, `prd.md:90,102`), not from the code:
- a wrong phrase (no field, empty, `delete`) leaves both people's link, projects, entries and log rows untouched;
- `DELETE` posted to A's token while the request's cookie holds B's token: 303 to `/?status=account-deleted`; A's link, projects, entries and log rows are gone; B's link, projects, both entries and log row remain; B's cookie is not cleared;
- a second `DELETE` to A's token is a 404 (`rewrite("/404")`), never a thrown error, and changes nothing.
The `describe` for the non-PRD parts (redirect target, cookie rule, 404 for the old token) says "documents the current plan decision"; the scope and phrase requirement are stated as requirements.

#### 2. Deliberate-break check

**Intent**: Prove each case can fail, with the env vars set.

**Contract**: Worktree-only edits to `src/pages/api/w/[token]/delete-account.ts` and `src/lib/links.ts`, restored with `git checkout --` after each: look the link up by the cookie's token instead of the URL token; drop the phrase check; pass the wrong id to the rpc (for example the token). Each must turn the matching case red.

### Success Criteria:

#### Automated Verification:

- Default suite passes with no database and no env vars, and skips the new file: `npx vitest run`
- Integration suite passes against the local stack: `npm run test:integration` (env from `npx supabase status -o env`: `API_URL` → `SUPABASE_URL`, `SERVICE_ROLE_KEY` → `SUPABASE_SERVICE_ROLE_KEY`)
- Integration suite skips with a clear message when the env vars are unset or the URL is not local
- Lint on the touched files passes: `npx eslint src/__tests__/delete-account.integration.test.ts`

#### Manual Verification:

- Each deliberate break in the list turned its case red, and every file was restored
- No seeded rows remain afterward (the `links` table is empty, including the null-link `access_log` row's `user_agent` marker)

**Implementation Note**: After automated checks pass, pause for manual confirmation before continuing. Checkboxes for these items live in `## Progress`.

---

## Phase 2: Hermetic additions (G1 mock, G2, G3, G5)

### Overview

Cheap hermetic cases for behaviour the real-database test does not need to repeat, plus the wrapper's error handling.

### Changes Required:

#### 1. Route test cases

**File**: `src/__tests__/delete-account-route.test.ts`

**Intent**: Pin the route's lookup target and the small contract details no test states.

**Contract**: Add cases (reusing the file's `call` helper, extended only as needed):
- with the cookie holding token X and the URL token Y, `findLinkByToken` is called with Y and `deleteAccount` with the id returned for Y (asserts the argument the mock currently ignores);
- a malformed token is `rewrite("/404")` and reaches neither `findLinkByToken` nor `deleteAccount`;
- `GET` (and any non-POST) reaches the `ALL` handler and returns 405 with `Allow: POST`;
- a phrase with surrounding whitespace (`" DELETE "`) is accepted, in a `describe` titled "documents the current plan decision (trimmed, case-sensitive phrase)".

#### 2. Wrapper unit tests

**File**: new `src/lib/links.test.ts`

**Intent**: Prove `deleteAccount` calls the right rpc and never turns an error into success.

**Contract**: Hermetic, with `./supabase-admin` mocked so `adminOrThrow()` returns an object whose `rpc` is a spy. Cases: it calls `rpc("delete_account", { p_link_id: <id> })`; a boolean result is returned as is (`it.each` over `true` and `false`); an rpc error rejects; a non-boolean `data` (null, a string) rejects. Expected values come from the wrapper's documented contract (`links.ts` doc comment and the SQL function's boolean return), not from re-implementing it.

#### 3. Full lint once

**Intent**: The last code phase runs the repo-wide lint once, per `lessons.md`.

#### 4. Deliberate-break check

**Contract**: Worktree-only edits, restored after each: make the route look up the cookie's token; drop the malformed-token guard; remove the `ALL` handler; remove `trim()` from the phrase check; make `deleteAccount` return `true` on an rpc error; return the raw rpc data without the boolean check. Each turns a case red.

### Success Criteria:

#### Automated Verification:

- New and changed files pass: `npx vitest run src/__tests__/delete-account-route.test.ts src/lib/links.test.ts`
- Whole default suite passes: `npx vitest run`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`

#### Manual Verification:

- Each deliberate break turned the matching case red and was restored
- Titles for non-PRD decisions read "documents the current plan decision", not "is required"

---

## Phase 3: Cookbook and rollout-status sync

### Overview

Record the patterns and the state so nobody re-derives them, and replace this change's stale notes.

### Changes Required:

#### 1. Test-plan cookbook and status

**File**: `context/foundation/test-plan.md`

**Intent**: Fill the delete-account part of §6.5 and mark risk #6 covered.

**Contract**: §6.5 gains: a real route handler called as a function against the real database (fake `APIContext`, `seedPerson` with children, the null-link log row cleaned by a `user_agent` marker); the "cookie differs from the URL token" fixture as the way to catch a route acting on the wrong link; the plan-decision labels for the delete decisions (phrase `DELETE` trimmed and case-sensitive, `access_log` rows deleted, no audit entry, running timer deleted, cookie cleared only for the deleted token, `/?status=account-deleted`, 404 for the old URL, a leaked-link holder can delete) with the wording "documents the current plan decision"; "the SQL function's lock and atomicity are covered by the S-10 implementation review only" and why a race test was rejected; the browser items deferred to §3 Phase 4 (typed-phrase gate, browser cookie clearing, home-page banner, form under a real `Origin`). §3 row 3: both halves complete. §4: the new integration file. §6.6: a note for the delete-account half. No change to §1–§2.

#### 2. Replace stale change notes

**File**: `context/changes/testing-delete-account-guardrails/change.md`

**Intent**: Remove claims that are now false (unmerged branch, phrase `delete my data`, 18 assertions, `delete-confirmation.ts`).

**Contract**: The `## Notes` body becomes a short pointer to `research.md` and the current facts; frontmatter fields other than `updated` are untouched.

### Success Criteria:

#### Automated Verification:

- Whole unit suite still passes: `npx vitest run`

#### Manual Verification:

- `test-plan.md` §6.5 has the new entries and §3 row 3 shows both halves complete
- The delete-account plan decisions appear in the cookbook with the "current plan decision" wording, and `change.md` no longer contradicts `main`

---

## Testing Strategy

### Unit Tests:

- Route cases with the wrapper mocked (lookup argument, malformed token, 405, trimmed phrase).
- `deleteAccount` error handling with the admin client mocked.

### Integration Tests:

- The real route handler against the local stack with two people who both own children, opt-in.

### Manual Testing Steps:

1. Run each deliberate break and confirm red, then restore.
2. Run the integration suite with the env vars set and with them unset.
3. Confirm the `links` table is empty afterwards.

## Performance Considerations

None: small seeded fixtures, run ad hoc.

## Migration Notes

None: no schema or data changes.

## References

- Research: `context/changes/testing-delete-account-guardrails/research.md`
- Oracle: `context/foundation/prd.md:78-80,84-85,90,102`; `context/foundation/test-plan.md:56,84`; the delete-account decisions in `context/archive/2026-09-29-delete-account/plan.md:40,45,108`
- Code under test: `src/pages/api/w/[token]/delete-account.ts`, `src/lib/links.ts:58`, `supabase/migrations/20260928130000_delete_account_timer_lock.sql`
- Pattern to follow: `src/lib/links.integration.test.ts`, `src/lib/projects.integration.test.ts`, `src/__tests__/delete-account-route.test.ts`, `src/test/integration-db.ts`
- Sibling change: `context/archive/2026-09-29-testing-link-abuse-guardrails/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Real-database route test (G1, wrapper with children)

#### Automated

- [x] 1.1 Default suite passes with no database and no env vars: `npx vitest run` — 859bfc6
- [x] 1.2 Integration suite passes against the local stack: `npm run test:integration` — 859bfc6
- [x] 1.3 Integration suite skips with a clear message when the env vars are unset or the URL is not local — 859bfc6
- [x] 1.4 Lint on the touched files passes: `npx eslint src/__tests__/delete-account.integration.test.ts` — 859bfc6

#### Manual

- [x] 1.5 Each deliberate break turned its case red, and every file was restored — 859bfc6
- [x] 1.6 No seeded rows remain afterward, including the null-link `access_log` row — 859bfc6

### Phase 2: Hermetic additions (G1 mock, G2, G3, G5)

#### Automated

- [x] 2.1 New and changed files pass: `npx vitest run src/__tests__/delete-account-route.test.ts src/lib/links.test.ts`
- [x] 2.2 Whole default suite passes: `npx vitest run`
- [x] 2.3 Lint passes: `npm run lint`
- [x] 2.4 Type check passes: `npx astro check`

#### Manual

- [x] 2.5 Each deliberate break turned the matching case red and was restored
- [x] 2.6 Titles for non-PRD decisions read "documents the current plan decision", not "is required"

### Phase 3: Cookbook and rollout-status sync

#### Automated

- [ ] 3.1 Whole unit suite still passes: `npx vitest run`

#### Manual

- [ ] 3.2 `test-plan.md` §6.5 has the new entries and §3 row 3 shows both halves complete
- [ ] 3.3 The plan decisions appear in the cookbook with the "current plan decision" wording, and `change.md` no longer contradicts `main`
