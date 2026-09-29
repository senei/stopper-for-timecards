# Testing link leak & regeneration guardrails Implementation Plan

## Overview

Protect risk #4 in `context/foundation/test-plan.md` §2 ("a private link is leaked or forwarded, exposing or letting someone impersonate another person") — the first half of test-plan §3 Phase 3. S-07 (link regeneration) is already built and merged, so this is a gap-filling change: five small test phases that add real-signal coverage where the research (`research.md`) found none, without touching application code.

## Current State Analysis

- S-07 is on `main` (merge `cb5c1c6`): `regenerate_link` SQL function, `regenerateLink` and `findLinkByToken` in `src/lib/links.ts:32-75`, the POST route `src/pages/api/w/[token]/regenerate.ts`, and the confirm page. The SQL swap has 12 pgTAP assertions (`supabase/tests/database/regenerate_link.test.sql`); CI smoke covers the HTTP flow (`scripts/smoke.mjs:467-513`).
- Not tested against a real database: the TypeScript layer (`findLinkByToken`, `regenerateLink` hashing) and the `link_id` scoping in `projects.ts:20-24,52-60,84-94` and `timer.ts:117-123`. The one "ownership" test, `delete_project.test.sql:64-80`, runs a hand-written SQL delete, so removing `.eq("link_id", linkId)` from `deleteProject` would not fail it.
- No tests exist for `src/lib/link-cookie.ts` (cookie flags, `resolveCookieLink`).
- The three leak-surface headers are set on four token pages (`[token].astro:16-18`, `grid.astro:18-20`, `regenerate.astro:10-12`, `projects/[projectId]/delete.astro:13-15`), but smoke asserts only the referrer policy, on the workspace page (`smoke.mjs:131-132`).
- RLS is enabled on `links`, `access_log`, `time_entries`, `job_runs` and `projects`, but smoke asserts anon reads only for `links` (`smoke.mjs:456`).
- The opt-in integration harness exists from the previous change: `vitest.integration.config.ts` (aliases `astro:env/server` to `src/test/astro-env-server-stub.ts`), `npm run test:integration`, and `src/lib/weekly-grid-query.integration.test.ts`, which skips unless `SUPABASE_URL` is a local host.

### Key Discoveries:

- Oracle (`research.md` §Oracle): PRD FR-007 (`prd.md:78-79`) and Access Control (`prd.md:102`), roadmap S-07, `parallel-goals.md` Lane 2, test-plan risk #4, and `lessons.md:19` for the headers.
- `create_link` is capped at 10 people, so integration tests must seed people with direct inserts (`links.token_hash = hashToken(token)`), as the weekly-grid test seeds directly, not through `createLink()`.
- The smoke script sets `Origin` itself (`smoke.mjs:45-66`), so it cannot see browser-only failures; those stay for test-plan Phase 4.
- Decisions taken in this planning session (all recorded in the tests as labels, not as PRD changes): lockout by a leaked-link holder is accepted; the old URL returns 404 with no grace window; cookie behavior is tested as a "current decision"; the three headers are required behavior; regenerate audit rows are not tested.

## What We're NOT Doing

- No application-code changes. If a phase finds a bug, stop and ask (a fix would be its own decision); none was found in research.
- No browser or e2e tests (confirm form under a real `Origin`, cookie replacement in a browser): deferred to test-plan §3 Phase 4.
- No test that regenerate writes `access_log` rows (decided: not a required behavior; the PRD has no such line).
- No PRD edit for the lockout decision; it is labeled "documents the current PRD-accepted model" in the tests and in the cookbook.
- No Stryker or CI wiring for the integration suite (stays ad hoc, as in `test-plan.md` §4).
- Delete-account guardrails (risk #6) are a separate change, `testing-delete-account-guardrails`.

## Implementation Approach

Cheapest layer with real signal per gap. TypeScript logic that calls the database → the opt-in vitest integration harness (pgTAP would test a copy). Pure cookie logic → hermetic vitest with the link lookup mocked. Headers → a few lines in the existing HTTP smoke. Database exposure → pgTAP, since the claim is about grants and RLS themselves. All phases use `/10x-implement`: the code already exists, so there is no first red test to name, and each phase proves its tests protect something with a deliberate-break check. Full `npm run lint` runs once, in Phase 4, the last code phase.

## Phase 1: Real-database isolation tests (G1, G2)

### Overview

Integration tests that call the real `findLinkByToken`, `regenerateLink`, `listProjects`, `getProject`, `deleteProject` and `getCurrentTimer` against the local Supabase stack with two people.

### Changes Required:

#### 1. Shared integration helper

**File**: new `src/test/integration-db.ts`; `src/lib/weekly-grid-query.integration.test.ts` (switch to it)

**Intent**: Stop copying the local-only gating and seeding code into every integration test.

**Contract**: Exports the gating flag (local `SUPABASE_URL` host plus service key present) with the skip-title text, an admin-client factory, `seedPerson()` returning `{ linkId, token }` (inserts `links` with `token_hash = hashToken(token)` directly, bypassing the 10-person cap), `seedProject(linkId, name)`, and cleanup of every seeded link's `time_entries`, `projects` and `links`. The existing weekly-grid integration test is switched to it with its assertions unchanged.

#### 2. Link lookup and regeneration tests (G1)

**File**: new `src/lib/links.integration.test.ts`

**Intent**: Prove the TypeScript hashing plus the SQL function behave as the PRD says.

**Contract**: With two seeded people A and B: `findLinkByToken(A.token)` returns A's id; an unknown well-formed token returns null; after `regenerateLink(A.token)` the old token resolves to null (**404 with no grace window**, the decided oracle), the new token resolves to A's same id, and B's token still resolves to B's id; a second `regenerateLink(A.token)` returns `not_found`; a person holding a valid token can regenerate it, in a `describe` titled "documents the current PRD-accepted model: whoever holds a link can regenerate it (lockout accepted)". Expected values come from the sources, not from the code.

#### 3. Ownership scoping tests (G2)

**File**: new `src/lib/projects.integration.test.ts`

**Intent**: Replace the SQL-copy ownership test with one that runs the real functions.

**Contract**: With A owning project `pA` and B owning `pB` (and a time entry for each): `listProjects(A)` contains `pA` and never `pB`; `getProject(A, pB)` is null; `deleteProject(A, pB)` returns false and `pB` still exists afterward; `getCurrentTimer(A)` never returns B's open entry. Expected values follow PRD Access Control ("never anyone else's").

#### 4. Deliberate-break check

**Intent**: Prove each new group can fail, with the env vars actually set (an unset run skips everything and proves nothing).

**Contract**: Worktree-only edits, restored with `git checkout --`: drop `.eq("token_hash", …)` in `findLinkByToken`; pass the old hash as the new one in `regenerateLink`; drop `.eq("link_id", linkId)` in `listProjects`, `getProject`, `deleteProject` and `getCurrentTimer` (one at a time). Each must turn the matching test red.

### Success Criteria:

#### Automated Verification:

- Default suite passes with no database and no env vars: `npx vitest run`
- Integration suite passes against the local stack: `npm run test:integration` (env from `npx supabase status -o env`: `API_URL` → `SUPABASE_URL`, `SERVICE_ROLE_KEY` → `SUPABASE_SERVICE_ROLE_KEY`)
- Integration suite skips with a clear message when the env vars are unset or the URL is not local
- The existing weekly-grid integration test still passes after switching to the shared helper

#### Manual Verification:

- Each deliberate break in the list turned its test red, and every file was restored
- `npx supabase status` shows the expected stack, and no seeded rows (`week-query-it-*`-style test links) remain afterward

**Implementation Note**: After automated checks pass, pause for manual confirmation before continuing. Checkboxes for these items live in `## Progress`.

---

## Phase 2: Cookie unit tests (G3)

### Overview

Hermetic tests for `src/lib/link-cookie.ts`, with `findLinkByToken` mocked.

### Changes Required:

#### 1. Cookie tests

**File**: new `src/lib/link-cookie.test.ts`

**Intent**: Pin the cookie's flags and its stale-cookie handling as current behavior, since the only oracle is the code comment at `link-cookie.ts:24-28`.

**Contract**: A small in-test fake cookie jar implementing the `get`/`set`/`delete` calls the module makes. `setLinkCookie` sets `stopper_link` with `httpOnly`, `sameSite: "lax"`, `path: "/"`, one-year `maxAge`, and `secure` only in production. `resolveCookieLink` cases (`it.each` where they share a property): no cookie → null; malformed cookie → cleared and null; well-formed but unresolvable → cleared and null; resolvable → the token, cookie kept; lookup throws → null, cookie left alone. The `describe` is titled "documents current behavior (oracle is the code comment, not a PRD line)".

#### 2. Deliberate-break check

**Contract**: Worktree-only edits, restored after: remove `httpOnly`; skip `clearLinkCookie` for an unresolvable token; clear the cookie when the lookup throws. Each turns a case red.

### Success Criteria:

#### Automated Verification:

- New file passes: `npx vitest run src/lib/link-cookie.test.ts`
- Default suite passes: `npx vitest run`

#### Manual Verification:

- Each deliberate break turned the matching case red and was restored
- Test titles read as "documents current behavior", not "is required"

---

## Phase 3: Leak-surface headers in smoke (G4)

### Overview

Assert the three required headers on the four token pages in the existing HTTP smoke script.

### Changes Required:

#### 1. Smoke header checks

**File**: `scripts/smoke.mjs`

**Intent**: A regression that drops a header from any token page fails CI, not just the workspace page's referrer policy.

**Contract**: Extend the `request()` result (`smoke.mjs:45-66`) with `cacheControl` and `robotsTag` alongside `referrerPolicy`. Add checks, placed before the regenerate section (which invalidates the token), that `GET /w/<token>`, `/w/<token>/regenerate`, `/w/<token>/grid` and `/w/<token>/projects/<unusedProjectId>/delete` each return `Referrer-Policy: strict-origin`, `Cache-Control: no-store` and `X-Robots-Tag: noindex` (the `lessons.md:19` rule; the delete page needs a project that exists at that point in the script). Existing checks keep their names and order.

### Success Criteria:

#### Automated Verification:

- Syntax and format pass: `node --check scripts/smoke.mjs` and `npx prettier --check scripts/smoke.mjs`
- Smoke passes locally, one lane at a time on the shared stack: `ASTRO_DEV_BACKGROUND=1 npm run smoke:local -- --yes` (about 5 minutes; it resets the local database)

#### Manual Verification:

- Deliberate break: remove one header line from one token page, re-run smoke (or the affected checks), confirm it fails for that page, restore
- CI `smoke` job is green after the push (observed, not run by the agent)

---

## Phase 4: Anon-role exposure test in pgTAP (G5)

### Overview

Prove the "no public access" line at the database: the `anon` role reads nothing from the data tables.

### Changes Required:

#### 1. Anon access test

**File**: new `supabase/tests/database/anon_access.test.sql`

**Intent**: Real grants and RLS, not a copy of application code.

**Contract**: Follow the existing pgTAP conventions (`begin`, `create extension if not exists pgtap with schema extensions`, `plan(N)`, a fresh link-id prefix, `finish`, `rollback`). Seed one row in each of `links`, `projects`, `time_entries`, `access_log` and `job_runs` as the test owner, then `set local role anon` and assert each table returns 0 rows (or is denied). Include a control assertion: after disabling RLS on one table inside the transaction, the same read as `anon` returns the row, showing the test would notice the regression.

#### 2. Full lint once

**Intent**: The last code phase runs the repo-wide lint once, per `lessons.md`.

### Success Criteria:

#### Automated Verification:

- pgTAP passes with the new file: `npx supabase db reset && npx supabase test db`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`

#### Manual Verification:

- The control assertion turned the check red when RLS was disabled (deliberate break confirmed), and `plan(N)` matches the assertion count

---

## Phase 5: Cookbook and rollout-status sync

### Overview

Record the patterns and the state so later phases (and the delete-account change) reuse them.

### Changes Required:

#### 1. Test-plan cookbook and status

**File**: `context/foundation/test-plan.md`

**Intent**: Fill §6.5 (irreversible-action / multi-user-isolation cookbook) with what this change established, and record status honestly for the shared §3 Phase 3 row.

**Contract**: §6.5 gains: the two-person seed pattern (`seedPerson`), the "real function, not a SQL copy" rule for ownership tests, the local-only gating, the decided oracle labels (lockout accepted, 404 with no grace window, cookie = current decision, headers required, audit rows not tested), and the deferred browser paths pointing at §3 Phase 4. §3 Phase 3 row: keep "changes opened" but note `testing-link-abuse-guardrails` complete and `testing-delete-account-guardrails` pending. §4 notes the new gated integration files. No change to §1–§2.

### Success Criteria:

#### Automated Verification:

- Whole unit suite still passes: `npx vitest run`

#### Manual Verification:

- `test-plan.md` §6.5 has the new entries and §3 row 3 shows the split status
- The decisions (lockout accepted, 404, cookie as current decision, headers required, no audit test) appear in the cookbook

---

## Testing Strategy

### Unit Tests:

- Cookie flags and `resolveCookieLink` cases (hermetic).

### Integration Tests:

- `findLinkByToken` / `regenerateLink` and the four `link_id`-scoped functions against the local stack, opt-in.
- pgTAP: `anon` role reads nothing from the five data tables.

### Manual Testing Steps:

1. Run each deliberate break and confirm red, then restore.
2. Run the integration suite with the env vars set and with them unset.
3. Run `smoke:local` once, in one lane.

## Performance Considerations

None: small seeded fixtures, run ad hoc.

## Migration Notes

None: no schema or data changes.

## References

- Research: `context/changes/testing-link-abuse-guardrails/research.md`
- Oracle: `context/foundation/prd.md:78-79,90,102`; `context/foundation/roadmap.md` (S-07); `context/foundation/parallel-goals.md:119-125`; `context/foundation/lessons.md:19`
- Code under test: `src/lib/links.ts:32-75`, `src/lib/projects.ts:17-94`, `src/lib/timer.ts:117-123`, `src/lib/link-cookie.ts:10-47`
- Pattern to follow: `src/lib/weekly-grid-query.integration.test.ts`, `supabase/tests/database/timer_guardrails.test.sql`
- Previous change: `context/archive/2026-09-29-testing-weekly-grid-rounding-aggregation/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Real-database isolation tests (G1, G2)

#### Automated

- [x] 1.1 Default suite passes with no database and no env vars: `npx vitest run` — aa35cf0
- [x] 1.2 Integration suite passes against the local stack: `npm run test:integration` — aa35cf0
- [x] 1.3 Integration suite skips with a clear message when the env vars are unset or the URL is not local — aa35cf0
- [x] 1.4 The existing weekly-grid integration test still passes after switching to the shared helper — aa35cf0

#### Manual

- [x] 1.5 Each deliberate break turned its test red, and every file was restored — aa35cf0
- [x] 1.6 `npx supabase status` shows the expected stack and no seeded rows remain afterward — aa35cf0

### Phase 2: Cookie unit tests (G3)

#### Automated

- [x] 2.1 New file passes: `npx vitest run src/lib/link-cookie.test.ts` — 3ac72ec
- [x] 2.2 Default suite passes: `npx vitest run` — 3ac72ec

#### Manual

- [x] 2.3 Each deliberate break turned the matching case red and was restored — 3ac72ec
- [x] 2.4 Test titles read as "documents current behavior", not "is required" — 3ac72ec

### Phase 3: Leak-surface headers in smoke (G4)

#### Automated

- [x] 3.1 Syntax and format pass: `node --check scripts/smoke.mjs` and `npx prettier --check scripts/smoke.mjs` — 39a3587
- [x] 3.2 Smoke passes locally, one lane at a time: `ASTRO_DEV_BACKGROUND=1 npm run smoke:local -- --yes` — 39a3587

#### Manual

- [x] 3.3 Removing one header line from one token page fails smoke for that page, and the file was restored — 39a3587
- [ ] 3.4 CI `smoke` job is green after the push

### Phase 4: Anon-role exposure test in pgTAP (G5)

#### Automated

- [x] 4.1 pgTAP passes with the new file: `npx supabase db reset && npx supabase test db`
- [x] 4.2 Lint passes: `npm run lint`
- [x] 4.3 Type check passes: `npx astro check`

#### Manual

- [x] 4.4 The control assertion turned the check red when RLS was disabled, and `plan(N)` matches the assertion count

### Phase 5: Cookbook and rollout-status sync

#### Automated

- [ ] 5.1 Whole unit suite still passes: `npx vitest run`

#### Manual

- [ ] 5.2 `test-plan.md` §6.5 has the new entries and §3 row 3 shows the split status
- [ ] 5.3 The decisions (lockout accepted, 404, cookie as current decision, headers required, no audit test) appear in the cookbook
