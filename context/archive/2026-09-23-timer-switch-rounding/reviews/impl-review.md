<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Timer Switch Rounding

- **Plan**: context/changes/timer-switch-rounding/plan.md
- **Scope**: Full plan (3 of 3 phases)
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-09-24
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations

Reviewed inline (no sub-agents): every changed file was read fresh, and the automated criteria were re-run where they could be. Commits in scope: c619b72 (p1), a3d37c3 (p2), 82b2686 (form-post fix, unplanned), c020648 (p3), 52903c4 (local smoke runner, unplanned), 408240e (epilogue).

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Success criteria re-run

| Phase | Criterion | Result |
|-------|-----------|--------|
| 1 | `npx supabase db reset` | PASS (ran; wiped 1 link / 3 projects / 10 entries of manual-test data, no seed file exists) |
| 1 | `npx supabase test db` | PASS on a clean DB: 4 files, 54 tests. FAIL on the used DB before the reset, see F3 |
| 1, 3 | `npm run test -- --run` | PASS: 7 files, 36 tests |
| 1, 2, 3 | `npm run lint` | PASS: 0 errors, 1 pre-existing `no-console` warning in `workers/purge-job` |
| 1, 2, 3 | `npx astro check` | PASS: 0 errors, 0 warnings, 0 hints |
| 3 | `npm run smoke` | NOT re-run by the reviewer (needs the dummy-key dev server); the user reported it passing after the form-post fix, which is the last code change |
| 1 | Manual: `start_timer` then `switch_timer`, and P0001 with no timer | Both covered by pgTAP (`switch_timer.test.sql` cases 1 and 3) |
| 3 | Manual 3.3 to 3.6 | Checked on the user's confirmation. 3.4 and 3.6 are also asserted by smoke; 3.3 and 3.5 have no automated evidence (F5) |

`start_timer`'s body was diffed against its previous definition: the only difference is the advisory-lock key, as planned. The `plan(18)` count in `switch_timer.test.sql` matches its 18 assertions.

## Findings

### F1 — Unplanned changes are not recorded in the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/404.astro:5, src/pages/w/[token]/projects/[projectId]/delete.astro:10, src/pages/w/[token].astro:14, scripts/smoke-local.mjs
- **Detail**: Two groups of changes fall outside the plan's Changes Required. (1) Commit 82b2686 changed `Referrer-Policy` from `no-referrer` to `strict-origin` on three pages, two of them S-02 code Phase 3 was not meant to touch: under `no-referrer` browsers send `Origin: null` on same-origin form posts and Astro's origin check rejects them with a 403, so no form on the workspace or delete page could be submitted from a browser. It blocked Phase 3's manual checks, was committed separately, and is a justified fix. (2) Commit 52903c4 added `scripts/smoke-local.mjs`, a README line, an npm script, a `.gitignore` entry and a `[inbucket]` to `[local_smtp]` rename in `supabase/config.toml`. Neither group is mentioned in `plan.md`, which is what later reviews and `/10x-archive` treat as the source of truth, so both would read as drift.
- **Fix**: Add a short addendum to `plan.md` listing both commits (82b2686, 52903c4), why they happened, and that they are outside the original scope.
- **Decision**: FIXED — addendum added to plan.md (before `## Progress`) covering 82b2686 and 52903c4

### F2 — Nothing guards form posts the way a browser sends them

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: scripts/smoke.mjs:47-49, scripts/smoke.mjs:125-130
- **Detail**: `request()` adds a correct `Origin` header to every call, so smoke can never see the class of bug fixed in 82b2686. That bug shipped with S-02 and was found only by manual testing in Phase 3. The new smoke check pins the `Referrer-Policy` value on the workspace page only. Nothing checks the delete page, the 404 page, or the browser behaviour itself, and a future page that sets `no-referrer` would bring the bug back unnoticed.
- **Fix A ⭐ Recommended**: Record it as a lesson in `context/foundation/lessons.md` (`no-referrer` plus Astro's origin check yields `Origin: null` and a 403; smoke sets Origin itself so cannot see it).
  - Strength: Every future `/10x-plan` and `/10x-implement` run reads the lessons file, so the trap is flagged before a page is written. Costs one paragraph.
  - Tradeoff: A rule is advice, not a test; a regression is still caught only by a person.
  - Confidence: HIGH — this is exactly the "recurring pitfall" the register exists for, and two entries already follow the same shape.
  - Blind spot: Behaviour was verified in headless Chrome only, not Firefox or Safari.
- **Fix B**: Add a real-browser check (for example Playwright) that submits a form on the workspace page.
  - Strength: Catches the actual failure regardless of which header causes it.
  - Tradeoff: Adds a dependency and a browser to CI, and the repo has no browser-test tooling today.
  - Confidence: MED — the value is clear, the cost for a repo this size is not.
  - Blind spot: CI runner browser availability was not checked.
- **Decision**: FIXED via Fix A + ACCEPTED-AS-RULE: A page served with `Referrer-Policy: no-referrer` cannot submit forms in a browser under Astro's origin check (appended to context/foundation/lessons.md)

### F3 — The pgTAP suite only passes on a freshly reset database

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/database/private_links.test.sql:41
- **Detail**: `npx supabase test db` failed on the developer's local DB after manual testing (1 link with an open timer, 10 entries): `private_links.test.sql` reported `duplicate key value violates unique constraint "time_entries_link_id_open_idx"` and "10th link is created" returned NULL, with 6 of 12 subtests failing. After `npx supabase db reset` all 4 files passed (54 tests). This file predates and is unchanged by this change; the new `switch_timer.test.sql` passed either way. It matters here because Phase 1's criterion is "the full pgTAP suite passes", which is only true on a clean DB.
- **Fix**: State in the README test commands that `npx supabase db reset` must run before `npx supabase test db`.
- **Decision**: FIXED — README.md documents `npx supabase db reset` before `npx supabase test db`

### F4 — Row validation is duplicated between `startTimer` and `switchTimer`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/timer.ts:43-68, src/lib/timer.ts:89-114
- **Detail**: The two wrappers share an identical ~25-line block that validates the returned row and maps snake_case to camelCase. The plan asked for "same response validation as `startTimer`", so this is on-plan, but the next RPC wrapper (S-04 stop) would add a third copy.
- **Fix**: Extract one `parseTimerRow(rows, fnName)` helper in `timer.ts` when the next wrapper is added, not before.
- **Decision**: FIXED — `parseTimerRow(fnName, data)` extracted in src/lib/timer.ts; both wrappers use it (same behaviour and error messages)

### F5 — The "current project excluded from the switch list" rule has no automated evidence

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/pages/w/[token].astro:62-63, src/pages/w/[token].astro:125-141
- **Detail**: The plan's design decision is that switching to the running project is made structurally impossible by excluding it by id. Smoke only asserts that the page opens with a 200 while a timer runs, and `request()` does not expose the body. The rule was confirmed by the user in manual check 3.3 but nothing would fail if the filter regressed.
- **Fix**: Have `request()` return the response text and assert that the running project's name appears only in the tracking line and not in a switch button.
- **Decision**: FIXED — `request()` returns the body; new smoke check asserts the running project is absent from the switch list. Needs a `smoke:local` run to confirm

### F6 — `smoke-local.mjs --restore` stops any Astro dev daemon on the machine

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke-local.mjs:90, scripts/smoke-local.mjs:136
- **Detail**: A normal run refuses to start if port 4321 is busy, but `stopDevServer()` runs `npx astro dev stop` unconditionally, so `--restore` also stops a dev server the developer started themselves. In the review author's own session `astro dev stop` also did not visibly stop the daemon within a minute, so its reliability is unverified.
- **Fix**: State in the script header that `--restore` stops any running Astro dev server.
- **Decision**: FIXED — `--restore` behaviour documented in the scripts/smoke-local.mjs header
