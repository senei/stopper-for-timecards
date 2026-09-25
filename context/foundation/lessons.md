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
- **Rule**: When starting the dev server from an agent session, set `ASTRO_DEV_BACKGROUND=1` (for example `ASTRO_DEV_BACKGROUND=1 npx astro dev --port 4321`) so it runs in the foreground with no 30 s limit, run it as a background shell task, and wait for the 'ready' line before sending requests. `npm run smoke:local` starts astro dev itself, so export the variable before running it (expected to work, not yet verified).
- **Applies to**: implement, impl-review
