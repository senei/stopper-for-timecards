# Opportunity Map

## Context

- **Project / context**: x10-dev--curse (time-tracking app on Astro 7 + Supabase; 10xDevs M5L1 practical). Signals drafted from this repo's `context/foundation/lessons.md`, `parallel-goals.md`, project memory, git history and the `10x get m5l1 --dry-run` report, then confirmed by the user.
- **Data constraint**: Mock / local / read-only / non-sensitive
- **Date**: 2026-10-12

## Map

| Signal                                                                       | Existing / default response                                                | Thin complement                                       | First useful version                                                    | Data risk                       | Direction if valuable |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------- | --------------------- |
| S3 Fresh worktree: false lint errors, stale ESLint cache, 13–15 min cold run | lessons.md rules (npm ci → astro sync → lint), CI runs `astro sync`        | `worktree-ready` pre-flight check                     | PASS/FAIL script per prerequisite with the exact fix command, read-only | local, read-only, non-sensitive | Internal tool         |
| S4 Manual verification leaves no trace; smoke masks real-browser behaviour   | commit-body convention ("confirmed by the user"); smoke sets Origin itself | evidence-gap report over plan Progress rows + git log | script listing manual rows ticked with no evidence note                 | local, read-only, non-sensitive | Review / CI gate      |
| S5 Course skills conflict with local edits (14 files `conflict_skipped`)     | `10x get/sync --dry-run` lists conflicts, never overwrites                 | none                                                  | none (dry-run output is the report)                                     | local, read-only, non-sensitive | Wait / no build       |

## Recommended First Candidate

```text
Candidate:
manual-evidence-report (working name)

Reads:
context/changes/*/plan.md and context/archive/*/plan.md (Progress rows), git log bodies

Returns:
List of manual-verification rows that were ticked with no note of how they were verified
(per change, with row id and commit SHA)

Does not do:
Judge whether the behaviour is correct, run a browser, edit plans or commits

Data risk:
local, read-only, non-sensitive (repo files and git history only)

Direction if it proves valuable:
Review / CI gate (an extra check in /10x-impl-review)
```

## Why This Candidate

- Recurs on every change that has a manual row, and was named in lessons.md after rows 3.5, 3.7 and 3.8 of timer-stop-and-flags were ticked on word alone.
- Combines two sources (plan Progress rows and git history), which neither shows alone.
- Has a real escaped defect behind it: the `Referrer-Policy: no-referrer` form bug passed smoke and curl and was found only by manual testing.
- Testable read-only on the existing archive (28 archived changes) with no new access.
- Does not replace an existing platform's responsibility; it only reads and reports.
- S3 is the runner-up: it recurs and costs more minutes, but it is already a documented, one-off command sequence. S5 failed the filter because the tool already does the job and the local edits are intentional (essential, not accidental, complexity).

## Next Direction If Valuable

Review / CI gate: if the report proves useful and is read regularly, fold it into `/10x-impl-review` as a check that flags manual rows without evidence. Next step chosen: validate with `/10x-mom-test`, then `/10x-shape` → `/10x-prd` → `/10x-roadmap`.
