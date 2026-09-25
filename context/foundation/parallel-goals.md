---
project: "Stopper for Timecards"
milestone_id: core-timecard-flow
derived_from: context/foundation/roadmap.md
created: 2026-09-25
updated: 2026-09-25
lesson: m2l6 (10xdevs4)
---

# Parallel goals for M-01 (git worktrees)

Remaining slices: S-04, S-05, S-06, S-07, S-08, S-10. S-01/02/03/09 are done, so S-04, S-07, S-08 and S-10 have no unmet prerequisites and can run in parallel now (wave 1). S-05 and S-06 both need S-04 and start after it merges (wave 2).

Refreshed after loading Module 2 Lesson 6 (`CLAUDE.md`, commit `41987be`), which sets the rules used below:

- One change per worktree, one fresh agent context per worktree. Flow: worktree per change → `/goal` or `claude -p` → PR → review → merge.
- Interactive `/10x-implement <change-id> phase <n>` for complex changes (several phases, manual gates, decisions during execution). `/goal` or `claude -p` only for simple, well-bounded ones.
- Parallelism is capped by review capacity. More agents without review means more unreviewed code, not more throughput.
- Archived changes are read-only. Skills refuse to write under `context/archive/`.

## Execution mode per lane

| Lane | Slice | Mode | Why |
|---|---|---|---|
| 1 | S-08 | `/goal` (or `claude -p` Ralph loop) | Bounded: re-point one worker at the real table, one pgTAP test. No product decisions. |
| 2 | S-07 | `/goal` | One SQL function, one button, one smoke check. The confirmation UX is the only open point and is non-blocking. |
| 3 | S-04 | Interactive `/10x-implement` | Timer logic shared with S-05 and S-06, plus a user-owned threshold decision to confirm mid-plan. |
| 4 | S-10 | Interactive, plan only first | Irreversible action with four open decisions. |
| 5 | S-05 | Interactive `/10x-implement` | Corrections interact with S-03 rounding and S-04 stop. Needs judgment. |
| 6 | S-06 | Interactive `/10x-implement` | Time zone decision and the rounding rule land here. |

Even for the `/goal` lanes, planning is still `/10x-plan` + `/10x-plan-review` in the worktree. `/goal` drives the loop from an approved `plan.md`, not from a blank prompt.

## Review capacity (the real limit)

You are the only reviewer, so do not run all four wave-1 lanes at once. Suggested pacing:

1. **Now:** Lane 1 (S-08) and Lane 3 (S-04) together. S-08 is small and quick to review; S-04 is on the critical path because S-05 and S-06 wait for it.
2. **When S-08 is merged:** start Lane 2 (S-07).
3. **Any time, low review cost:** Lane 4 (S-10) up to an approved plan. It produces documents, not code.
4. **After S-04 merges:** start Lanes 5 and 6, at most two implementing lanes at a time.

Rule of thumb: never more open PRs than you can `/10x-impl-review` in a sitting (start with two).

## Worktrees

One worktree and branch per change, created from `main` at `41987be` or later:

```bash
git worktree add ../x10-dev--curse-time-entry-purge-verified -b time-entry-purge-verified main
git worktree add ../x10-dev--curse-link-regeneration         -b link-regeneration         main
git worktree add ../x10-dev--curse-timer-stop-and-flags      -b timer-stop-and-flags      main
git worktree add ../x10-dev--curse-delete-account            -b delete-account            main
```

Two stale worktrees already exist (`deployment-bootstrap-verification`, `first-timer-start-audit`, both at `f899e1a`). The audit is now archived on `main`, so its worktree can be removed with `git worktree remove` once you confirm nothing is uncommitted there.

## Collision rules

- **Migrations:** each lane picks a distinct timestamp prefix so ordering is decided up front: S-08 `20260925…`, S-07 `20260926…`, S-04 `20260927…`, S-10 `20260928…`. Never edit an existing migration.
- **Hot files:** `src/pages/w/[token].astro` and `src/lib/timer.ts` are touched by more than one lane (S-04, S-07 and S-10 all add UI to the workspace page; S-04, S-05 and S-06 all touch timer logic). Keep edits to these files small and additive, and rebase on `main` before opening the merge.
- **Roadmap:** only `/10x-archive` edits `roadmap.md`, and it does so at merge time, so the lanes never conflict there.
- **Merge order:** S-08, S-07, S-04, then S-10 (highest consequence, gets the most review).
- **PR per lane:** each lane ends in a PR from its own branch; review it (`/10x-impl-review`) before merge, then run `/10x-archive` on `main` after merge, since archiving edits `roadmap.md`.
- **Gate per lane:** `/10x-new` → `/10x-plan` → `/10x-plan-review` → `/10x-implement` → `/10x-impl-review` → `/10x-archive`. The existing checks (`npm run lint`, `npx astro check`, `npm run build`, the pgTAP tests in `supabase/tests/database/`, `scripts/smoke.mjs`) must pass.

## Local databases and dev servers (one stack per database-touching lane)

Worktrees isolate code, not the database. The committed `supabase/config.toml` fixes `project_id = "10x-astro-starter"` and ports 54320 to 54329, so every worktree points at the same local Supabase stack. That breaks parallel lanes:

- `npx supabase db reset` (also inside `npm run smoke:local`) wipes the database under every other lane.
- `scripts/smoke.mjs` refuses to run if any link exists, so it fails when another lane has data in the shared database.
- `scripts/smoke-local.mjs` hardcodes port 4321, and its `--restore` runs `astro dev stop`, which stops any Astro dev server, including another lane's.
- The database holds whichever lane's migrations were applied last, so a pgTAP run can pass or fail against the wrong schema.

**Rule:** a lane that runs `supabase db reset`, `supabase test db` or a smoke script gets its own stack and dev-server port (a *slot*). Checks that need no database (`npm run lint`, `npx astro check`, `npm test -- --run`, and `npm run build` with the env values set) can run in every worktree at once.

### Slots

Slot 0 is the committed default; slots 1 and 2 shift every port by 100 per slot. At most three stacks run at once, which also keeps you inside the "two implementing lanes" review cap. Docker memory per stack has not been measured; watch it.

| Slot | `project_id` | api | db | shadow | pooler | studio | smtp | analytics | edge inspector | Astro dev |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 (default) | `10x-astro-starter` | 54321 | 54322 | 54320 | 54329 | 54323 | 54324 | 54327 | 8083 | 4321 |
| 1 | `stopper-lane-1` | 54421 | 54422 | 54420 | 54429 | 54423 | 54424 | 54427 | 8183 | 4322 |
| 2 | `stopper-lane-2` | 54521 | 54522 | 54520 | 54529 | 54523 | 54524 | 54527 | 8283 | 4323 |

Assign a slot when a lane starts and free it when the lane merges. A lane already running against the default stack keeps slot 0 until it merges; every other database-touching lane takes slot 1 or 2. `main` and throwaway integration worktrees take whichever slot is free.

### Setting up a lane's stack

Run in the lane's worktree, once:

1. `npm ci`, then copy `.env` and `.dev.vars` from the main checkout (both are gitignored, so a new worktree has neither).
2. Edit `supabase/config.toml` for the slot: `project_id` and the ports in the table (`[api]`, `[db]` with `shadow_port`, `[db.pooler]`, `[studio]`, `[local_smtp]`, `[analytics]`, `[edge_runtime] inspector_port`). Leave `[auth.email.smtp] port = 587` alone; it is an external mail server.
3. Keep that edit out of git: `git update-index --skip-worktree supabase/config.toml`. Undo it with `--no-skip-worktree` before a rebase that touches the file.
4. Start the stack with the same exclusions CI uses: `npx supabase start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector,realtime,storage-api,postgres-meta,supavisor`, then read the URL and keys with `npx supabase status -o env`.
5. Point `.env` and `.dev.vars` at the slot's `API_URL` and keys, with Cloudflare's dummy Turnstile keys (the values `smoke-local.mjs` uses).

Run the database checks against it: `npx supabase db reset`, `npx supabase test db`, then the app on the slot's port (`npx astro dev --port 4322`) and `BASE_URL=http://localhost:4322 SMOKE_SUPABASE_URL=<API_URL> SMOKE_SERVICE_ROLE_KEY=<key> SMOKE_ANON_KEY=<key> npm run smoke`. `smoke.mjs` already reads `BASE_URL` and refuses anything but localhost.

Tear down when the lane merges: `npx supabase stop --no-backup` in that worktree, then `git worktree remove`.

### Rules

- Before any `db reset`, `test db` or smoke run, check that `npx supabase status` shows your slot's ports. Never run them against a stack the lane does not own.
- Do not use `npm run smoke:local` in a lane on slot 1 or 2 until it accepts a port; today it starts its dev server on 4321 and its `--restore` stops every Astro dev server. Use the manual smoke command above instead.
- The committed `config.toml` never changes, so CI (which runs the default stack on 4321) is unaffected.
- To test two lanes together, create a throwaway worktree from `main`, merge both branches into it, give it a free slot, and run the full suite once there. Before that, `git merge-tree --write-tree --name-only <branch-a> <branch-b>` reports merge conflicts without touching any working tree.

### Follow-up (not done)

`scripts/smoke-local.mjs` should read its port from an environment variable (it hardcodes 4321 at lines 25 and 211) and limit its cleanup to its own dev server. That is a small change of its own; until it lands, slots 1 and 2 use the manual smoke command.

## Wave 1

### Lane 1: S-08 `time-entry-purge-verified` (isolated, safest)

```
/goal Deliver roadmap slice S-08 (change id time-entry-purge-verified) in this worktree: re-point workers/purge-job at the real time_entries model (project_id/project_name columns, not the placeholder), keep the projects table untouched, add a pgTAP test proving entries older than 90 days are deleted and newer ones and all projects survive, and verify a manual scheduled run writes a job_runs row with status success. Follow /10x-new → /10x-plan → /10x-plan-review → /10x-implement → /10x-impl-review; done when npm run lint, npx astro check, npm run build and the pgTAP suite pass and the impl-review has no open findings. Do not deploy or push; stop before /10x-archive.
```

### Lane 2: S-07 `link-regeneration`

```
/goal Deliver roadmap slice S-07 (change id link-regeneration) in this worktree: a user can regenerate their own private link from the workspace page; the old token stops working immediately (404 through findLinkByToken), the new one lands in the same workspace with all projects and entries intact, and no other user's link changes. Put the atomic swap in a security-definer SQL function following the create_link / start_timer pattern (advisory lock, service_role-only grant), log via logAccess(), and cover it with pgTAP plus a smoke check. Follow /10x-new → /10x-plan → /10x-plan-review → /10x-implement → /10x-impl-review; done when lint, astro check, build, pgTAP and smoke pass with no open review findings. Keep edits to src/pages/w/[token].astro additive. Stop before /10x-archive.
```

Open question for the plan (non-blocking): what the regenerate confirmation looks like, and whether the new link is shown once or stays visible in the UI.

### Lane 3: S-04 `timer-stop-and-flags` (unblocks wave 2)

Interactive lane. Use the goal below to drive `/10x-new` → plan → plan-review, then implement phase by phase with `/10x-implement timer-stop-and-flags phase <n>`, because the threshold decision needs you mid-way.

```
/goal Deliver roadmap slice S-04 (change id timer-stop-and-flags) in this worktree: the user can stop the running timer for the day (closing ended_at through a security-definer stop_timer function modelled on switch_timer, preserving the one-open-entry invariant), and a timer running past a threshold is flagged in the workspace with a prompt to correct it. The "suspiciously long" threshold is a user-owned unknown: implement it as one named constant, propose a default in the plan, and surface it in plan-review for the user to confirm before implementation. Include an API route, typed errors following TimerAlreadyRunningError, pgTAP tests and a smoke check. Follow /10x-new → /10x-plan → /10x-plan-review → /10x-implement → /10x-impl-review; done when lint, astro check, build, pgTAP and smoke pass with no open findings. Stop before /10x-archive.
```

### Lane 4: S-10 `delete-account` (plan only until decisions are made)

S-10 is irreversible, so this goal stops at an approved plan. `research.md` in the archived audit (`context/archive/2026-09-23-first-timer-start-audit/`) has the findings: three foreign keys to `links.id` default to `NO ACTION`, and `access_log.outcome` cannot record a deletion.

```
/goal Produce an approved plan (not code) for roadmap slice S-10 (change id delete-account) in this worktree. Start from context/archive/2026-09-23-first-timer-start-audit/research.md. The plan must resolve, with the user, four decisions: confirmation UX (typed phrase vs two-step), whether deletion gets an audit entry and how given the access_log.outcome check constraint, ON DELETE CASCADE vs an explicit child-before-parent delete function, and refreshing the stale "links are never deleted" comment in the access_log FK migration. Follow /10x-new → /10x-plan → /10x-plan-review; done when plan.md and plan-review.md exist, every decision is recorded in the plan, and the user has approved it. Do not implement anything until asked.
```

## Wave 2 (after S-04 is merged to `main`)

Create these worktrees from the updated `main`.

### Lane 5: S-05 `time-corrections`

Interactive lane: plan with the goal, implement with `/10x-implement time-corrections phase <n>`.

```
/goal Deliver roadmap slice S-05 (change id time-corrections) in this worktree: the user can correct logged time at end of day or start of the next day, including entries closed by stop_timer. The plan must state how corrections stay distinct from live tracking (the risk noted in the roadmap) and how they interact with the per-day 15-minute rounding rule from S-03. Follow /10x-new → /10x-plan → /10x-plan-review → /10x-implement → /10x-impl-review; done when lint, astro check, build, pgTAP and smoke pass with no open findings. Stop before /10x-archive.
```

### Lane 6: S-06 `weekly-grid-summary`

Interactive lane, blocked on a user decision: which time zone defines the Mon–Sun day boundaries. The same decision defines the "day" for S-03's per-day rounding, which is deferred to this slice. Implement with `/10x-implement weekly-grid-summary phase <n>`.

```
/goal Deliver roadmap slice S-06 (change id weekly-grid-summary) in this worktree: a weekly Project/Task/Type/Work Type × Mon–Sun table the user can copy into the company timesheet, with per-day 15-minute round-up applied per project (the S-03 rule). First get the user's decision on the time zone that defines day boundaries and record it in the plan. Follow /10x-new → /10x-plan → /10x-plan-review → /10x-implement → /10x-impl-review; done when the grid matches hand-computed fixtures, and lint, astro check, build, pgTAP and smoke pass with no open findings. Stop before /10x-archive.
```

## Finishing

M-01 closes when all six slices are archived. After the last one, run `/10x-roadmap` to close the milestone.
