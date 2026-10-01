<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Smoke Local Port

- **Plan**: context/changes/smoke-local-port/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-10-01
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Evidence

- Commits: 63d078a (script, plus change/plan/brief/plan-review folder files) and 5d10ac1 (README, parallel-goals.md, Progress SHA write-back in plan.md). Source files touched by the change: `scripts/smoke-local.mjs`, `README.md`, `context/foundation/parallel-goals.md`. `lessons.md`, `src/`, `scripts/smoke.mjs`, `.github/` untouched by these commits (matches "NOT Doing").
- Re-run now (read-only): `SMOKE_LOCAL_PORT=abc` and `=99999` and `=1.5` with the script exit 1 with a message naming `SMOKE_LOCAL_PORT` (1.1, 1.2 hold). `npx prettier --check` on the script, README and parallel-goals.md passes (1.3, 2.1). The 2.2 grep prints nothing. Lint (1.4) was not re-run (cold lint is about 15 minutes and the working tree is busy).
- Progress: 13/14 ticked. 1.10 is legitimately skipped (main lane, default stack, no slot stack).

## Plan-review F1 claim, verified in code

Claim: in-run cleanup stops whatever live lock exists, only `--restore` matches on port. Confirmed in `scripts/smoke-local.mjs:159-175`:

- A child was spawned (`if (child)`, :162): `npx astro dev stop` runs whenever `readDevLock()` returns a live lock, with no comparison to `PORT` (:163).
- No child (`--restore`, or cleanup before the spawn): no lock gives "no dev server to stop" (:165); `lock.port === PORT` stops (:167-169); otherwise it leaves the server alone and names the port (:170-173).
- The only port comparison in the file is :167. The start-time refusal (:251-252, `refusalReason()` at :132-141) sits before `confirm()` (:253) and the first `db reset` (:273), and `--dry-run` shares it (:237-239) and exits 0. So the guarantee the in-run branch relies on holds, apart from the window in F2.
- Port validation (:29, :54-62) runs at module top, before the `--restore` branch (:211) and `supabaseEnv()` (:218). The port reaches the `spawn` shell string only as `String(PORT)` after an `^\d+$` and range check, so there is no injection path.

## Findings

### F1 — Interrupt during dev-server startup can leave the daemon running

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke-local.mjs:160-164
- **Detail**: `stopDevServer` reads the lock once, before killing the child tree. If Ctrl+C or a startup failure lands after the child is spawned but before Astro has written `.astro/dev.json` (cold start is minutes), `lock` is null, `astro dev stop` is skipped, and a daemon started by Astro's agent mode (pid only in the lock) could outlive the run. The message then prints "stopped the dev server this run started" with no port, which is misleading. The old code ran `astro dev stop` unconditionally.
- **Fix**: In the `child` branch, re-read the lock after the tree kill (or run `astro dev stop` unconditionally there, since the refusal guarantees nothing else of ours exists).
- **Decision**: FIXED — `stopDevServer` now kills the child tree first, reads the lock after that, and always runs `astro dev stop` in the child branch (a no-op when nothing is running); the message says "asked Astro to stop" when no live lock was found.

### F2 — The "no one else started a server since the refusal" window is minutes long

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke-local.mjs:251-285 (refusal) to :163 (cleanup)
- **Detail**: Plan-review F1's fix assumed the refusal and the spawn are close in time. Between them are `db reset` and `astro check`, which can take minutes. A dev server started by hand in this worktree in that window is stopped by in-run cleanup, and also makes the spawned server pick a fallback port. The blast radius is one worktree's own dev server, so this is accepted risk, but the assumption in the plan is weaker than written.
- **Fix**: Optional: re-run the live-lock check just before `spawn` and fail if a lock appeared, which also removes the fallback-port confusion.
- **Decision**: ACCEPTED — blast radius is one worktree's own dev server; the optional re-check before the spawn is not worth the added code.

### F3 — Stale lock with a reused pid reads as a live server

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke-local.mjs:108-129
- **Detail**: Liveness is `process.kill(pid, 0)` (EPERM counted as alive). After a crash or reboot, an unrelated process can reuse the pid, so a real run refuses with a message to run `astro dev stop`, which may in turn find nothing to stop. The failure is safe (refuses, never wipes) and the message names the remedy. Not worth code unless it recurs.
- **Fix**: None needed now; if it recurs, tell the user in the message that deleting `.astro/dev.json` clears a stale lock.
- **Decision**: ACCEPTED — fails safe (refuses, never wipes) and the message names the remedy; no code change unless it recurs.

### F4 — Real `--yes` refusals (1.8, 1.9) not evidenced; 1.10 skip not recorded

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: plan.md Progress rows 1.8, 1.9, 1.10
- **Detail**: Rows 1.8 and 1.9 are ticked, but the diff holds no observable evidence of the manual runs (manual items never leave one), and the real `--yes` refusal is only allowed on a lane-owned stack. This is the main lane on the default stack, so likely only the `--dry-run` notes were exercised. The code supports that: the real refusal calls the same `refusalReason()` and sits ahead of `confirm()` and `db reset`. Row 1.10 has no written skip reason in the plan. Not re-run here because it needs a live stack and servers on shared ports.
- **Fix**: Add one line to plan.md or change.md saying 1.10 was skipped (no slot stack) and that 1.8 and 1.9 were verified via `--dry-run` only.
- **Decision**: FIXED — plan.md now records that 1.10 was skipped (no slot stack on this lane) and that 1.8 and 1.9 were verified through the `--dry-run` notes only.

## Notes (not findings)

- Docs match the script: variable name, default 4321, `--restore` port match, slot ports 4322 and 4323 in parallel-goals.md. The false claims at old :73 and :107 are corrected and the follow-up subsection is removed.
- Prettier realigned two tables and one emphasis marker in parallel-goals.md (formatting only; disclosed in 5d10ac1's message).
- `lessons.md:49` still says `smoke-local.mjs` hardcodes 4321 and a nearby clause says `astro dev stop` kills the other lane's server; both are intentionally left for the user (plan "NOT Doing"). The `change.md` status was not set to `impl_reviewed` because this run was limited to writing inside `reviews/`.
