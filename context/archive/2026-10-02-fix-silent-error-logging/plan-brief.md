# Fix silent error logging — Plan Brief

> Full plan: `context/changes/fix-silent-error-logging/plan.md`
> Audit used as frame and research: `context/audits/observability/2026-10-02_timer-delete-link-grid.md`

## What & Why

Add one structured logger and a `cause`-preserving error helper, then route every silent or thin error site in `src` through them. The audit showed that a database outage on the workspace or grid page leaves only a request line in Workers Logs, and that every other failure logs a static string with the database code, link id and route missing. This change makes those failures diagnosable without changing any user-facing response.

## Starting Point

12 bare `catch {` (plus one client-side fallback that stays), 13 data-layer rethrows that keep only `error.message`, and 15 `console.error` calls with an `eslint-disable` each. Route and lib tests already spy on `console.error` and mock the admin client, so the new logger fits their patterns. The audit's probe harness exists in an isolated worktree and holds the "before" results.

## Desired End State

Every backend failure on a page or API route produces one JSON log line with `event`, `route`, link id where known, and the database `code`, `details`, `hint` and `cause`. Race backstops and form-parse failures produce a warning. Responses (303, 503, 404) are byte-for-byte the same. ESLint rejects a new bare `catch` or a stray `console` call. Rerunning the probe suite proves it.

## Key Decisions Made

| Decision          | Choice                                                                                      | Why (1 sentence)                                                                                                        | Source |
| ----------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------ |
| Scope             | Logger + cause + all silent catches and console sites; no response changes                  | Closes audit F1, F4, F5, F14 and part of F7 in one coherent change with runtime proof.                                  | Plan   |
| Cause handling    | `new Error(msg, { cause })` via a `dbError` helper; logger flattens `code`/`details`/`hint` | Smallest diff at 13 sites, messages and tests unchanged, and the shape does not depend on how a runtime prints `cause`. | Plan   |
| Expected outcomes | `warn` for timer backstops and `ProjectInUse`; 404s stay unlogged                           | Race bugs become countable while attacker-steerable 404 volume cannot flood logs.                                       | Plan   |
| Format            | One JSON line per event, `console.error` / `console.warn`                                   | Existing tests spy on `console.error`, and Workers Logs parses JSON lines into fields.                                  | Plan   |
| Guard             | ESLint `catch` without binding and `no-console` as errors, scoped to `src`                  | Prevents the same class of silent catch from returning.                                                                 | Plan   |
| Proof             | Rerun the audit's probe suite and compare to the baseline                                   | Turns "we think it's fixed" into observed before/after rows.                                                            | Plan   |
| Identifier        | Log `link.id`, never the URL token                                                          | The token is the credential; the id is safe and joins to `access_log`.                                                  | Audit  |

## Scope

**In scope:** `src/lib/log.ts`, `src/lib/db-error.ts`, 13 data-layer rethrows, `access-log`, `link-cookie` and `turnstile` catches, seven API routes, six page files (seven catches), ESLint guard, tests, probe rerun.

**Out of scope:** Turnstile result type (F2), `access_log` fail-open and rotation event (F10), purge worker (F20–F22), `500.astro` and middleware, wrapping unguarded page reads (it would turn 500 into 503), events for `full`/`busy`/`closed`, 404 logging, release tag, token-in-URL decision.

## Architecture / Approach

Bottom-up so every phase ends green: shared pieces first (pure additions), then the data layer, then routes, then pages together with the lint guard (which would fail earlier). The last phase reuses the audit's probe harness, checks status codes against the baseline and looks for log lines and database codes in the formerly silent rows.

## Phases at a Glance

| Phase                          | What it delivers                                        | Key risk                                                   |
| ------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------- |
| 1. Logger and error helper     | `log.ts`, `db-error.ts`, unit tests                     | Output shape must be right before 25 sites depend on it    |
| 2. Data layer keeps the cause  | 13 rethrows via `dbError`, three helpers log            | Messages must not drift (callers and tests match them)     |
| 3. API routes log with context | Events with route and ids, warnings for backstops       | Tokens must not leak into log lines                        |
| 4. Pages and the lint guard    | Page catches log; ESLint forbids the pattern            | Cold type-aware lint is slow; false unresolved-type errors |
| 5. Runtime proof               | Probe rerun, before/after table, optional verify report | Needs the local Supabase stack and the old worktree        |

**Prerequisites:** local Supabase stack running for phase 5; the probe worktree `.claude/worktrees/agent-a992330e2542a0e09` still present.
**Estimated effort:** about 3–4 sessions across 5 phases; phases 1–3 are quick, phase 4 is dominated by lint time.

## Open Risks & Assumptions

- Assumed: Workers Logs parse JSON log lines into fields; the local workerd output cannot confirm that, only that the line appears.
- A reader who saved Workers Logs queries on the old static strings must move to the `event` field.
- Errors that escape to Astro's own 500 handler remain thin (stack only, no `cause`); that is a later change.
- The `Origin`/form-posting lesson does not apply: no forms or headers change.

## Success Criteria (Summary)

- A database failure on the workspace, grid, delete and regenerate pages leaves a log line with the event and route.
- A failed timer, delete or link-creation RPC logs the database `code` and the link id, and no log line contains the token.
- All HTTP statuses in the probe suite match the baseline, and lint blocks any new bare `catch`.
