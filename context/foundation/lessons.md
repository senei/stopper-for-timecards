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

## Give each database-touching worktree lane its own local Supabase stack

- **Context**: Parallel git worktrees of this repo running `supabase db reset`, `supabase test db`, `scripts/smoke.mjs` or `npm run smoke:local` on one machine. `supabase/config.toml` fixes `project_id = "10x-astro-starter"` and ports 54320-54329, and `smoke-local.mjs` hardcodes port 4321.
- **Problem**: Worktrees isolate code, not the database, so all lanes share one local stack: a `db reset` in one lane wipes another's data, `smoke.mjs` refuses to run while another lane's links exist, `astro dev stop` kills the other lane's dev server, and pgTAP runs against whichever lane's migrations were applied last. Hit when two active lanes competed for the same database.
- **Rule**: Before a lane runs any database or smoke check, give it its own stack slot (its own `project_id`, shifted ports and Astro dev port, per `context/foundation/parallel-goals.md`), keep that config edit out of git with `skip-worktree`, and confirm `supabase status` shows the slot's ports before any `db reset`; checks that need no database (lint, astro check, vitest) can still run in every worktree at once.
- **Applies to**: plan, implement
