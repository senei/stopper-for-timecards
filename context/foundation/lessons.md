# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Warm Vite's cache before starting astro dev after a config change

- **Context**: Starting the astro dev local server (Cloudflare adapter) after any .dev.vars or astro.config.mjs change, on this Windows machine.
- **Problem**: astro dev's daemon has a hard 30s startup timeout. After a .dev.vars or astro.config.mjs change, Vite invalidates its dependency cache and re-bundles from scratch (slow here due to a large prismjs component set), routinely exceeding 30s - the daemon reports 'failed to start' even though nothing is broken, and blind retries can fail 4-5 times in a row. Hit repeatedly during first-timer-start Phase 3 and its follow-up manual re-tests.
- **Rule**: After changing .dev.vars or astro.config.mjs, run `npx astro check` once first (no hard startup timeout, just completes when bundling finishes) to warm Vite's dependency cache, THEN run `npx astro dev` - it reuses the warm cache and starts in seconds instead of hitting the 30s ceiling.
- **Applies to**: implement

## Guard destructive column drops with an explicit precondition check

- **Context**: supabase/migrations/20260922150000_projects_and_timer.sql:34 - any future Supabase/Postgres migration that drops or restructures a column on a table that might not be empty.
- **Problem**: `drop column project` was safe only by accident (the next statement's NOT NULL column addition happened to abort the migration on a non-empty table), not by an explicit assertion.
- **Rule**: Before a migration drops or destructively alters a column on a table that might contain rows, add an explicit precondition check (e.g. a do $$ ... raise exception ... block asserting the table is empty) rather than relying on an incidental NOT NULL constraint elsewhere in the same migration to catch a non-empty table.
- **Applies to**: implement

## A page served with `Referrer-Policy: no-referrer` cannot submit forms in a browser under Astro's origin check

- **Context**: src/pages/w/[token].astro:14, delete.astro:10, 404.astro:5 (fixed in 82b2686) — any Astro SSR page that sets a Referrer-Policy header and contains a `<form method="post">`.
- **Problem**: Under `no-referrer`, browsers send `Origin: null` on same-origin form posts (verified in Chrome: no-referrer gave null, strict-origin gave the real origin). Astro's default `security.checkOrigin` rejects that with a 403 "Cross-site POST form submissions are forbidden" before route code runs, so the browser lands on the /api URL showing that text. scripts/smoke.mjs sets Origin on every request, so smoke and curl checks pass while a real browser cannot submit the form; it shipped with S-02 and was found only by manual testing in timer-switch-rounding Phase 3.
- **Rule**: Use `Referrer-Policy: strict-origin` (never `no-referrer`) on any page that contains a form: it keeps the token out of Referer and still sends a correct Origin. Verify every new form by submitting it in a real browser, not only with smoke or curl, which set Origin themselves.
- **Applies to**: plan, implement, review

## Start astro dev with ASTRO_DEV_BACKGROUND=1 when an AI agent runs it

- **Context**: Starting `astro dev` (directly, or through `npm run smoke:local`) from a Claude Code or other agent session on Astro 7, especially in a fresh worktree.
- **Problem**: Astro 7 detects an AI-agent environment and starts the dev server as a detached background process that must become ready within 30 s (node_modules/astro/dist/cli/dev/index.js:86-91, cli/server.js:148). A fresh worktree's first start took about 114 s, so every attempt was killed with 'Dev server failed to start within 30s' and .astro/dev.log stayed empty. Running `astro check` first or seeding the Vite cache did not help, and each smoke:local retry cost a ~5 minute database reset. Hit five times in timer-stop-and-flags Phase 2.
- **Rule**: When starting the dev server from an agent session, set `ASTRO_DEV_BACKGROUND=1` (for example `ASTRO_DEV_BACKGROUND=1 npx astro dev --port 4321`) so it runs in the foreground with no 30 s limit, run it as a background shell task, and wait for the 'ready' line before sending requests. `npm run smoke:local` starts astro dev itself, so export the variable before running it (verified: `ASTRO_DEV_BACKGROUND=1 npm run smoke:local -- --yes` passed; the server still takes about 2 minutes to become ready, and the script waits up to 3 minutes).
- **Applies to**: implement, impl-review

## Record how each manual Progress row was verified

- **Context**: plan.md Progress rows 3.5, 3.7 and 3.8 (manual-verification rows for UI behaviour in timer-stop-and-flags)
- **Problem**: Rows 3.5 (real-browser Stop), 3.7 (restart after stop) and 3.8 (kitchen sink in light and dark themes) were ticked on the user's confirmation alone; nothing in the diff or the review shows them. The rows checked by script (2.4, 3.6) carry their own evidence.
- **Rule**: When a manual Progress row is ticked on the user's confirmation alone, say so in the phase commit body (for example "3.5, 3.7 and 3.8 confirmed by the user") so the review can tell confirmed-by-person rows from script-verified ones.
- **Applies to**: implement, impl-review

## Clear the ESLint cache if unresolved-type errors appear only in cached runs

- **Context**: `npm run lint` (type-aware `strictTypeChecked`, run with `--cache --cache-strategy content`, cache in node_modules/.cache/eslint/) in a fresh git worktree, or after generated types (`astro sync`) or dependencies change.
- **Problem**: The first lint run in a new worktree happened before Astro's generated types (.astro/types.d.ts) existed, so `import.meta.env` resolved to an error type and 8 `@typescript-eslint/no-unsafe-*` errors were cached. The content cache keys on file content and config, not on type information, so unchanged files replayed those errors on every later run, even after `astro sync`, while a direct uncached `npx eslint <file>` on the same files was clean. It looked like a repo bug and produced a follow-up change (fix-eslint-env-typing).
- **Rule**: In a fresh worktree, run `npx astro sync` before the first `npm run lint`; if lint reports `error typed` or unresolved-type errors that a direct `npx eslint <file>` does not, delete node_modules/.cache/eslint/ and re-run before treating them as real.
- **Applies to**: implement, impl-review

## Give each database-touching worktree lane its own local Supabase stack

- **Context**: Parallel git worktrees of this repo running `supabase db reset`, `supabase test db`, `scripts/smoke.mjs` or `npm run smoke:local` on one machine. `supabase/config.toml` fixes `project_id = "10x-astro-starter"` and ports 54320-54329, and `smoke-local.mjs` hardcodes port 4321.
- **Problem**: Worktrees isolate code, not the database, so all lanes share one local stack: a `db reset` in one lane wipes another's data, `smoke.mjs` refuses to run while another lane's links exist, `astro dev stop` kills the other lane's dev server, and pgTAP runs against whichever lane's migrations were applied last. Hit when two active lanes competed for the same database.
- **Rule**: Before a lane runs any database or smoke check, give it its own stack slot (its own `project_id`, shifted ports and Astro dev port, per `context/foundation/parallel-goals.md`), keep that config edit out of git with `skip-worktree`, and confirm `supabase status` shows the slot's ports before any `db reset`; checks that need no database (lint, astro check, vitest) can still run in every worktree at once.
- **Applies to**: plan, implement

## In a fresh worktree run `npm ci` and `npx astro sync` before lint, and budget for a slow first run

- **Context**: Any new git worktree of this repo, before `npm run lint`, `npx astro check` or `npm run build`. `node_modules/` and `.astro/` are gitignored, so a new worktree has neither, and `eslint.config.js:20` uses type-aware rules (`projectService: true`).
- **Problem**: Without the generated `.astro/types.d.ts`, lint reports false `no-unsafe-*` errors on `import.meta.env` in files nobody touched (9 errors in `src/pages/index.astro`, `dev/kitchen-sink.astro`, `api/links.ts` and `lib/supabase-admin.ts` during time-entry-purge-verified). The script's content-keyed `--cache` can keep serving those stale results after the types appear. A cold type-aware run took about 13 to 15 minutes there, and `astro sync` once ran for over 20 minutes.
- **Rule**: In a new worktree run `npm ci`, then `npx astro sync` (as CI does at `.github/workflows/ci.yml:19`), before any lint or type check; if lint reports unresolved `import.meta.env` types after the types exist, re-run with `npx eslint . --no-cache` rather than trusting cached results. Run lint once, in the last code phase of a plan, as the delete-account plan does.
- **Applies to**: plan, implement

## Stop the workerd process behind `wrangler dev`, not just the task that started it

- **Context**: Local Worker checks with `wrangler dev --test-scheduled` on Windows (for example `workers/purge-job`), especially when the run uses a `.dev.vars` that holds a real service-role key, and before deleting that worktree.
- **Problem**: Stopping the background task only stops the `npx` wrapper. The `wrangler` node process and its `workerd` child keep running, respawn if only the child is killed, and keep listening on the port with the `.dev.vars` values still loaded. They also hold files under `.wrangler/` and `node_modules/miniflare` open, so deleting the worktree fails with "Device or resource busy". Four such processes were left behind in time-entry-purge-verified.
- **Rule**: After a `wrangler dev` run, find the listener with `netstat -ano | grep :<port>`, confirm from its command line that it is your `workerd`, and kill its parent process tree; only then delete `.dev.vars` and the worktree. Prefer a fresh port per run, because `wrangler dev` does not reload a changed `.dev.vars`.
- **Applies to**: implement
