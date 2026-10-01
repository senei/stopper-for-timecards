# Smoke Local Port Implementation Plan

## Overview

`scripts/smoke-local.mjs` gets a configurable dev-server port (`SMOKE_LOCAL_PORT`, default 4321) and a cleanup that only stops a dev server Astro's own lock file says is on that port. The docs stop claiming that `astro dev stop` reaches other lanes' servers, because it does not; the real cross-lane problem is the hardcoded port. This is the follow-up recorded in `context/foundation/parallel-goals.md:111-113`.

## Current State Analysis

- The port is hardcoded twice: `BASE_URL = "http://localhost:4321"` (`scripts/smoke-local.mjs:25`) and `spawn("npx", ["astro", "dev", "--port", "4321"], …)` (`:211`). Every other use derives from `BASE_URL`: the readiness poll (`:125`, `:135`), the dev-server-already-up refusal (`:84`, `:177`), the printed plan (`:158`), the ready message (`:221`) and the smoke run's `BASE_URL` (`:229`). `scripts/smoke.mjs:11` already reads `BASE_URL` from the environment, so it needs no change.
- Cleanup: `stopDevServer` always runs `npx astro dev stop`, then kills the spawned child tree (`:91-102`). `--restore` calls it with no child (`:138-143`), so it runs even when the script started nothing. The header comment says it "stops ANY running Astro dev server" (`:8-9`).
- **That claim is only true within one worktree.** `astro dev stop` resolves the project root (the current directory) and reads `<root>/.astro/dev.json` (Astro 7.3.2: `node_modules/astro/dist/cli/server.js:170-183`, `node_modules/astro/dist/core/dev/lockfile.js:5-10,122-136`). Each worktree has its own `.astro/`, so it cannot stop another lane's server. What it does stop is any server registered in _this_ worktree, including one started by hand on another port.
- The lock file holds `pid`, `port`, `url`, `background`, `startedAt` (`lockfile.js:21-34`). Under an AI agent, `astro dev` detaches into a background daemon and the spawned child exits 0 (`node_modules/astro/dist/cli/dev/index.js:86-119`; the script already handles this at `:119-122`), so the daemon's pid is recorded only in the lock file.
- The two refusal checks (leftover `*.smoke-bak` files, something already listening) sit before `confirm()` and before the first `db reset` (`:169-179`, `:199`), so a refusal never wipes a database.
- The false claim appears in `parallel-goals.md:73` and `:107` and in `lessons.md:29` ("`astro dev stop` kills the other lane's dev server"). The follow-up note is `parallel-goals.md:113`; `README.md:45` documents `smoke:local` without a port.
- Relevant team lessons (`context/foundation/lessons.md`): run `npm ci` and `npx astro sync` before lint and lint once in the last code phase; give each database-touching lane its own stack, and never run `db reset` against a stack the lane does not own.

## Desired End State

- `SMOKE_LOCAL_PORT` (integer 1 to 65535, default 4321) sets the dev-server port for `smoke:local`; an invalid value fails immediately, before anything is touched.
- A real run refuses to start when this worktree already has a live Astro dev server (per `.astro/dev.json`), before any database reset; `--dry-run` reports that, and a busy port, as notes.
- `--restore` runs `astro dev stop` only when the live lock file's port equals the configured port; a run's own cleanup stops the live lock's server, because the start-time refusal guarantees no other server existed. Both print what they did or what they left alone.
- The script header, `README.md` and `parallel-goals.md` describe exactly that. With the default port, behaviour and CI are unchanged.
- Verify: the automated checks in both phases pass, and the manual scenarios in Phase 1 behave as listed.

### Key Discoveries:

- Lock file location and format, and per-root scoping of `astro dev stop` (see Current State).
- The existing refusal order already protects the database; the new check must join it.
- `scripts/smoke.mjs` and CI (`.github/workflows/ci.yml:56-58`) already work on any port through `BASE_URL`.

## What We're NOT Doing

- Not editing `context/foundation/lessons.md`: it is append-only by convention. The inaccurate clauses are at lines 28 (says `smoke-local.mjs` hardcodes 4321, true only until this lands) and 29 (says `astro dev stop` kills the other lane's dev server); the user edits them by hand.
- Not changing `src/pages/dev/kitchen-sink.astro:30`, a dev-only page that displays `http://localhost:4321/…`.
- Not changing `supabase/config.toml`, the slot table or how the script chooses a Supabase stack (`supabase status` still decides), and not adding a slot-port validation.
- Not changing `scripts/smoke.mjs` or CI, and not adding a `--port` flag (decision: environment variable).
- Not adding automated unit tests or splitting the script into modules (decision: manual verification; the script stays a single zero-dependency file).
- Not using `--ignore-lock` or changing Astro's dev flags.

## Implementation Approach

One small script change, then the docs that describe it. The port becomes a validated constant at the top of the script and every existing use follows from it. Ownership of a dev server is decided from Astro's own lock file rather than from a state file of our own, so `--restore` works after an interrupted run without memory of the earlier process. Docs follow only after the behaviour has been checked by hand, so they describe what was observed.

## Critical Implementation Details

- **Ordering**: validate `SMOKE_LOCAL_PORT` before the `--restore` branch and before `supabaseEnv()`, so a bad value fails without touching Supabase or any file (this is what makes criteria 1.1 and 1.2 runnable with no database).
- **Daemon**: the process that serves requests may be Astro's background daemon, not the spawned child, so cleanup must keep the existing child-tree kill and use the lock file (never the child's pid) to decide whether to call `astro dev stop`. The lock's port can also differ from `PORT` (Astro falls back to the next port when it is busy), so a run's own cleanup must not require a port match.
- **Refusal order**: the new live-lock refusal belongs in the same block as the existing refusals, ahead of `confirm()` and the first `db reset`, so refusing never wipes a database. `--dry-run` surfaces the same reason as a note through the shared check and never exits non-zero.

## Phase 1: Script — port variable and lock-file-scoped cleanup

### Overview

Make the port configurable and validated, and scope cleanup to a dev server the lock file attributes to the configured port. Lint runs once, here, as the last code phase.

**Prerequisites in this worktree:** `npm ci`, then `npx astro sync` before lint (a fresh worktree has neither; a cold lint takes about 15 minutes). Scenarios 1.5, 1.8 and 1.9 run `npx supabase status` (read-only) and need a running local Supabase; 1.6 and 1.7 do not. The `--yes` variants in 1.8 and 1.9 would `db reset` the stack `supabase status` reports if the refusal were wrong, so run them only when that stack is owned by this lane (its own slot, per `parallel-goals.md`); otherwise verify through the `--dry-run` notes and say the real refusal was not exercised.

### Changes Required:

#### 1. Port variable and validation

**File**: `scripts/smoke-local.mjs`

**Intent**: Replace the hardcoded 4321 with a port taken from `SMOKE_LOCAL_PORT`, defaulting to 4321, and reject invalid values at once.

**Contract**: A top-level `PORT` parsed from `process.env.SMOKE_LOCAL_PORT` (unset or empty means 4321); accepted only as an integer from 1 to 65535, otherwise `fail("SMOKE_LOCAL_PORT must be an integer from 1 to 65535 (got …)")`. `BASE_URL` is `http://localhost:${PORT}` and the `astro dev --port` argument uses `PORT`. The check runs before the `--restore` branch and before `supabaseEnv()`. The printed plan (`--dry-run`) already shows `BASE_URL`, so it shows the chosen port.

#### 2. Lock-file-scoped cleanup and refusal

**File**: `scripts/smoke-local.mjs`

**Intent**: Stop only a server Astro's lock file attributes to the configured port, and refuse to start when this worktree already has a live server.

**Contract**: A helper reads `.astro/dev.json` from the current directory and returns `{ pid, port }` when it parses and its pid is alive (`process.kill(pid, 0)`), else `null`. A second, shared check returns the reason a real run would refuse, or nothing: a live lock (naming that server's port and `npx astro dev stop`), or something already listening on `${BASE_URL}` (naming the configured port). The real refusal (before `confirm()`) calls `fail(...)` with that reason, and `--dry-run` prints the same reason as a note ("a real run would refuse") without exiting non-zero, so both paths share one implementation. `stopDevServer(child)` first kills the spawned child tree as today. For a run's own cleanup (a child was spawned this run) it then runs `npx astro dev stop` whenever the helper reports a live lock, whatever its port: the refusal guaranteed that no live lock existed at start, and Astro falls back to another port when the requested one is busy (Vite's `strictPort` defaults to false), so the lock's port can differ from `PORT`. For `--restore` (no child and no memory of the run) it runs `npx astro dev stop` only when the live lock's port equals `PORT`. It prints one of: stopped the server (naming its port), left a server on a different port alone (naming that port; `--restore` only), or nothing to stop.

#### 3. Header comment

**File**: `scripts/smoke-local.mjs`

**Intent**: Make the header say what the script does now.

**Contract**: Document `SMOKE_LOCAL_PORT` (default 4321) and replace the "stops ANY running Astro dev server" note with: `--restore` and cleanup stop the worktree's dev server only when its lock file port equals the configured port.

### Success Criteria:

#### Automated Verification:

- A non-numeric port is rejected before anything runs: `SMOKE_LOCAL_PORT=abc node scripts/smoke-local.mjs --dry-run` exits non-zero and the message names `SMOKE_LOCAL_PORT`
- An out-of-range port is rejected the same way: `SMOKE_LOCAL_PORT=99999 node scripts/smoke-local.mjs --dry-run` exits non-zero and the message names `SMOKE_LOCAL_PORT`
- Formatting passes: `npx prettier --check scripts/smoke-local.mjs`
- Linting passes, run once here after `npm ci` and `npx astro sync`: `npm run lint`

#### Manual Verification:

- `npm run smoke:local -- --dry-run` prints the dev server on `http://localhost:4321` when the variable is unset and on `http://localhost:4399` with `SMOKE_LOCAL_PORT=4399`, and changes nothing
- With a dev server started by hand in this worktree on port 4400, `SMOKE_LOCAL_PORT=4399 npm run smoke:local -- --restore` leaves it running and says so, and then `SMOKE_LOCAL_PORT=4400 npm run smoke:local -- --restore` stops it
- With no dev server running, `npm run smoke:local -- --restore` reports that there was nothing to stop and does not stop anything
- With a dev server running in this worktree, `--dry-run` prints a note that a real run would refuse, naming that server's port, without failing; and, only on a lane-owned stack, `npm run smoke:local -- --yes` refuses before any database reset
- With another process listening on the configured port, `--dry-run` prints a note that a real run would refuse, naming the port, without failing; and, only on a lane-owned stack, `npm run smoke:local -- --yes` refuses before any database reset
- If this lane has its own slot stack, one complete `SMOKE_LOCAL_PORT=<slot port> npm run smoke:local` passes and leaves no server running (skip and say so when there is no slot stack)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan. Never run `npx supabase db reset` (or a complete `smoke:local` run) against a stack this lane does not own.

---

## Phase 2: Docs — describe the new behaviour

### Overview

Correct the false claim and document the variable, after Phase 1 has confirmed how the script behaves.

### Changes Required:

#### 1. README

**File**: `README.md`

**Intent**: Tell readers the dev-server port is configurable.

**Contract**: The `npm run smoke:local` bullet (`:45`) mentions `SMOKE_LOCAL_PORT` (default 4321), one clause.

#### 2. Parallel goals

**File**: `context/foundation/parallel-goals.md`

**Intent**: Fix the inaccurate statements and remove the restriction and follow-up that this change resolves.

**Contract**: In the "Local databases and dev servers" section: reword the bullet at `:73` to say the port was hardcoded so two lanes on 4321 collide, and that `astro dev stop` is per worktree (own `.astro/dev.json`) and cannot reach another lane; replace the rule at `:107` with: on slot 1 or 2, run `SMOKE_LOCAL_PORT=<the slot's Astro dev port> npm run smoke:local`, after checking that `npx supabase status` shows the lane's ports, because it runs `db reset`; delete the "Follow-up (not done)" subsection at `:111-113`; and in the manual smoke paragraph (`:100`) mention the variable as the shorter alternative. The slot table is unchanged.

### Success Criteria:

#### Automated Verification:

- Formatting passes: `npx prettier --check README.md context/foundation/parallel-goals.md`
- The false claim is gone from the docs and script: `grep -rnE "stops (any|every) Astro dev server" README.md context/foundation/parallel-goals.md scripts/smoke-local.mjs` prints nothing

#### Manual Verification:

- README, the script header and `parallel-goals.md` agree with what Phase 1 verified: variable name, default, `--restore` behaviour, and the slot Astro ports 4322 and 4323 used as `SMOKE_LOCAL_PORT` values
- `lessons.md` is unchanged, and the two clauses to correct by hand (lines 28 and 29) are quoted in the phase report for the user

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- None added (decision). The two automated Phase 1 criteria exercise the port validation by exit code and message.

### Integration Tests:

- The Phase 1 manual scenarios exercise the real Astro lock file and daemon on Windows: dry-run port, `--restore` against a hand-started server on another port (survives) and on the configured port (stopped), nothing-to-stop, and the two refusal conditions through `--dry-run` notes (the real `--yes` refusals only on a lane-owned stack).

### Manual Testing Steps:

1. Start `npx astro dev --port 4400` by hand in this worktree; note its pid and port with `npx astro dev status`.
2. Run the `--restore` scenarios and the refusal scenarios from the Phase 1 list, checking after each that the server is still or no longer running as expected.
3. Stop the hand-started server and run the nothing-to-stop scenario.

## Performance Considerations

None. The change reads one small JSON file at start and at cleanup.

## Migration Notes

With `SMOKE_LOCAL_PORT` unset the script behaves as before (port 4321), so existing use and CI are unaffected. One visible difference: a live Astro dev server already registered in the worktree now makes the script refuse early with a clear message, where previously `astro dev` itself would fail later with "Another astro dev server is already running".

## References

- Follow-up note: `context/foundation/parallel-goals.md:111-113`; the section it belongs to: `:67-113`
- Lesson (do not edit here): `context/foundation/lessons.md:26-31` (shared local stack), plus the fresh-worktree lint lesson below it
- Astro 7.3.2 lock file and stop: `node_modules/astro/dist/core/dev/lockfile.js`, `node_modules/astro/dist/cli/server.js`, `node_modules/astro/dist/cli/dev/index.js`
- CI use of port 4321 (unchanged): `.github/workflows/ci.yml:56-58`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Script — port variable and lock-file-scoped cleanup

#### Automated

- [x] 1.1 A non-numeric port is rejected before anything runs: `SMOKE_LOCAL_PORT=abc node scripts/smoke-local.mjs --dry-run` exits non-zero and the message names `SMOKE_LOCAL_PORT` — 63d078a
- [x] 1.2 An out-of-range port is rejected the same way: `SMOKE_LOCAL_PORT=99999 node scripts/smoke-local.mjs --dry-run` exits non-zero and the message names `SMOKE_LOCAL_PORT` — 63d078a
- [x] 1.3 Formatting passes: `npx prettier --check scripts/smoke-local.mjs` — 63d078a
- [x] 1.4 Linting passes, run once here after `npm ci` and `npx astro sync`: `npm run lint` — 63d078a

#### Manual

- [x] 1.5 `npm run smoke:local -- --dry-run` prints the dev server on `http://localhost:4321` when the variable is unset and on `http://localhost:4399` with `SMOKE_LOCAL_PORT=4399`, and changes nothing — 63d078a
- [x] 1.6 With a dev server started by hand in this worktree on port 4400, `SMOKE_LOCAL_PORT=4399 npm run smoke:local -- --restore` leaves it running and says so, and then `SMOKE_LOCAL_PORT=4400 npm run smoke:local -- --restore` stops it — 63d078a
- [x] 1.7 With no dev server running, `npm run smoke:local -- --restore` reports that there was nothing to stop and does not stop anything — 63d078a
- [x] 1.8 With a dev server running in this worktree, `--dry-run` prints a note that a real run would refuse, naming that server's port, without failing; and, only on a lane-owned stack, `npm run smoke:local -- --yes` refuses before any database reset — 63d078a
- [x] 1.9 With another process listening on the configured port, `--dry-run` prints a note that a real run would refuse, naming the port, without failing; and, only on a lane-owned stack, `npm run smoke:local -- --yes` refuses before any database reset — 63d078a
- [ ] 1.10 If this lane has its own slot stack, one complete `SMOKE_LOCAL_PORT=<slot port> npm run smoke:local` passes and leaves no server running (skip and say so when there is no slot stack)
  - Skipped on 2026-10-01: this is the main lane with the default Supabase stack and no slot stack, so the plan's skip rule applies. Rows 1.8 and 1.9 were verified through the `--dry-run` notes only (the real `--yes` refusals run only on a lane-owned stack).

### Phase 2: Docs — describe the new behaviour

#### Automated

- [x] 2.1 Formatting passes: `npx prettier --check README.md context/foundation/parallel-goals.md` — 5d10ac1
- [x] 2.2 The false claim is gone from the docs and script: `grep -rnE "stops (any|every) Astro dev server" README.md context/foundation/parallel-goals.md scripts/smoke-local.mjs` prints nothing — 5d10ac1

#### Manual

- [x] 2.3 README, the script header and `parallel-goals.md` agree with what Phase 1 verified: variable name, default, `--restore` behaviour, and the slot Astro ports 4322 and 4323 used as `SMOKE_LOCAL_PORT` values — 5d10ac1
- [x] 2.4 `lessons.md` is unchanged, and the two clauses to correct by hand (lines 28 and 29) are quoted in the phase report for the user — 5d10ac1
