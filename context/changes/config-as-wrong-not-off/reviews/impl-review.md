<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Config as wrong, not off

- **Plan**: context/changes/config-as-wrong-not-off/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-10-05
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Grounding

- Git scope: the entire code diff for this change is in commit `cbb975e` (`git diff --stat cbb975e^..ef0d0cd -- src/`) and touches exactly the five files the plan names: `src/lib/config-check.ts` (new), `src/lib/config-check.test.ts` (new), `src/lib/creation-closed.ts`, `src/lib/creation-closed.test.ts`, `src/pages/index.astro`. No file is in the plan but missing from the diff, and none is in the diff but outside the plan.
- Two subagents reviewed independently: one against the plan's literal "Changes Required" contracts (file by file, test case by test case), one for security/reliability/correctness/pattern-consistency against the codebase's existing conventions (`turnstile.ts`, `log.ts`). Both came back clean — see findings below for the only deviations either noticed, all OBSERVATION-level.
- Automated success criteria, all run against the current `main` (`ef0d0cd`):
  - `npx vitest run`: 273/273 passed.
  - `npx astro check`: 90 files, 0 errors, 0 warnings, 0 hints.
  - `npm run lint`: clean (exit 0, no output).
  - `grep -n "checkSignupConfig" src/pages/index.astro`: prints the import (line 7) and the call (line 28), as required.
  - `grep -n "console\." src/pages/index.astro src/lib/config-check.ts`: no matches, as required.
- Manual Progress rows (1.5, 2.6, 2.7, 2.8) were not rubber-stamped: this session personally ran all three deliberate breaks (isCreationClosed("yes"), dropping the once-per-isolate flag, leaking the kill-switch value) and confirmed each turned the right test red before reverting, and ran the three manual scenarios against a live `astro dev` server with `.dev.vars` toggled and the server restarted each time, confirming the exact log lines, dedup behavior, and unchanged page output claimed by the plan.

## Findings

### F1 — `missingSupabase` filter result isn't narrowed to `string[]`

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/config-check.ts:61-64
- **Detail**: The `.filter((name) => name !== undefined)` on an array typed `(string | undefined)[]` doesn't use a type predicate, so TypeScript still sees the result as `(string | undefined)[]`. `.join()` and `.length` both work correctly regardless, so there's no runtime defect — this is purely a type-narrowing nit.
- **Fix**: Change the filter to `(name): name is string => name !== undefined` if the precision is wanted; not required for correctness.
- **Decision**: PENDING

### F2 — `creation_closed_unrecognised` breaks the `<noun>_<verb>` event-naming order

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/config-check.ts:43
- **Detail**: Existing events follow `<noun>_<verb>` (`turnstile_secret_missing`, `cookie_stale`). `creation_closed_unrecognised` reads as `<noun>_<state>_<verb>` — not wrong, and the plan named this event explicitly, but it's the one new event name that doesn't fall cleanly into the existing shape.
- **Fix**: No action needed — the plan specified this name explicitly and changing it now would just be churn against an already-tested, already-logged event.
- **Decision**: PENDING

### F3 — A returning visitor's redirect happens before the config check runs

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/pages/index.astro:14-17
- **Detail**: `checkSignupConfig` is called after the early redirect for a visitor with a valid link cookie. On an isolate that serves mostly returning visitors, first detection of a config problem could be delayed until the first new/unlinked visitor hits `/`. This matches the plan's explicitly stated scope ("when the landing page renders" — a redirect isn't a render) and was already named as an accepted, isolate-lifetime-driven limitation in the plan's own Migration Notes and in the earlier plan-review's F5.
- **Fix**: No action needed — already an accepted tradeoff, not a new finding requiring a decision.
- **Decision**: PENDING
