---
project: "Stopper for Timecards"
version: 1
status: draft
created: 2026-09-28
---

# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-09-29

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in area Y"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/`,
`scripts/`, `workers/` (main hand-written codebase roots; `node_modules`,
`dist`, `build`, `.astro`, `.wrangler` excluded).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                              | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Time gets logged against the wrong project                                                           | High   | High       | PRD Guardrails ("project association must be correct — time logged against the wrong project defeats the entire purpose"); interview Q1 (top named worry); hot-spot dir `src/lib/` (43 commits/30d)                                                                                               |
| 2   | A timer switch or stop silently drops or double-counts a segment                                     | High   | High       | PRD Guardrails (15-minute precision) + Success Criteria ("switch between projects... with time correctly allocated"); interview Q1 and Q3 (timer logic named as the area changed without confidence); hot-spot dir `src/lib/` (43 commits/30d)                                                    |
| 3   | A real-browser-only failure (forms, redirects, cookies) ships because automated checks can't see it  | High   | High       | Interview Q2 — confirmed past incident (a `Referrer-Policy: no-referrer` page broke real-browser form submission with a 403 while the HTTP smoke script, which sets `Origin` itself, passed clean; recorded in `context/foundation/lessons.md`); interview Q4 (named as the scariest current gap) |
| 4   | A private link is leaked or forwarded, exposing or letting someone impersonate another person        | High   | Medium     | PRD FR-007 Socrates note (explicit leak/forward scenario considered and accepted as a real threat); PRD Access Control section (a link is the sole identity — no accounts, no passwords)                                                                                                          |
| 5   | The weekly grid shows wrong per-day rounded totals or the wrong Mon–Sun boundary                     | High   | Medium     | PRD Guardrails (15-minute precision) + roadmap S-06 (still `proposed`, with an explicitly open Mon–Sun timezone question); prior risk log (superseded) flagged the same rounding-precision concern                                                                                                |
| 6   | The irreversible full-account delete fires with the wrong scope, or without a real confirmation step | High   | Low        | PRD FR-010 Socrates note ("fully irreversible... one accidental confirm permanently locks someone out and destroys their history"); roadmap S-10 risk note ("the one mistake in this codebase with no undo path at all")                                                                          |

**Impact × Likelihood rubric** — High/Medium/Low, scored coarsely so two
readers agree on the same row (see `references/test-plan-schema.md` §2 in
the `10x-test-plan` skill for the full rubric text).

Risks #1–#3 are High × High and protected first. #4 and #5 are High ×
Medium. #6 is High × Low but kept in the top set on explicit PRD/roadmap
signal: it is a single, fully irreversible, no-recovery action, which the
product's own authors singled out as the highest-consequence click in the
app — this is a testable behavior with a defined intended outcome (FR-010),
not a cloud-outage scenario that belongs to observability instead.

**Abuse / security lens.** This product has no accounts, but a private
link _is_ the credential. Risk #4 is the abuse-lens row: it is framed
around leak/forward (the threat PRD FR-007 itself names), not brute-force
guessing, since token unguessability alone does not address a forwarded or
copy-pasted link.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                   | Must challenge                                                                                                                                                                                                                                                        | Context `/10x-research` must ground                                                                                                                  | Likely cheapest layer                                                             | Anti-pattern to avoid                                                                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1   | Every timer segment attributes to exactly the project the caller named (new project, reused project, case variations)                                                         | "The FK on `project_id` guarantees correct attribution" — a foreign key only proves the id exists, not that it's the _right_ id                                                                                                                                       | The project resolution/upsert-by-name entry point and whether name matching is case-insensitive/trimmed consistently                                 | integration (database-level)                                                      | Asserting against whatever project id the implementation happens to resolve to, instead of an independently-named expected project (oracle problem)                                     |
| #2   | A start→switch→switch→stop sequence produces time-entry rows whose durations sum losslessly to elapsed wall-clock time, with no gap and no overlap                            | "The one-open-timer-per-link constraint guarantees segments don't overlap" — that index blocks two _open_ rows, it says nothing about whether a switch correctly closes the prior segment before opening the next, or what a partial failure mid-switch leaves behind | The exact write sequence performed on switch (close-then-open vs. one transaction) and how a partial failure is handled                              | integration                                                                       | Checking only total durations without checking segment boundary timestamps; copying the current implementation's own rounding as the expected value                                     |
| #3   | A real browser can complete open-link → start → switch → stop through actual UI interaction (forms, navigation, cookies), not just HTTP requests                              | "The HTTP smoke script passing means the browser flow works" — it sets `Origin` itself, which is exactly what hid the shipped Referrer-Policy bug                                                                                                                     | Which pages/forms are in scope for the flow, and how a browser-driven test authenticates via the link token                                          | e2e (real browser context) — no cheaper layer sees this failure class             | An e2e test that also manually sets headers/origin, reproducing the same blind spot the smoke script has today                                                                          |
| #4   | Holding another person's link is the only way to see their data; regenerating a link invalidates the old one immediately, with no grace window                                | "An unguessable token means leakage doesn't matter" — PRD FR-007 explicitly treats forwarding/leaking, not brute-forcing, as the real threat                                                                                                                          | Token generation/lookup path; whether any response ever surfaces another user's identifiers; the regeneration invalidation mechanism once S-07 ships | integration now; e2e once link regeneration (S-07) ships                          | Only testing that a _valid_ link works, never that an invalidated or another person's link is rejected                                                                                  |
| #5   | Given a set of raw start/switch/stop timestamps, the produced grid shows correct per-day rounded-up totals, laid out in the exact Project/Task/Type/Work Type × Mon–Sun shape | "Rounding each segment and summing equals rounding the daily total" — the resolved rule is per-day rounding, not per-segment; per-segment rounding silently overstates hours                                                                                          | The resolved Mon–Sun timezone boundary (currently an open roadmap question) and the per-day aggregation entry point once S-06 is planned             | unit (rounding/aggregation function) + integration (grid assembly from real rows) | Hardcoding expected grid values by reading them off a manual run of the code under test, instead of computing them independently from raw timestamps and the written-down rounding rule |
| #6   | Delete-all removes exactly — all and only — the requesting person's projects, time entries, and link; the action cannot fire without the confirmation step succeeding         | "A 200 response means deletion succeeded and was correctly scoped" — must verify no other user's rows were touched, not only that the caller's rows are gone                                                                                                          | The confirmation UX once decided, and the exact deletion scope/transaction once S-10 is planned                                                      | integration (seeded multi-user fixture) + one e2e path for the confirmation UX    | Testing deletion against a single-user fixture, where "no rows left" cannot distinguish correct scoping from an accidental delete-everything bug                                        |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                                     | Goal (one line)                                                                                                                            | Risks covered | Test types         | Status                                                                                                                                                            | Change folder                                                                                                                                                                |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Timer precision & attribution regression guard | Harden the two guardrail risks the team trusts least, extending existing db coverage with deliberate-break checks                          | #1, #2        | integration        | complete                                                                                                                                                          | `context/archive/2026-09-28-testing-timer-guardrails/`                                                                                                                       |
| 2   | Weekly grid rounding & aggregation             | Pin the rounding rule and Mon–Sun boundary of the weekly grid (S-06, already built) with oracle-derived tests, and cover its overlap query | #5            | unit + integration | complete                                                                                                                                                          | `context/archive/2026-09-29-testing-weekly-grid-rounding-aggregation/`                                                                                                       |
| 3   | Irreversible-action & link-abuse guardrails    | Cover irreversible full-account delete (S-10) and link leak/regeneration (S-07) before/alongside those slices                              | #6, #4        | integration + e2e  | both halves complete — `testing-link-abuse-guardrails` (#4) and `testing-delete-account-guardrails` (#6); their real-browser paths landed in Phase 4 (§6.3, §6.5) | `context/archive/2026-09-29-testing-link-abuse-guardrails/` (#4), `context/archive/2026-09-29-testing-delete-account-guardrails/` (#6)                                       |
| 4   | Real-browser flow coverage                     | Bootstrap a real-browser (e2e) layer to close the proven blind spot that HTTP-only smoke checks can't see                                  | #3            | e2e                | complete                                                                                                                                                          | none: set up directly on 2026-10-01 with `/10x-e2e-setup` and `/10x-e2e` (specs in `tests/e2e/`, record in `context/foundation/test-stack.md`); CI wiring still open, see §5 |

Order rationale: Phase 1 protects the highest-ranked risks first at the
cheapest incremental cost (existing pgTAP coverage already exists to
extend). Phases 2–3 are sequenced to land alongside their still-`proposed`
roadmap slices (S-06, then S-10/S-07), so tests exist before or with the
code rather than trailing it. Phase 4 (real-browser/e2e bootstrap) moves to
last by explicit team decision (2026-09-28) — despite being the most
evidence-backed gap (an incident that already shipped, see Risk #3), the
team chose to sequence the roadmap-linked phases first. No AI-native phase
is included — the interview (Q5) explicitly excluded visual/styling test
budget, and nothing else in the risk map clears cost × signal for a
vision-review layer.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer                                     | Tool                                            | Version             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ----------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit                                      | Vitest                                          | ^5.0.1              | `src/lib/*.test.ts`, `src/__tests__/`; happy-dom env                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| integration (application code vs real DB) | Vitest, opt-in (`vitest.integration.config.ts`) | ^5.0.1              | `src/**/*.integration.test.ts`; needs the local Supabase stack and `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (from `npx supabase status -o env`: `API_URL` / `SERVICE_ROLE_KEY`); run with `npm run test:integration`; **ad hoc gate — not in CI and not in the default `npm test`**, skips when the env vars are absent; shared seeding/gating in `src/test/integration-db.ts`; files: `weekly-grid-query`, `links`, `projects` (`src/lib/*.integration.test.ts`) and `delete-account` (`src/__tests__/delete-account.integration.test.ts`) |
| integration (database)                    | pgTAP via `supabase test db`                    | Supabase CLI ^2.119 | `supabase/tests/database/`; runs against a real local Postgres, no mocking                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| HTTP smoke                                | custom Node script (`scripts/smoke.mjs`)        | n/a                 | exercises the deployed preview over HTTP; sets its own `Origin` header — this is the known blind spot behind Risk #3                                                                                                                                                                                                                                                                                                                                                                                                                            |
| e2e (real browser)                        | Playwright Test                                 | ^1.63.0             | `playwright.config.ts`, specs in `tests/e2e/`; `npx playwright test`; builds and previews the app itself on port 4321 (`E2E_PORT` overrides); needs the local Supabase stack and a local `.env` with `SUPABASE_SERVICE_ROLE_KEY`; **local only, not in CI yet**; details in `context/foundation/test-stack.md`                                                                                                                                                                                                                                  |
| lint + typecheck                          | ESLint (type-aware) + `astro check`             | eslint ^10.10.0     | already wired in CI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**Stack grounding tools (current session):**

- Docs: none available in current session; checked: 2026-09-28
- Search: WebSearch tool available, not used for this write (no stack-choice question needed it); checked: 2026-09-28
- Runtime/browser: no Playwright/browser-test MCP exposed; `playwright-cli` 0.1.22 installed globally with its command skill at `.claude/skills/playwright-cli/`; checked: 2026-10-01
- Provider/platform: Cloudflare MCP available (`mcp__cloudflare__authenticate`) — relevant to the Workers/Pages deploy target if a future gate needs log/deploy inspection; not used yet; checked: 2026-09-28

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                                                  | Where                                                                | Required?                                                                  | Catches                                                                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| lint + typecheck                                      | local + CI (`ci.yml`)                                                | required                                                                   | syntactic / type drift                                                                                                          |
| unit (Vitest, `npx vitest run`) + integration (pgTAP) | local + CI (`ci.yml`)                                                | required                                                                   | logic and data-integrity regressions; the Vitest-vs-database integration run (`npm run test:integration`) is ad hoc, local only |
| pre-prod HTTP smoke                                   | CI, against built preview (`ci.yml` `smoke` job)                     | required                                                                   | environment/deploy-specific failures reachable over HTTP                                                                        |
| e2e on critical flows (real browser)                  | local today (`npx playwright test`); CI on PR once an e2e job exists | required after §3 Phase 2 — layer built (§3 Phase 4), CI job not yet wired | browser-only failures (forms, redirects, cookies) that HTTP smoke cannot see                                                    |
| post-edit hook                                        | local (agent loop)                                                   | recommended                                                                | regressions at edit time — configured in Lesson 3, not this lesson                                                              |
| multimodal visual review                              | CI on PR                                                             | not planned                                                                | excluded — interview Q5 declined visual/styling test budget                                                                     |
| visual diff (deterministic)                           | CI on PR                                                             | not planned                                                                | same exclusion as above                                                                                                         |

## 6. Cookbook Patterns

How to add new tests in this project. Patterns that already exist in the
codebase are documented now; patterns the rollout will add read "TBD — see
§3 Phase N" until that phase ships.

### 6.1 Adding a unit test

- **Location**: `src/lib/` next to the module under test, or `src/__tests__/` for cross-cutting cases.
- **Naming**: `<module>.test.ts`.
- **Reference test**: `src/lib/project-name.test.ts`.
- **Run locally**: `npm test` (or `npx vitest run <path>` for a single file).
- **Rounding/boundary cases**: see §6.4.

### 6.2 Adding a database integration test

- **Location**: `supabase/tests/database/`.
- **Policy**: pgTAP tests run against a real local Postgres via the Supabase CLI — no mocking; assert directly on rows and constraints.
- **Reference test**: `supabase/tests/database/projects_and_timer.test.sql`.
- **Run locally**: `npx supabase test db` (matches the CI `smoke` job).
- **Deliberate-break pattern**: when a guardrail is a DB constraint (a unique index, a partial index), don't just call the RPC that's supposed to trip it — prove the constraint itself is the backstop by bypassing the RPC with a direct `insert`/`update` and asserting the resulting SQLSTATE (e.g. `23505`). Reference test: `supabase/tests/database/timer_guardrails.test.sql` (established in §3 Phase 1). Before committing a new test written this way, break the production code it protects (a worktree-only edit, never staged), confirm the test goes red, then restore — this is the same check `/10x-implement`'s gate (b) runs automatically for any phase that adds or changes tests.

### 6.3 Adding a real-browser (e2e) test

Set up on 2026-10-01 with `/10x-e2e-setup`; the facts live in `context/foundation/test-stack.md` (`## E2E`).

- **Location and naming**: `tests/e2e/<name>.spec.ts`, one test per risk facet. The header comment names the risk id, the facet covered and `seed: tests/e2e/seed.spec.ts`.
- **Reference tests**: `tests/e2e/seed.spec.ts` (risk #3, open link → start → stop), `tests/e2e/delete-account.spec.ts` (#6, confirmation UX), `tests/e2e/regenerate-link.spec.ts` (#4, regenerate flow).
- **Run locally**: `npx playwright test` (one spec: `npx playwright test tests/e2e/<name>.spec.ts`). The config builds and previews the app itself, so a cold run takes about 3 minutes; keep port 4321 free (or set `E2E_PORT`), because a server already listening there is silently reused. Needs the local Supabase stack and a local `.env` with `SUPABASE_URL` (local) and `SUPABASE_SERVICE_ROLE_KEY`; specs skip when `hasEnv` is false.
- **No login**: identity is the private link. Seed people with `seedPerson()` and `seedProject()` from `src/test/integration-db.ts` (direct inserts, so Turnstile, the 3-links-per-10-minutes throttle and the 10-person cap do not apply), and open `/w/<token>`. A test with a second person (a bystander) can tell correct scoping from "affects everyone".
- **Asserted cleanup**: `afterEach` calls `cleanupSeeded()`, which throws on failure. A page that returns 404 logs a null-link `access_log` row that `cleanupSeeded` never removes, so give the file a unique user agent (`test.use({ userAgent })`) and delete its rows by it, asserting `error` is null. Extra browser contexts do not inherit `use` options: pass `baseURL` (`test.info().project.use.baseURL`) and the same `userAgent`.
- **Locators**: `getByRole`, `getByLabel`, `getByText` only; wait for state (`toBeVisible`, `waitForURL`), never for time.
- **Deliberate-break**: stop any server and confirm port 4321 is free so `webServer` rebuilds, edit one production line (use a `trap` that runs `git checkout -- <file>`), run the spec, and require the red to land on the risk assertion, not on a timeout or a database error. Then check `links`, `projects` and `access_log` are empty. Verified so far: delete-account (typed-phrase gate removed → red at `toBeDisabled`; route skips `deleteAccount` → red, deleted link still answers 200), regenerate-link (`regenerate_link` keeps the old token hash → red at the banner).
- **After a Docker or Supabase restart**: wait until PostgREST serves tables (`PGRST002 … schema cache` means it is still loading), or lookups fail with 503 and look like test failures.
- **Open**: no e2e job in CI yet (§5); the 404 assertion for the old regenerated link is covered by pgTAP and smoke but was not break-verified in the browser; see §6.5 for the other gaps.

### 6.4 Adding a weekly-grid / rounding-aggregation test

- **Oracle first**: write expected values by hand from the written rule, never by running the code. Rule (roadmap S-03, `context/foundation/roadmap.md`): per day, per (Project/Task/Type/Work Type) row, sum first and round once, **always up** to the next 15 minutes (15:00 → 15, 15:01 → 30). Day and week boundaries are UTC — a current plan decision (weekly-grid-summary), not a proven product rule, so those tests say "documents the current UTC decision" in their `describe` title and comments.
- **Unit location**: `src/lib/weekly-grid.test.ts` (`buildWeeklyGrid`), `src/lib/weekly-grid-retention.test.ts` (`earliestNavigableWeekStart`). Reference: the boundary and edge groups in `weekly-grid.test.ts`. Use `it.each` for cases that check one property (rounding boundaries, exact-15-minute totals split into many segments).
- **Float trap**: sum durations in integer milliseconds; summing fractional minutes made 45 × 20 s round to 30 instead of 15 (fixed in this change, first found via research and driven test-first).
- **Query layer**: `fetchWeekEntries` is a PostgREST call, so pgTAP would only test a copy of its filter. Use `src/lib/weekly-grid-query.integration.test.ts` (real function, real local DB, seeded links/projects/entries, cleanup in `afterAll`). Run: `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run test:integration`. Open-entry cases need their own link (one open entry per link).
- **Deliberate-break**: before committing, break the production line in a worktree-only edit (`ceil`→`round`, drop the day-end clamp, change `.lt`/`.gt`, drop the link scope), confirm red, restore. Run the integration break-check with the env vars actually set — with them unset every test is skipped and proves nothing.
- **Mutation check (Stryker)**: tried once on 2026-09-29 for `src/lib/weekly-grid.ts` (`npx stryker run --mutate src/lib/weekly-grid.ts --testRunner vitest`, `@stryker-mutator/core` + `vitest-runner` 10.0.0, installed with `--no-save`) against vitest 5.0.1. It reported 0 of 64 mutants killed even though manual breaks of the same lines turn tests red, so the result is invalid and was not triaged. Treat the manual deliberate-break checks as the current gate; retry when the runner supports vitest 5.
- **Known gaps**: the week helpers inside `src/pages/w/[token]/grid.astro` (`utcMondayOf`, `parseViewedWeekStart`, `toWeekParam`, `formatMinutes`) are untested and `utcMondayOf` is duplicated from `weekly-grid-retention.ts`; extracting them is a production refactor. The PRD Business Logic section (`prd.md:98`) was updated on 2026-09-29 to state the round-up-per-day rule and the UTC day boundary, so the PRD, roadmap and code now agree; the roadmap S-06 timezone unknown is still listed as open.

### 6.5 Adding an irreversible-action or multi-user-isolation test

Established by `testing-link-abuse-guardrails` (risk #4); `testing-delete-account-guardrails` (risk #6) reused these patterns and added the entries from "Real route handler" to "Delete-account decisions" below.

- **Two-person seed**: `seedPerson()` in `src/test/integration-db.ts` inserts a `links` row directly (`token_hash = hashToken(token)`) and returns `{ linkId, token }`; `seedProject(linkId, name)` adds a project. Seed with direct inserts, not `createLink()`, because `create_link` is capped at 10 people. Every test gets two people, A and B, so scoping bugs show up; a single-person fixture cannot tell correct scoping from "returns everything".
- **Real function, not a SQL copy**: ownership and lookup rules that live in TypeScript (`findLinkByToken`, `regenerateLink`, and the `link_id`-scoped `listProjects`, `getProject`, `deleteProject`, `getCurrentTimer`) are tested by calling the real function against the local stack (`src/lib/links.integration.test.ts`, `src/lib/projects.integration.test.ts`). A pgTAP test with a hand-written SQL delete would still pass if `.eq("link_id", …)` were removed from the code.
- **Local-only gating**: the shared helper skips every integration test unless `SUPABASE_URL` is a local host and the service key is set, so a run against a real project cannot delete data. Run the break-check with the env vars actually set; an unset run skips everything and proves nothing.
- **Database exposure**: the claim "no public access" is about grants and RLS themselves, so it is a pgTAP test (`supabase/tests/database/anon_access.test.sql`): as the `anon` role, read one seeded row per data table and expect 0 rows, plus a control that disables RLS inside the transaction and shows the same read then returns the row.
- **Cookie logic**: pure logic with the link lookup mocked and an in-test fake cookie jar (`src/lib/link-cookie.test.ts`). Its oracle is the code comment, not a PRD line, so the `describe` says "documents current behavior".
- **Leak-surface headers**: `scripts/smoke.mjs` asserts `Referrer-Policy: strict-origin`, `Cache-Control: no-store` and `X-Robots-Tag: noindex` on the four token pages (workspace, regenerate, grid, delete-project), via `checkLeakHeaders`. Use `strict-origin`, never `no-referrer` (`lessons.md`).
- **Decided oracle labels** (decisions of 2026-09-29, recorded in the tests, not as PRD changes):
  - Lockout by a leaked-link holder is accepted: whoever holds a link can regenerate it. Tests say "documents the current PRD-accepted model".
  - The old URL returns 404 with no grace window after regeneration.
  - Cookie behavior is a current decision, not a requirement.
  - The three headers above are required behavior.
  - Regenerate audit rows (`access_log`) are not tested; the PRD has no such line.
- **Real-browser path (§3 Phase 4)**: the confirm form under a real browser `Origin`, the new URL with its banner, the same project and running timer, the old URL returning 404 and a second person's link staying valid are covered by `tests/e2e/regenerate-link.spec.ts` (§6.3). Still open: cookie replacement in a browser is not asserted. The smoke script sets `Origin` itself, so it cannot see these.
- **Real route handler against the real database** (`src/__tests__/delete-account.integration.test.ts`, opt-in): an Astro `APIRoute` is a plain async function of `{params, request, cookies, redirect, rewrite}`, so the test calls it with a fake context (a `FormData` request, a cookie jar with `get` and `delete` spies) while the link lookup, `deleteAccount` and the SQL function are real. Seed two people with `seedPerson()`, each with a project, a closed and an open time entry and an access-log row (direct inserts through `admin()`), and assert both people's row counts after the action (the untouched person's FULL counts prove the fixture was seeded). `cleanupSeeded` never removes a null-link `access_log` row, so the test deletes it itself, keyed by a unique `user_agent`. The route imports resolve under `vitest.integration.config.ts` (alias `@`, the `astro:env/server` stub) with no change to the application.
- **A "wrong link" fixture**: to catch a route that acts on the wrong person, give the request a cookie that holds the OTHER person's token and assert the URL token's person is the one deleted and the other person's rows and cookie are untouched. A single-person fixture, or a cookie equal to the URL token (as smoke has), cannot tell the two links apart.
- **Wrapper error handling**: hermetic, with `./supabase-admin` mocked (`src/lib/links.test.ts`): an irreversible action must never report success on an rpc error or a non-boolean answer.
- **Delete-account decisions** (not stated in the PRD; decided in the S-10 plan, so tests say "documents the current plan decision"): the phrase is `DELETE`, trimmed of outer whitespace and case-sensitive; the person's `access_log` rows (IP and user agent) are deleted and rows with a null link id stay; no deletion audit entry; a running timer is deleted with everything else; the `stopper_link` cookie is cleared only when it holds the deleted token; the landing page is `/?status=account-deleted`; the old link returns 404; whoever holds a link can delete that person's data ("documents the current accepted model"). What stays a stated requirement, from PRD FR-010: no phrase, an empty phrase or a wrong phrase deletes nothing; exactly the requester's projects, time entries and link go; nobody else's data changes; a slot is freed.
- **Not tested on purpose**: the SQL function's advisory lock and row lock, and its atomicity under concurrency. A race test through `supabase-js` cannot force the bad interleaving, so a green run would not prove the lock; both are covered by the S-10 implementation review only. Revisit if a change touches the function's locking.
- **Real-browser path (§3 Phase 4), delete-account**: the typed-phrase button gate (disabled until exactly `DELETE`), the confirm form's POST under a real `Origin`, the banner on the home page after the redirect, the deleted link returning 404 and a bystander's link and project surviving are covered by `tests/e2e/delete-account.spec.ts` (§6.3). Still open: the back-button handling of the delete page, and an isolated assertion that the route itself clears the cookie (the home page also clears a stale cookie, which masks it).

### 6.6 Per-rollout-phase notes

(Fills in after each phase lands, per that phase's final `/10x-plan`
sub-phase.)

- **§3 Phase 2 — weekly grid rounding & aggregation** (`context/archive/2026-09-29-testing-weekly-grid-rounding-aggregation/`, complete 2026-09-29): 1 test-first bug fix (integer-ms accumulation), 15 unit boundary/edge tests, 3 opt-in integration tests for `fetchWeekEntries`; see §6.4 for patterns and known gaps.
- **§3 Phase 3 (link half) — link leak & regeneration** (`context/archive/2026-09-29-testing-link-abuse-guardrails/`, implemented 2026-09-29): opt-in integration tests for the link lookup, regeneration and `link_id` scoping, hermetic cookie tests, leak-surface header checks in smoke, and a pgTAP anon-exposure test; see §6.5.
- **§3 Phase 3 (delete-account half) — irreversible account delete** (`context/archive/2026-09-29-testing-delete-account-guardrails/`, implemented 2026-09-30): an opt-in real-route test with two people who both own children (the cookie-holds-another-person fixture closes the wrong-scope gap the mocked route test could not see), hermetic route cases and wrapper tests, and nine deliberate-break checks (three for the real-route test, six for the hermetic cases); see §6.5.

## 7. What We Deliberately Don't Test

- **Visual/pixel-level Tailwind styling** — low blast radius for a
  solo/small-team internal tool; loosely covered by the `10x-ui` workflow
  already. Re-evaluate if a visual regression actually ships to production.
  (Source: Phase 2 interview Q5.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-09-28
- Stack versions last verified: 2026-09-28
- AI-native tool references last verified: 2026-09-28 (none in use)

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
