# Timer Precision & Attribution Regression Guard Implementation Plan

## Overview

Test-plan §3 Phase 1 ("Timer precision & attribution regression guard") hardens
the two highest-ranked risks — #1 (time logged against the wrong project) and
#2 (a timer switch/stop silently drops or double-counts a segment) — by
extending the existing pgTAP suite with **deliberate-break** tests: tests that
prove the DB-level guardrails (unique indexes) are what catch a violation,
not just the application-level pre-checks that already have coverage. This
plan adds one new test file rather than touching application code — the
functions under test (`start_timer`, `switch_timer`, `stop_timer`) are
already correct; the gap is in what the test suite can prove about them.

## Current State Analysis

Project resolution and timer state transitions are implemented entirely in
three `security definer` Postgres functions, each called via exactly one
Supabase RPC round-trip from `src/lib/timer.ts` — there is no
application-level multi-step sequence to test for partial failure. The
existing pgTAP suite (`supabase/tests/database/projects_and_timer.test.sql`,
`switch_timer.test.sql`, `stop_timer.test.sql`) already covers the happy
path, one case/whitespace-collision scenario, and the app-level `P0001`
rejection path for each function. See `context/changes/testing-timer-guardrails/research.md`
for full evidence; anchors below are drawn from it.

### Key Discoveries:

- Close-then-open on switch is two SQL statements inside **one** function
  invocation (`supabase/migrations/20260923120000_switch_timer.sql:49-92`),
  so a crash between "close" and "open" is not a distinct application-level
  state — Postgres either never received the call or ran the whole function
  transactionally.
- `now()` is **transaction-scoped** in Postgres: every call within one
  `begin;…rollback;` block (which is how every pgTAP file in this repo is
  structured, e.g. `delete_project.test.sql:1,127`) returns the same value.
  This means `switch_timer`'s `update … set ended_at = now()` and its
  following `insert … started_at = now()` (migration lines 73 and 89) write
  the **identical** timestamp — provable by direct value comparison, and
  exactly the atomicity contract named in
  `context/archive/2026-09-23-timer-switch-rounding/plan.md:36`. It also
  means a real "segments sum to elapsed wall-clock time" test cannot be
  built inside a single pgTAP file without fabricating data that no longer
  reflects actual function behavior — that concern belongs to §3 Phase 3
  (weekly grid rounding/aggregation), over data this phase already proves
  structurally sound.
- Only one existing test in the whole suite —
  `projects_and_timer.test.sql:61-66` — exercises a unique index directly
  (attempting a second `start_timer` call while one is open, rejected via
  `23505`, because `start_timer` has no app-level pre-check and relies on
  the index alone). Neither `switch_timer.test.sql` nor `stop_timer.test.sql`
  has an equivalent: both functions raise `P0001` from an app-level lookup
  *before* ever reaching a write that could violate the index
  (`20260923120000_switch_timer.sql:65-71`, `20260927120000_stop_timer.sql:24-30`),
  so nothing currently proves the index itself — as opposed to that
  lookup — is what would catch a violation.
- Case-insensitive project matching happens entirely in SQL
  (`lower(name) = lower(trim(p_project_name))`,
  `20260922150000_projects_and_timer.sql:84`) backed by a unique index
  (`projects_link_id_lower_name_idx`, `:28-29`). The insert on miss trims
  but does **not** lowercase (`:88`), so first-seen casing is what's stored;
  a reuse call returns that stored casing regardless of the newly-typed
  case. This is real, observed behavior — not asserted anywhere as intended.
- `src/lib/project-name.ts` (`isValidProjectName`) validates length/emptiness
  only; it does not normalize. All normalization is SQL-side.

## Desired End State

`supabase/tests/database/timer_guardrails.test.sql` exists, runs under the
existing `npx supabase test db` / CI `smoke` job with no config changes, and
proves: (a) a full start→switch→switch→stop sequence produces segments whose
boundaries chain exactly with no gap or overlap; (b) the `time_entries`
open-row partial unique index rejects a bypassed double-open insert
independent of `switch_timer`/`stop_timer`'s own pre-checks; (c) the
`projects` case-insensitive unique index rejects a bypassed duplicate-project
insert independent of the RPC functions' own lookup; (d) reuse of an existing
project under different casing stores the entry under the **original**
casing, not the newly-typed one; (e) one non-ASCII case-variant reuse
resolves to the same project, pinning today's collation behavior.

**Verification**: `npx supabase db reset && npx supabase test db` passes
locally and in CI (`ci.yml`'s `smoke` job), with the new file's `plan(N)`
count matching its actual assertion count.

## What We're NOT Doing

- Not adding a true concurrent-request/race test (two simultaneous RPC calls
  for the same link) — deferred per the interview decision; documented in
  the Progress/brief as an accepted, code-reviewed-not-test-verified gap.
  pgTAP's one-file-one-transaction model isn't built for this, and this
  app's per-link request volume doesn't clear the cost×signal bar for
  forcing it (e.g. via `dblink`/`pg_background`, unconfirmed as available
  in this project's local Supabase stack).
- Not asserting a real elapsed-wall-clock-time duration sum — see Key
  Discoveries above on `now()`'s transaction scoping. Boundary-chaining
  (exact timestamp equality between consecutive segments) is the meaningful,
  testable proxy for "no gap/overlap" at this layer.
- Not testing a full matrix of case/whitespace variants (all-caps,
  leading-only vs. trailing-only whitespace, tabs) — one additional
  non-ASCII case is added per the interview decision; the existing
  `'  acme  '` variant already covers the ASCII case/whitespace path.
- Not touching `start_timer`, `switch_timer`, `stop_timer`, or any
  application code — this phase is test-only. The functions are already
  correct per the existing (happy-path) coverage; this phase closes gaps in
  what the *tests* can prove.
- Not adding a constraint-drop mutation test (temporarily dropping an index
  inside the test transaction) — the direct-insert-bypass approach was
  chosen instead; no precedent in this codebase for disabling a production
  constraint inside a test.

## Implementation Approach

One new pgTAP file, following this directory's established
one-file-per-concern convention loosely (the existing files are
one-file-per-function; this one groups cross-function "deliberate-break"
checks under the rollout phase's own name, since the boundary-chaining case
spans all three functions and doesn't belong to any single existing file).
Each case bypasses the RPC layer at the exact point needed to isolate the
guardrail being proven — a direct `insert` for index tests, the real RPC
calls for the boundary-chaining and canonicalization tests (which need the
functions' actual behavior, not a bypass).

## Phase 1: Segment-boundary chaining & index-backstop tests

### Overview

Creates `supabase/tests/database/timer_guardrails.test.sql` with the
boundary-chaining case (Risk #2's core proof) and the two index-backstop
cases (Risk #2's and Risk #1's unique indexes, proven independent of the
RPC functions' own app-level pre-checks).

### Changes Required:

#### 1. New pgTAP test file — boilerplate and fixtures

**File**: `supabase/tests/database/timer_guardrails.test.sql`

**Intent**: Establish the file following this directory's fixed convention
(`begin;` / `create extension if not exists pgtap …` / `select plan(N);` …
`select * from finish();` / `rollback;`, confirmed identical across all six
existing files, e.g. `delete_project.test.sql:1-5,125-127`). Insert a fresh,
documented block of link fixtures distinct from every other file's — the
existing files use `a0000000-…-0001` through `…0007`; this file should use a
new prefix (e.g. `b0000000-…`) per the established collision-avoidance
comment convention (`switch_timer.test.sql:7-10`).

**Contract**: One `links` row per case below (5 links: boundary-chaining,
open-index-bypass, project-index-bypass, canonicalization, Unicode
snapshot — each case gets its own link to keep setup order-independent,
matching how `switch_timer.test.sql`/`stop_timer.test.sql` isolate cases
onto separate links). `plan(N)` set to the exact count of assertions written
across all cases in this phase and Phase 2 (do not finalize until both
phases' assertions are written — see Phase 2's note).

#### 2. Case: segment-boundary chaining

**File**: `supabase/tests/database/timer_guardrails.test.sql`

**Intent**: Prove that `switch_timer`'s close-then-open pair writes the
identical timestamp for the closed segment's `ended_at` and the newly opened
segment's `started_at` — the concrete, testable form of the atomicity claim
in `context/archive/2026-09-23-timer-switch-rounding/plan.md:36`. Run
`start_timer` (Project A) → `switch_timer` (Project B) → `switch_timer`
(Project C) → `stop_timer` on one link, capturing each call's returned
`entry_id`/`started_at` into a temporary table exactly as the existing files
do (e.g. `switch_timer.test.sql:17-21`).

**Contract**: Assert, using the captured `entry_id`s and direct
`time_entries` lookups:
- segment 1's `ended_at` equals segment 2's `started_at` (exact equality,
  not `>=` — this is the point of the test)
- segment 2's `ended_at` equals segment 3's `started_at`
- segment 3's `ended_at` is non-null after the final `stop_timer` call
- exactly 3 `time_entries` rows exist for the link, and exactly 0 are open
  after the stop (proves no segment was dropped or left dangling)
- segment 3's `project_id` matches Project C's id and differs from segments
  1 and 2's (proves attribution survived the chain correctly, tying this
  case to Risk #1 as well as Risk #2)

#### 3. Case: `time_entries` open-row index is the actual backstop

**File**: `supabase/tests/database/timer_guardrails.test.sql`

**Intent**: `switch_timer` and `stop_timer` both raise `P0001` from an
app-level lookup *before* any write that could violate
`time_entries_link_id_open_idx` (`20260923120000_switch_timer.sql:65-71`,
`20260927120000_stop_timer.sql:24-30`), so nothing currently proves the
index itself — independent of that lookup — is what would catch a
violation. On a link with one open entry (from a plain `start_timer` call),
attempt a **direct** `insert into time_entries (...)` for a second open row
on the same link, bypassing all three RPC functions entirely.

**Contract**: `throws_ok` asserting SQLSTATE `23505` on the direct insert
(mirrors the existing pattern for `start_timer` at
`projects_and_timer.test.sql:61-66`, applied here via a raw insert instead
of via an RPC call, and targeting the switch/stop code path's shared table).
Follow with an `is()` confirming the link's open-entry count is still
exactly 1 (the rejected insert changed nothing). The insert statement must
supply all `time_entries` `not null` columns —
`link_id, project_id, project_name, type, work_type, started_at`
(`20260922150000_projects_and_timer.sql:41-46`) — reusing the existing open
entry's `project_id` is the simplest valid value:

```sql
insert into time_entries (link_id, project_id, project_name, type, work_type, started_at)
select link_id, project_id, project_name, type, work_type, now()
from time_entries
where link_id = '<the link id>' and ended_at is null;
```

#### 4. Case: `projects` case-insensitive index is the actual backstop

**File**: `supabase/tests/database/timer_guardrails.test.sql`

**Intent**: `start_timer`/`switch_timer` never attempt a duplicate insert in
normal operation — they `select` first and only `insert` on a genuine miss
(`20260922150000_projects_and_timer.sql:81-90`) — so nothing currently
proves `projects_link_id_lower_name_idx` itself rejects a case-colliding
duplicate independent of that lookup. After a `start_timer` call creates a
project named `'Acme'`, attempt a **direct**
`insert into projects (link_id, name) values (<link_id>, 'ACME')`,
bypassing the RPC's find-or-create logic entirely.

**Contract**: `throws_ok` asserting SQLSTATE `23505`. Follow with an `is()`
confirming the link's `projects` row count is still exactly 1.

### Success Criteria:

#### Automated Verification:

- New file parses and runs: `npx supabase test db` completes with no syntax
  errors and every assertion in this phase's three cases passes
- `npx supabase db reset && npx supabase test db` passes locally, matching
  the CI `smoke` job's command (`.github/workflows/ci.yml:44`)
- The boundary-chaining case's equality assertions (`ended_at = started_at`
  across segments) pass, proving atomic same-timestamp close/open
- Both `throws_ok(..., '23505', ...)` bypass-insert assertions pass, and
  their paired row-count assertions confirm no partial state was left behind

#### Manual Verification:

- Read the pgTAP output for this phase's cases and confirm the assertion
  descriptions read as intended (pgTAP failures report the description
  string, so a misleading description would mask a real failure on review)

---

## Phase 2: Casing-canonicalization contract & Unicode snapshot

### Overview

Adds two more cases to the same file: one pinning the "reuse keeps
first-seen casing" behavior as an explicit, intended contract, and one
pinning today's `lower()`-based collation behavior for a single non-ASCII
project name, closing the gap the migration's own comment
(`20260922150000_projects_and_timer.sql:23-27`) names as a known risk.

### Changes Required:

#### 1. Case: casing-canonicalization contract

**File**: `supabase/tests/database/timer_guardrails.test.sql`

**Intent**: The existing case-reuse tests
(`projects_and_timer.test.sql:39-46`, `switch_timer.test.sql:56-59`) assert
only that the reused call returns the same `project_id` — never that the
stored/returned `project_name` on the new entry is the *original* casing,
not the newly-typed one. Start a timer on a fresh link with `'Acme'`, then
`switch_timer` on the same link reusing the project as `'ACME'`.

**Contract**: `is()` asserting the switch call's returned `project_name`
equals `'Acme'` (not `'ACME'`) — documents the observed
`lower(trim())`-lookup / `trim()`-only-insert behavior
(`20260922150000_projects_and_timer.sql:84,88`) as an explicit, tested
contract rather than an unasserted accident. Follow with an `is()`
confirming the `projects.name` value for that project is still `'Acme'`
(the reuse call did not overwrite the stored name).

#### 2. Case: non-ASCII case-fold snapshot

**File**: `supabase/tests/database/timer_guardrails.test.sql`

**Intent**: Pin today's collation-dependent `lower()` behavior for one
concrete non-ASCII example, per the interview decision — this documents
current behavior (so a future collation/locale change is caught), not a
correctness claim about every script. Start a timer on a fresh link with an
accented project name (e.g. `'Café'`), then call `start_timer` again after
stopping (or `switch_timer`) reusing the differently-cased accented form
(e.g. `'CAFÉ'`).

**Contract**: `is()` asserting the second call's `project_id` equals the
first's (today's server-side `lower()` folds this pair together). Follow
with an `is()` confirming exactly one `projects` row exists for that link
(no duplicate created). Frame the test's description string explicitly as
documenting current behavior (e.g. `'reusing an accented name under
different casing resolves via server-side lower() (documents current
collation behavior)'`), not as a correctness guarantee.

#### 3. Finalize `plan(N)`

**File**: `supabase/tests/database/timer_guardrails.test.sql`

**Intent**: Now that every case in both phases is written, count the actual
`select is(...)`/`throws_ok(...)` assertions and set `plan(N)` to match
exactly — pgTAP fails the run if the count is wrong.

**Contract**: `select plan(N);` at the top of the file, `N` = the literal
count of assertions in the finished file.

### Success Criteria:

#### Automated Verification:

- `npx supabase test db` passes with the finalized `plan(N)` count matching
  the actual number of assertions run (pgTAP itself fails the file if these
  disagree — this is a hard automated check, not just a convention)
- Full suite (`npx supabase db reset && npx supabase test db`) passes,
  confirming the new file doesn't collide with or affect any existing file's
  fixtures

#### Manual Verification:

- Read the canonicalization and Unicode case assertion descriptions and
  confirm they clearly separate "documents current behavior" framing from
  "this is correct/required" framing, so a future reader doesn't mistake the
  Unicode snapshot for a correctness guarantee across all scripts

---

## Phase 3: Cookbook & rollout-status sync

### Overview

Closes out test-plan.md's Phase 1 row and records the deliberate-break test
pattern established in Phases 1–2 in §6, so Phases 2–4 (and any future
rollout phase) can follow the same pattern without rediscovering it.

### Changes Required:

#### 1. Cookbook entry update

**File**: `context/foundation/test-plan.md`

**Intent**: §6.2 ("Adding a database integration test") currently documents
only the happy-path pgTAP convention. Add a short subsection or note
documenting the deliberate-break pattern this phase established: bypass the
RPC layer with a direct `insert` to prove an index (not an app-level
pre-check) is the actual backstop, and reference
`supabase/tests/database/timer_guardrails.test.sql` as the pattern's
reference test.

**Contract**: Extend §6.2's existing bullets (Location/Naming/Reference
test/Run command) with one more line naming the deliberate-break pattern and
its reference file — do not restructure the existing §6.2 content.

#### 2. Rollout status sync

**File**: `context/foundation/test-plan.md`

**Intent**: Per the orchestrator's Rollout chain (CLAUDE.md), a phase whose
`plan.md` is fully `[x]` gets its §3 row marked `complete`.

**Contract**: In the §3 Phased Rollout table, change row 1's `Status` cell
from `change opened` to `complete` (this edit happens once Phase 1 and 2's
Progress rows are checked off by `/10x-implement`; do not flip it during
planning).

### Success Criteria:

#### Automated Verification:

- `grep` confirms `context/foundation/test-plan.md` §3 row 1 reads
  `complete` and §6.2 references `timer_guardrails.test.sql`

#### Manual Verification:

- Read the updated §6.2 and confirm the new deliberate-break note is
  concise and doesn't duplicate the existing bullets

---

## Testing Strategy

### Integration Tests:

- All of this phase's work *is* the integration test layer — see Phases 1–2
  above for the exact cases.

### Manual Testing Steps:

1. Run `npx supabase db reset && npx supabase test db` locally and confirm
   all assertions pass, including the new file.
2. Read the new file's assertion descriptions end-to-end and confirm each
   one clearly states what it proves and why (per pgTAP's convention of
   surfacing the description string on failure).

## Migration Notes

Not applicable — this phase adds no schema changes, only test coverage
against the existing schema from
`supabase/migrations/20260922150000_projects_and_timer.sql`,
`20260923120000_switch_timer.sql`, and `20260927120000_stop_timer.sql`.

## References

- Related research: `context/changes/testing-timer-guardrails/research.md`
- Test-plan strategy: `context/foundation/test-plan.md` §2 (Risk Response
  Guidance for #1/#2), §3 (Phase 1 row), §6.2 (cookbook entry to extend)
- Reference pgTAP pattern proven for an index backstop:
  `supabase/tests/database/projects_and_timer.test.sql:61-66`
- Prior atomicity design note:
  `context/archive/2026-09-23-timer-switch-rounding/plan.md:36`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Segment-boundary chaining & index-backstop tests

#### Automated

- [x] 1.1 New file parses and runs: `npx supabase test db` completes with no syntax errors and every assertion in this phase's three cases passes — cb1b4a9
- [x] 1.2 `npx supabase db reset && npx supabase test db` passes locally, matching the CI `smoke` job's command — cb1b4a9
- [x] 1.3 The boundary-chaining case's equality assertions (`ended_at = started_at` across segments) pass, proving atomic same-timestamp close/open — cb1b4a9
- [x] 1.4 Both `throws_ok(..., '23505', ...)` bypass-insert assertions pass, and their paired row-count assertions confirm no partial state was left behind — cb1b4a9

#### Manual

- [x] 1.5 Read the pgTAP output for this phase's cases and confirm the assertion descriptions read as intended — cb1b4a9

### Phase 2: Casing-canonicalization contract & Unicode snapshot

#### Automated

- [x] 2.1 `npx supabase test db` passes with the finalized `plan(N)` count matching the actual number of assertions run — 8e4dacd
- [x] 2.2 Full suite (`npx supabase db reset && npx supabase test db`) passes, confirming the new file doesn't collide with or affect any existing file's fixtures — 8e4dacd

#### Manual

- [x] 2.3 Read the canonicalization and Unicode case assertion descriptions and confirm they clearly separate "documents current behavior" framing from "this is correct/required" framing — 8e4dacd

### Phase 3: Cookbook & rollout-status sync

#### Automated

- [x] 3.1 `grep` confirms `context/foundation/test-plan.md` §3 row 1 reads `complete` and §6.2 references `timer_guardrails.test.sql` — a3109d2

#### Manual

- [x] 3.2 Read the updated §6.2 and confirm the new deliberate-break note is concise and doesn't duplicate the existing bullets — a3109d2
