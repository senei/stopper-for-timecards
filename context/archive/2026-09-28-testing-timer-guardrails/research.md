---
date: 2026-09-28T07:20:28Z
researcher: Claude Sonnet 5
git_commit: 8a4a41557d09fe210499eaa551b764609bdab4fb
branch: main
repository: stopper-for-timecards
topic: "Test-plan Phase 1 grounding — Risk #1 (wrong project attribution) and Risk #2 (timer switch/stop drops or double-counts a segment)"
tags: [research, codebase, timer, projects, pgtap, database-integration-tests]
status: complete
last_updated: 2026-09-28
last_updated_by: Claude Sonnet 5
---

# Research: Timer precision & attribution regression guard (test-plan §3 Phase 1)

**Date**: 2026-09-28T07:20:28Z
**Researcher**: Claude Sonnet 5
**Git Commit**: 8a4a41557d09fe210499eaa551b764609bdab4fb
**Branch**: main
**Repository**: stopper-for-timecards

## Research Question

Per `context/foundation/test-plan.md` §2 Risk Response Guidance, ground two risks
before `/10x-plan` writes the Phase 1 test plan ("extending existing db coverage
with deliberate-break checks"):

- **Risk #1** ("time gets logged against the wrong project"): where is the
  project resolution/upsert-by-name entry point, and is name matching
  case-insensitive/trimmed consistently?
- **Risk #2** ("a timer switch or stop silently drops or double-counts a
  segment"): what is the exact write sequence on switch/stop (close-then-open
  vs. one transaction), and how is a partial failure mid-switch handled?

A third supporting question: what are this repo's existing pgTAP conventions,
so a new "deliberate-break" test file fits the established pattern.

## Summary

Both risks resolve to the same architectural answer: **project resolution and
timer state transitions are not implemented in the application layer at all —
they happen entirely inside `security definer` Postgres functions**
(`start_timer`, `switch_timer`, `stop_timer`), each invoked with exactly one
`admin.rpc(...)` call from `src/lib/timer.ts`. Because each function's body
runs as a single implicit transaction, "close-then-open" is not a two-step
application-level sequence that can partially fail — it is two SQL statements
inside one Postgres function invocation, guarded additionally by a per-link
`pg_advisory_xact_lock` and backstopped by a partial unique index that allows
at most one open `time_entries` row per link.

Existing pgTAP coverage (`switch_timer.test.sql`, `stop_timer.test.sql`,
`projects_and_timer.test.sql`) already exercises the happy path, one
case/whitespace-collision scenario, and the "call while already open/closed"
rejection path for each function, plus grants and RLS. What none of the
existing tests do is (a) prove the guardrails would catch a *regressed*
implementation (no mutation/deliberate-break tests), (b) assert that segment
durations sum losslessly across a full start→switch→switch→stop sequence with
no gap or overlap, or (c) cover more than a single case/whitespace variant of
project-name collision. These three gaps map directly onto what the Phase 1
plan needs to add.

## Detailed Findings

### Risk #1 — Project resolution / upsert-by-name

- The HTTP layer passes the raw, unnormalized project-name string straight
  through: `src/pages/api/w/[token]/timer/start.ts:34-45` reads `projectName`
  from form data, validates only shape (non-empty after trim, ≤200 chars) via
  `isValidProjectName`, then calls `startTimer(link.id, rawName)` (line 45)
  with the original untrimmed, original-case string.
  `src/pages/api/w/[token]/timer/switch.ts:33-44` follows the identical
  pattern into `switchTimer(link.id, rawName)`.
- `src/lib/project-name.ts:1-10` (`isValidProjectName`) only validates length
  bounds after trimming for the check itself — it does not return a
  normalized value, and does not case-fold. `src/lib/project-name.test.ts:1-36`
  asserts only that validation behavior; it does not and cannot exercise
  case-folding or whitespace-collapse because the module implements neither.
- `src/lib/timer.ts:62-74` (`startTimer`) and `:83-95` (`switchTimer`) are
  thin wrappers around one `admin.rpc("start_timer" | "switch_timer", …)`
  call each — no client-side "does this project exist" branch exists.
  `src/lib/projects.ts` has no upsert/create logic at all (only `listProjects`,
  `getProject`, `deleteProject`).
- **The find-or-create decision is entirely inside SQL.** In
  `supabase/migrations/20260922150000_projects_and_timer.sql:84`, the lookup
  is `where link_id = p_link_id and lower(name) = lower(trim(p_project_name))`;
  the insert on miss (`:88`) is `values (p_link_id, trim(p_project_name))` —
  trimmed but **not** lowercased, so original casing is preserved on first
  creation. The identical logic is duplicated in
  `supabase/migrations/20260923120000_switch_timer.sql:27-34` (re-created
  `start_timer`) and `:75-84` (`switch_timer`). Only edge whitespace is
  trimmed; internal whitespace is not collapsed, so `"Ac  me"` and `"Acme"`
  would resolve to two different projects under this inspected logic.
- **DB-level constraint**: `supabase/migrations/20260922150000_projects_and_timer.sql:28-29`
  — `unique index projects_link_id_lower_name_idx on projects (link_id,
  lower(name))`. The migration's own comment (`:23-27`) flags that
  `lower()` is locale/collation-dependent server-side, calling this "fine for
  this app's single-tenant, Latin-script usage" but a caveat for non-default
  collations.
- **Silent canonicalization on reuse**: on a name-collision match, the
  functions return the *stored* name/casing from the existing row (migration
  `:81-84`), not the newly-typed casing — re-typing `"ACME"` against an
  existing `"Acme"` project stores `"Acme"` into the new time entry, not
  `"ACME"`. This is existing, inspected behavior, not a hypothesis; it is not
  asserted anywhere (test or comment) as either an intended contract or a bug.
- **Existing test coverage** — `supabase/tests/database/projects_and_timer.test.sql`
  (12-assertion plan): one project + one open entry on first `start_timer`
  call (`:15-30`); a single case/whitespace variant
  (`'  acme  '` reused against a prior `'Acme'`) resolves to the same
  `project_id` and does not create a duplicate `projects` row (`:39-51`);
  reuse opens a new `time_entries` row (`:52-57`); a second `start_timer`
  call while one is already open is rejected via Postgres error code `23505`
  (`:61-66`) — this is the one assertion in the suite that exercises the
  unique-open-index constraint directly rather than only the function's own
  pre-check; grants (`:69-83`) and RLS-blocks-anon/authenticated (`:87-100`).
  `supabase/tests/database/switch_timer.test.sql` repeats the same single
  case/whitespace variant for `switch_timer` (`:51-71`).
- **Explicit gaps** (nothing in the inspected test files or `project-name.test.ts`
  covers these): internal-whitespace collapse; Unicode/locale case-folding
  edge cases (despite the migration comment naming this as a known risk);
  more than one case/whitespace variant (no matrix of all-caps, leading-only
  vs. trailing-only whitespace, tabs/newlines); a true concurrent-race test
  for the find-or-create path (the advisory lock is asserted only by code
  comment, never exercised by two simultaneous calls — pgTAP tests here run
  sequentially inside one transaction, see Architecture Insights); and the
  "reuse silently returns stored casing" behavior, not asserted as intended
  or tested anywhere.

### Risk #2 — Timer switch/stop write sequence

- **Switch**: `supabase/migrations/20260923120000_switch_timer.sql:49-92`
  defines `switch_timer(p_link_id, p_project_name)` as a single `plpgsql`
  `security definer` function. Within one function invocation it: takes
  `pg_advisory_xact_lock(hashtext('public.timer:' || p_link_id::text))`
  (`:63`); looks up the currently open entry, raising Postgres error code
  `P0001` if none exists (`:65-71`); runs
  `update time_entries set ended_at = now() where id = v_open_id` (`:73`);
  resolves/creates the target project (`:75-85`); then
  `insert into time_entries … returning …` (`:87-90`). Close and open are two
  SQL statements executed inside the one function call, not two application
  round-trips.
- `src/lib/timer.ts:83-95` (`switchTimer`) issues exactly one
  `admin.rpc("switch_timer", …)` call (`:86`) and translates the function's
  `P0001` into a `NoActiveTimerError` (`:88-89`).
  `src/pages/api/w/[token]/timer/switch.ts:44` calls `switchTimer` once; no
  separate app-level close/open calls exist in this inspected path.
- **Stop**: `supabase/migrations/20260927120000_stop_timer.sql:13-37` defines
  `stop_timer(p_link_id)` with the same shape — advisory lock (`:22`),
  open-entry lookup + `P0001` if none (`:24-30`), then a single
  `update … set ended_at = now() … returning …` (`:32-35`). Stop performs one
  write only; it never inserts a row. `src/lib/timer.ts:102-114` (`stopTimer`)
  and `src/pages/api/w/[token]/timer/stop.ts:33` follow the same
  one-RPC-call pattern as switch.
- **Partial-failure safety mechanism**: because the entire close(+insert)
  sequence runs inside one Postgres function body, an application-level
  crash or a lost HTTP response between "close" and "open" is not possible
  as a distinct app-level state — the RPC call either never reached Postgres
  (old segment stays open, nothing changed) or Postgres executed the whole
  function transactionally, so it either fully committed (old closed + new
  open) or, if any statement inside raised, fully rolled back (old segment
  still open, no partial write applied). This is backstopped at the schema
  level by a partial unique index,
  `supabase/migrations/20260922150000_projects_and_timer.sql:57-59`
  (`time_entries_link_id_open_idx on time_entries (link_id) where ended_at is
  null`), which caps the table at one open row per link regardless of how a
  function invocation ends. The same advisory lock key
  (`'public.timer:' || p_link_id::text`) is used by `start_timer`
  (`20260923120000_switch_timer.sql:25`), `switch_timer` (`:63`), and
  `stop_timer` (`stop_timer.sql:22`), serializing concurrent callers for the
  same link.
- No `CHECK (ended_at >= started_at)` constraint exists on `time_entries` —
  confirmed absent per a prior search recorded in
  `context/archive/2026-09-25-timer-stop-and-flags/research.md:42`. Duration
  correctness for a single row currently relies on both timestamps being
  stamped by the same server-side `now()` call inside one function
  invocation; a backwards-stepping DB clock is named there as the one
  unruled-out edge case for that inspected constraint search, and it remains
  untested.
- **Existing test coverage** —
  `supabase/tests/database/switch_timer.test.sql` (18-assertion plan):
  switching to a new project closes the prior entry and opens exactly one new
  open entry with correct attribution (`:15-49`); the one case/whitespace
  reuse scenario (`:51-71`, shared with Risk #1 above); `throws_ok(...,
  'P0001', ...)` when no timer is running, with entry count and open-entry
  count asserted unchanged (`:73-94`); two consecutive switches to the same
  project both succeed, producing three segments for one project with only
  one still open (`:96-131`); grants (`:133-148`).
  `supabase/tests/database/stop_timer.test.sql` (15-assertion plan): stop
  returns exactly one row matching the started entry, with `ended_at` set and
  `ended_at >= started_at` asserted (`:36-40` — the only duration-sanity
  check in the suite, and it covers a single row, not a chained sequence);
  zero open entries after stop and the `projects` table untouched (`:14-51`);
  `throws_ok P0001` when nothing is running (`:53-65`); restart after stop
  works (`:67-81`); stopping one link does not affect another link's open
  entry (`:83-101`); grants (`:103-118`).
- **Explicit gaps**: no test anywhere sums `ended_at - started_at` across a
  link's full segment sequence to confirm it equals wall-clock elapsed time,
  and no test chains segment boundaries (segment N's `ended_at` against
  segment N+1's `started_at`) to confirm no gap or overlap —
  `stop_timer.test.sql:36-40` checks only a single row in isolation. No test
  exercises the partial unique index as the backstop for `switch_timer` or
  `stop_timer` specifically (analogous to `projects_and_timer.test.sql:61-66`
  proving the index rejects a raw double-`start_timer`) — neither switch nor
  stop has an equivalent mutation-style test that bypasses or disables the
  `P0001` application-level guard to prove the index itself is what would
  catch a regressed implementation. No concurrency test fires two
  simultaneous `switch_timer`/`stop_timer` calls for the same link to
  exercise the advisory lock under real concurrency — current coverage is
  sequential only, inside one `begin;…rollback;` transaction per file. No
  deliberate-break/mutation test exists anywhere in the suite that would fail
  if the close-before-insert ordering were reversed; the atomicity guarantee
  is stated as a design goal in prose
  (`context/archive/2026-09-23-timer-switch-rounding/plan.md:36`: "because
  the close happens before the new insert, the partial unique index … never
  sees two open rows at once") but is not exercised by a test tied to that
  specific ordering claim.

### pgTAP test conventions (for a new Phase 1 test file)

- Every existing file in `supabase/tests/database/` opens with the same
  boilerplate — `begin;` / `create extension if not exists pgtap with schema
  extensions;` / `select plan(N);` — confirmed at
  `delete_project.test.sql:1-5`, and the same three lines recur at the head
  of `purge_time_entries.test.sql`, `private_links.test.sql`,
  `switch_timer.test.sql`, and `stop_timer.test.sql`. Every file closes with
  `select * from finish();` then `rollback;` (`delete_project.test.sql:125,
  127`) — cleanup is transactional, not manual deletes.
- Fixtures are hand-written `insert into links (id, token_hash) values (...)`
  with literal UUIDs local to each file (e.g.
  `switch_timer.test.sql:11-13`, `stop_timer.test.sql:10-12`); each file
  documents its own UUID block in a comment so IDs don't collide across
  files that could theoretically run in the same session
  (`switch_timer.test.sql:7-10`). No shared fixture/helper file exists — a
  `find` of `supabase/tests/database/` turned up exactly the six `.test.sql`
  files and nothing else, so a new test file must inline its own fixtures
  following this pattern.
- Assertion functions in use: `lives_ok`, `throws_ok` (asserted against a
  Postgres SQLSTATE code, e.g. `delete_project.test.sql:33-38` using
  `'23503'`), `is`, `isnt`, and an RLS role-switch pattern via `set local
  role anon;` … `reset role;` (`delete_project.test.sql:92-101`,
  `private_links.test.sql:45-57`). Description strings are lowercase,
  present-tense, sentence-style with no trailing period (e.g. `"deleting an
  unused project succeeds"`, `delete_project.test.sql:21`).
- **Run command / CI wiring**: `README.md:43` documents `npx supabase test
  db` as the local command, run after `npx supabase db reset`.
  `.github/workflows/ci.yml:35-44` runs the same command inside the `smoke`
  job on push/PR to `main` (`ci.yml:3-7`) — i.e., on every PR to `main` in
  this inspected workflow file, not gated to a separate trigger.
- **Version/setup**: `package.json:56` pins the local Supabase CLI dev
  dependency to `^2.23.4`; `.github/workflows/ci.yml:37` pins the CI action
  to `version: latest` — a version-pin drift between local and CI worth
  naming if precision becomes load-bearing later. `supabase/config.toml:36`
  sets Postgres `major_version = 17`. `README.md:22-26` names Docker as a
  prerequisite for the local Supabase stack.
- **Naming convention for a new file**: `<function_or_feature>.test.sql`
  matching the DB function/feature under test. Given the existing
  one-file-per-function precedent (`switch_timer.test.sql`,
  `stop_timer.test.sql`), a new deliberate-break test for project
  attribution + timer switch/stop fits as its own new file in
  `supabase/tests/database/`, using a fresh, documented UUID block per the
  existing collision-avoidance comment convention.

## Code References

- `src/pages/api/w/[token]/timer/start.ts:34-45` — start route reads raw
  `projectName`, validates shape only, calls `startTimer` with untrimmed
  string
- `src/pages/api/w/[token]/timer/switch.ts:33-44` — switch route, same
  pattern into `switchTimer`
- `src/pages/api/w/[token]/timer/stop.ts:33` — stop route, one `stopTimer`
  call
- `src/lib/project-name.ts:1-10` — `isValidProjectName`; validates only,
  does not normalize or return a normalized value
- `src/lib/project-name.test.ts:1-36` — existing unit coverage for
  validation only, no case-fold/whitespace-collapse behavior to test
- `src/lib/timer.ts:62-74` — `startTimer`, one `admin.rpc("start_timer", …)`
  call
- `src/lib/timer.ts:83-95` — `switchTimer`, one `admin.rpc("switch_timer",
  …)` call, `P0001` → `NoActiveTimerError`
- `src/lib/timer.ts:102-114` — `stopTimer`, one `admin.rpc("stop_timer", …)`
  call
- `src/lib/projects.ts` — `listProjects` (17-47), `getProject` (50-77),
  `deleteProject` (84-96); no upsert/create logic
- `supabase/migrations/20260922150000_projects_and_timer.sql:23-29` —
  `projects_link_id_lower_name_idx` unique index + collation-risk comment
- `supabase/migrations/20260922150000_projects_and_timer.sql:57-59` —
  `time_entries_link_id_open_idx` partial unique index (one open row per
  link)
- `supabase/migrations/20260922150000_projects_and_timer.sql:84,88` —
  case/trim-insensitive lookup, trim-only (not lowercased) insert
- `supabase/migrations/20260923120000_switch_timer.sql:25,27-34` —
  recreated `start_timer`: advisory lock, find-or-create logic
- `supabase/migrations/20260923120000_switch_timer.sql:49-92` —
  `switch_timer`: advisory lock, close, find-or-create, insert, all in one
  function body
- `supabase/migrations/20260927120000_stop_timer.sql:13-37` — `stop_timer`:
  advisory lock, lookup, single update
- `supabase/tests/database/projects_and_timer.test.sql:15-100` — existing
  `start_timer` coverage (12 assertions)
- `supabase/tests/database/switch_timer.test.sql:15-148` — existing
  `switch_timer` coverage (18 assertions)
- `supabase/tests/database/stop_timer.test.sql:14-118` — existing
  `stop_timer` coverage (15 assertions)
- `supabase/tests/database/delete_project.test.sql:1-127` — pgTAP boilerplate
  and cleanup convention reference
- `README.md:43` — local pgTAP run command
- `.github/workflows/ci.yml:35-44` — CI wiring for `supabase test db`

## Architecture Insights

- **Atomicity by construction, not by application-level orchestration.**
  Every timer state transition (`start_timer`, `switch_timer`, `stop_timer`)
  is a single `security definer` plpgsql function called via exactly one
  Supabase RPC round-trip from `src/lib/timer.ts`. There is no
  application-level two-phase sequence to test for partial failure — the
  transaction boundary is entirely inside Postgres. This means Risk #2's
  "silently drops or double-counts a segment" scenario is architecturally
  closed off for a *crash-between-steps* failure mode; the residual risk is
  a *logic* bug inside the function body (ordering, missing lock, missing
  constraint), which only a deliberate-break/mutation-style test can prove
  the guardrails would catch.
- **Two-layer defense, one layer untested.** Both risks share the same
  defense-in-depth shape: an advisory lock (concurrency serialization) plus a
  partial/composite unique index (data-integrity backstop). Existing tests
  prove the advisory-lock-guarded happy/rejection paths work under sequential
  execution, but only one test in the whole suite
  (`projects_and_timer.test.sql:61-66`) actually exercises the unique index
  as the thing catching a violation, rather than the earlier application-level
  `P0001`/lock check. No test in `switch_timer.test.sql` or
  `stop_timer.test.sql` does the equivalent for the open-row index.
  Deliberate-break tests for Phase 1 should target this untested layer
  specifically.
- **Normalization lives in SQL, not JS, and is asymmetric.** `trim()` +
  `lower()` are both applied for *lookup*, but only `trim()` is applied to
  the *stored* value on insert — original casing survives first creation and
  is what all future reuses snapshot to. A deliberate-break test for Risk #1
  should assert this specific, currently-correct-but-unasserted contract
  (stored casing is first-seen casing) so a future change to the insert
  logic doesn't silently change display behavior unnoticed.
- **pgTAP tests here are self-contained by file, not by fixture-sharing.**
  No shared helper/fixture file exists across the six test files; each picks
  its own UUID block and documents it. A new Phase 1 test file should follow
  this same self-contained pattern rather than introducing a new shared
  helper (which would be a departure from the established convention, not an
  extension of it).

## Historical Context (from prior changes)

- `context/archive/2026-09-23-timer-switch-rounding/plan.md:36` — states the
  atomicity design goal in prose ("because the close happens before the new
  insert, the partial unique index … never sees two open rows at once");
  this claim has not been converted into a test tied to that specific
  ordering.
- `context/archive/2026-09-25-timer-stop-and-flags/research.md:42` — records
  a prior search confirming no `CHECK` constraint exists on `time_entries`
  for `ended_at >= started_at`, and names a backwards-stepping DB clock as
  the one theoretically open edge case for that search; still untested as of
  this research.

## Related Research

- `context/archive/2026-09-23-timer-switch-rounding/` — prior design/plan
  for `switch_timer` (rounding + atomicity rationale)
- `context/archive/2026-09-25-timer-stop-and-flags/` — prior design/plan for
  `stop_timer`, including the constraint search referenced above
- `context/archive/2026-09-22-first-timer-start/` and
  `context/archive/2026-09-23-first-timer-start-audit/` — prior work on
  `start_timer`, not re-read in depth for this research (out of scope: this
  phase covers #1 and #2, which center on switch/stop plus resolution
  shared with start)

## Open Questions

- Whether Unicode/locale case-folding for project names (flagged as a known
  risk in the migration comment at
  `supabase/migrations/20260922150000_projects_and_timer.sql:23-27`) is
  in-scope for Phase 1's deliberate-break tests or deferred — this is a
  product-scope call for `/10x-plan`, not a fact this research can resolve.
  This app is confirmed single-tenant and the comment names Latin-script
  usage as the assumed case; whether that assumption is durable enough to
  leave untested is a planning decision.
- Whether a true concurrent-request test (two simultaneous RPC calls for the
  same link) is achievable inside pgTAP's single-transaction-per-file model,
  or whether it requires a different test harness — not determined by this
  research; `/10x-plan` should scope this explicitly rather than assume
  pgTAP can express it.
