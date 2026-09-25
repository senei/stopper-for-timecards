<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Timer Stop and Flags

- **Plan**: context/changes/timer-stop-and-flags/plan.md
- **Scope**: Full plan (3 of 3 phases)
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-09-25
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Verification at HEAD (9115ed7, branch not rebased on main)

| Gate | Result |
|------|--------|
| `npx vitest run` | PASS, 9 files, 53 tests |
| `npx astro check` | PASS, 0 errors, 0 warnings, 0 hints (48 files) |
| `npm run build` | PASS |
| `npx supabase db reset` + `npx supabase test db` | PASS, 5 files, 69 assertions (15 in stop_timer.test.sql) |
| `npm run smoke:local` | PASS, all steps, including the 8 new S-04 steps |
| `npm run lint` | FAIL, exit 1: 8 errors + 1 warning, none in files this change touched (see F2) |

Manual rows: 1.3, 2.4, 3.6 have script or query evidence; 3.5, 3.7, 3.8 rest on the user's confirmation (see F5).

## Findings

### F1 — Branch is 7 commits behind main (S-08 merged); gates ran on the unrebased tree

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: branch `timer-stop-and-flags`, merge-base b2e18b3
- **Detail**: `main` gained 7 commits (f83752a..c02c6ca, PR #11 for S-08: `20260925120000_purge_time_entries.sql`, `workers/purge-job`, roadmap and context updates). Every gate above passed on this branch alone; none ran with S-08's migration and worker present. Likely merge conflict: `context/foundation/roadmap.md` (S-08 flipped to done next to this branch's S-04 in-progress flip). `origin/timer-stop-and-flags` already holds the p1 and p2 commits (a871863, f032d6c), so a rebase would rewrite pushed history.
- **Fix A ⭐ Recommended**: Merge `main` into the branch, resolve the roadmap conflict, then re-run `npx supabase db reset && npx supabase test db` and `npm run smoke:local`
  - Strength: No history rewrite and no force-push; the two pushed commits stay as they are. Main already uses merge commits for PRs (PR #11).
  - Tradeoff: Adds a merge commit to the branch history.
  - Confidence: HIGH — nothing depends on a rewritten history.
  - Blind spot: How the roadmap.md conflict resolves has not been seen yet.
- **Fix B**: Rebase onto `main` and push with `--force-with-lease`
  - Strength: Linear history, matches the one-change-per-PR flow in parallel-goals.md.
  - Tradeoff: Rewrites 2 already-pushed commits and needs a force-push.
  - Confidence: MEDIUM — unknown whether anyone else built on the pushed branch.
  - Blind spot: Same roadmap.md conflict, replayed per commit.
- **Decision**: PENDING

### F2 — Row 3.1 is ticked while `npm run lint` still exits 1

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: plan.md Progress row 3.1 and the Phase 3 note
- **Detail**: Lint at HEAD reports 8 errors (`@typescript-eslint/no-unsafe-*`, all `import.meta.env` resolving to an error type) in src/lib/link-cookie.ts, src/lib/supabase-admin.ts, src/pages/api/links.ts and src/pages/index.astro, plus one no-console warning in workers/purge-job. None is in a file this change modified; those four files are identical to main. The row was ticked on the user's instruction, with a note in the plan, and the errors are tracked as the separate change `fix-eslint-env-typing` (e00de16).
- **Fix**: Leave as is; resolve `fix-eslint-env-typing` and re-run `npm run lint` before or after archiving.
- **Decision**: FIXED — nothing to edit: the tick and its plan note stay, and `fix-eslint-env-typing` is the resolution path

### F3 — Changes outside the plan's file list

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/foundation/lessons.md:26-32, context/foundation/roadmap.md (S-04 row and item), context/changes/fix-eslint-env-typing/
- **Detail**: Three groups of edits are not in the plan: the new lesson about `ASTRO_DEV_BACKGROUND=1` (plus its later "verified" wording change), the roadmap status flips for S-04, and the new change folder for the lint errors. All were user-directed or required by the skills (roadmap sync), and all are in commit messages, but the plan's "What We're NOT Doing" and Changes Required do not mention them.
- **Fix**: Leave as is, or add a one-line addendum to plan.md listing them.
- **Decision**: FIXED — addendum paragraph added to the Phase 3 block of plan.md listing the three groups of out-of-plan edits

### F4 — `stopTimer` returns `StartTimerResult`, and nothing uses it

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/timer.ts:102 (caller: src/pages/api/w/[token]/timer/stop.ts:33)
- **Detail**: The wrapper validates and returns the closed entry, but its only caller ignores the result, and the type name refers to a start. It mirrors `switchTimer` and reuses `parseTimerRow` as the plan intended, so it is consistent, just slightly misleading.
- **Fix**: Leave; if the type is ever renamed, do it as one small change to all three wrappers.
- **Decision**: FIXED — `StartTimerResult` renamed to `TimerEntryResult` in src/lib/timer.ts (all 5 occurrences); astro check 0 errors, vitest 53/53

### F5 — Three manual rows rest on confirmation only

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: plan.md Progress rows 3.5, 3.7, 3.8
- **Detail**: Rows 3.5 (real-browser Stop), 3.7 (restart) and 3.8 (kitchen sink, light and dark) were confirmed by the user; no artifact in the diff shows them. Row 3.6 was verified by a script over real HTTP, and 2.4 likewise. The local database showed a stop-then-start sequence consistent with 3.5 and 3.7.
- **Fix**: None needed.
- **Decision**: PENDING
