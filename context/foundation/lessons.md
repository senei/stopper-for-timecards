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
