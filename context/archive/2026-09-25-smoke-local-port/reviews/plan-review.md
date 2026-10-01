<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Smoke Local Port

- **Plan**: context/changes/smoke-local-port/plan.md
- **Mode**: Deep (claims verified locally, no sub-agent)
- **Date**: 2026-09-25
- **Verdict**: REVISE (light)
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | PASS    |

## Grounding

7/7 planned paths exist (`scripts/smoke-local.mjs`, `scripts/smoke.mjs`, `README.md`, `context/foundation/parallel-goals.md`, `context/foundation/lessons.md`, `.github/workflows/ci.yml`, `src/pages/dev/kitchen-sink.astro`); symbols and line anchors match (`supabaseEnv:47`, `isServerUp:82`, `stopDevServer:92`, `--restore:138`, `confirm:179`, first `db reset:199`); `.astro/` is gitignored; Astro's lock file and per-root `astro dev stop` re-verified (`lockfile.js`, `cli/server.js`); brief↔plan ✓; Progress↔Phase 14/14 ✓. Vite's default `strictPort: false` confirmed (`vite/dist/node/chunks/node.js:24616`) and Astro does not override it.

## Findings

### F1 — Port-matched cleanup can leak the script's own server when Astro falls back to another port

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1, change 2 (`stopDevServer` contract) and Critical Implementation Details
- **Detail**: The plan makes `stopDevServer` run `astro dev stop` only when the lock file's port equals `PORT`, for both in-run cleanup and `--restore`. Astro does not set `strictPort` and Vite's default is `false` (`vite/dist/node/chunks/node.js:24616`), so if the port is taken by something the script's HTTP check (`isServerUp`, `smoke-local.mjs:82-89`) does not detect (a non-HTTP listener, or one that does not answer within 2 seconds), the dev server it starts moves to PORT+1. The readiness poll on `BASE_URL` then times out, cleanup sees lock port ≠ `PORT`, and the script's own server keeps running. Today's unconditional `astro dev stop` would have stopped it, so the plan adds a regression for the normal (non-`--restore`) path.
- **Fix A ⭐ Recommended**: In-run cleanup stops whatever live lock exists; only `--restore` matches on port
  - Strength: The start-time refusal already guarantees no live lock existed, so any live lock during a run is the script's own; a fallback port no longer leaks. `--restore`, which has no memory of the run, keeps the port match.
  - Tradeoff: A dev server someone starts by hand in the same worktree during a run would also be stopped.
  - Confidence: HIGH — follows from the refusal ordering already in the plan.
  - Blind spot: Assumes the refusal check and the spawn are close enough in time that no one starts a server between them.
- **Fix B**: Keep port-matched cleanup, and after the readiness wait, check that the lock's port equals `PORT`; if not, fail with a message naming the port Astro chose and stop that server
  - Strength: Surfaces the port collision as a clear error instead of a 3-minute timeout, and the cleanup rule stays uniform.
  - Tradeoff: More code, and it needs the lock read at a moment when the server may not have written it yet.
  - Confidence: MEDIUM — depends on lock timing at start.
  - Blind spot: Behaviour when the lock file appears late is unverified.
- **Decision**: FIXED (Fix A) — in-run cleanup stops the live lock's server; only `--restore` matches on port. Plan Desired End State, Phase 1 contract and Critical Implementation Details updated, plus the brief's decision table and risks.

### F2 — The `--yes` refusal scenarios can `db reset` the shared stack if the new guard is wrong

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 manual criteria 1.8 and 1.9, and the Implementation Note
- **Detail**: Criteria 1.8 and 1.9 run `npm run smoke:local -- --yes` and expect a refusal before any reset. The script picks its Supabase stack from `npx supabase status` in the current worktree, which is the shared default stack (`project_id = "10x-astro-starter"`) unless this lane has its own slot. If the refusal is implemented wrongly, the first real reset (`smoke-local.mjs:199`) wipes every other lane's database, the exact collision this change and the newly committed lesson are about. The Implementation Note says never to run `db reset` on a stack the lane does not own, but the scenarios themselves risk it. Also, 1.8 and 1.9 need a running Supabase (the refusal checks sit after `supabaseEnv()`), while 1.6 and 1.7 do not; the prerequisites mention only `--dry-run`.
- **Fix A ⭐ Recommended**: Make `--dry-run` report both refusal conditions (live lock and busy port) as "a real run would refuse" notes, verify the refusals through `--dry-run`, and run the real `--yes` refusals only when `npx supabase status` shows a lane-owned stack (skip and say so otherwise)
  - Strength: The refusal logic is exercised on every machine with no possible reset, and the risky variant runs only where a wrong guard is harmless.
  - Tradeoff: The busy-port note is a small addition to Phase 1 (the plan currently has a dry-run note only for the live lock); the real refusals may go unverified without a slot stack.
  - Confidence: HIGH — dry-run exits before the refusals today, so surfacing them there is a contained change.
  - Blind spot: A dry-run note shares code with the real refusal only if implemented that way; the implementation should call one shared check.
- **Fix B**: Keep 1.8 and 1.9 as written and add a first manual step that prints `npx supabase status` and aborts unless its ports belong to this lane
  - Strength: No change to the script's dry-run behaviour.
  - Tradeoff: Relies on the person running the scenarios to notice the ports; a slip still resets a shared stack.
  - Confidence: MEDIUM — a checklist step protects only as well as it is followed.
  - Blind spot: How reliably the ports can be recognised as a slot's ports without a marker is unverified.
- **Decision**: FIXED (Fix A) — `--dry-run` reports both refusal conditions through one shared check; criteria 1.8 and 1.9 now verify through the dry-run notes and run the real `--yes` refusals only on a lane-owned stack; per-scenario Supabase prerequisites added. Plan and brief updated; Progress rows 1.8 and 1.9 mirrored.
