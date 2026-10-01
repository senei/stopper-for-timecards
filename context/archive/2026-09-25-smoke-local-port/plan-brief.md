# Smoke Local Port — Plan Brief

> Full plan: `context/changes/smoke-local-port/plan.md`

## What & Why

`npm run smoke:local` always starts its dev server on port 4321, so two lanes cannot run it at once, and its cleanup calls `astro dev stop` even when the script started nothing. This change makes the port configurable and scopes cleanup to a server the script can attribute to itself. It also corrects the docs, which say `astro dev stop` reaches other lanes' servers; research showed it does not.

## Starting Point

`scripts/smoke-local.mjs` hardcodes 4321 twice (`:25`, `:211`) and always runs `npx astro dev stop` at cleanup and on `--restore`. `astro dev stop` reads `<worktree>/.astro/dev.json`, so it only ever reaches a server registered in the same worktree, including one you started by hand. The follow-up is noted in `parallel-goals.md:111-113`.

## Desired End State

With `SMOKE_LOCAL_PORT` set, a lane runs `smoke:local` on its own port. Cleanup and `--restore` stop the dev server only when Astro's lock file says it is on that port, and say what they did or left alone. A real run refuses, before any database reset, if the worktree already has a live dev server. Docs match. With the variable unset nothing changes.

## Key Decisions Made

| Decision                      | Choice                                                                                                                                                                        | Why (1 sentence)                                                                                                                                                       | Source                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Port setting                  | Environment variable `SMOKE_LOCAL_PORT`, default 4321, validated 1 to 65535                                                                                                   | Matches the `SMOKE_*` names `smoke.mjs` reads and cannot be set by an unrelated tool.                                                                                  | Plan                          |
| Cleanup scope                 | `--restore` runs `astro dev stop` only when the lock file's port equals the configured port; a run's own cleanup stops the live lock's server; a live lock refuses a real run | Astro's lock file needs no memory after an interrupt, and the start refusal makes any live lock during a run the script's own even if Astro fell back to another port. | Plan (refined by plan review) |
| Refusal checks                | One shared check used by both the real refusal and `--dry-run` notes                                                                                                          | The refusals can be verified without any database reset.                                                                                                               | Plan review                   |
| The "kills other lanes" claim | False across worktrees; correct it in the script, README and `parallel-goals.md`                                                                                              | Each worktree has its own `.astro/dev.json`, so the stop command cannot reach another lane.                                                                            | Plan (from discovery)         |
| Lesson                        | Not edited here; the two inaccurate clauses (`lessons.md:28-29`) are quoted for you to fix by hand                                                                            | The lessons file is append-only by convention.                                                                                                                         | Plan                          |
| Verification                  | Manual scenarios with no `db reset`, plus two automated bad-port checks; no unit tests                                                                                        | The behaviour depends on the real Astro daemon and lock file, and the script stays a single zero-dependency file.                                                      | Plan                          |

## Scope

**In scope:** the port variable and its validation, lock-file-scoped cleanup and the early refusal, the script header, `README.md`, and the `parallel-goals.md` section.

**Out of scope:** editing `lessons.md`, `kitchen-sink.astro`'s hardcoded URL, `supabase/config.toml` or slot validation, `smoke.mjs`, CI, a `--port` flag, unit tests.

## Architecture / Approach

The port becomes a validated constant at the top of the script, checked before the `--restore` branch and before Supabase is touched. A small helper reads `.astro/dev.json` and decides ownership; the two refusals stay ahead of the confirmation prompt and the first `db reset`, so refusing never wipes a database. Docs follow once the behaviour has been observed.

## Phases at a Glance

| Phase     | What it delivers                                                                                     | Key risk                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1. Script | Port variable, validation, lock-file-scoped cleanup, early refusal, corrected header; lint once here | Astro's background daemon under agents and the Astro-internal lock format |
| 2. Docs   | README and `parallel-goals.md` updated; false claim removed; follow-up note deleted                  | Docs describing behaviour that was not actually observed                  |

**Prerequisites:** in the worktree run `npm ci` and `npx astro sync` before lint; local Supabase running for `--dry-run` (read-only); ports 4399 and 4400 free. No check may run `db reset` on a stack this lane does not own.
**Estimated effort:** about 1 to 2 sessions for 2 phases, mostly manual scenario checks.

## Open Risks & Assumptions

- The lock file's `port` field is Astro-internal (7.3.2); an Astro upgrade could change it. The script treats an unreadable lock as "no server", so it fails safe by refusing nothing and stopping nothing.
- A stale lock whose pid was reused by another process makes the script refuse to start; the message points to `npx astro dev stop`, which clears stale locks.
- A hand-started server on the same port as `SMOKE_LOCAL_PORT` in the same worktree is indistinguishable from the script's own and would be stopped by `--restore`; one started mid-run would be stopped by that run's cleanup.
- Astro falls back to the next port when the requested one is busy (Vite's `strictPort` is false), so a run's cleanup deliberately does not require a port match.
- The real `--yes` refusals and the complete-run scenario would `db reset` the stack `supabase status` reports if a guard were wrong, so they run only on a lane-owned slot stack; without one they are skipped and noted, and the `--dry-run` notes are the verification.

## Success Criteria (Summary)

- Bad port values fail immediately; lint and formatting pass.
- `--restore` leaves a server on another port running and stops one on the configured port; a running server or a busy port shows up as a `--dry-run` note and makes a real run refuse before any database reset (the real refusal verified only on a lane-owned stack).
- README, script header and `parallel-goals.md` agree with the observed behaviour, with no remaining claim that the stop command reaches other lanes.
