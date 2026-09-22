# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Warm Vite's cache before starting astro dev after a config change

- **Context**: Starting the astro dev local server (Cloudflare adapter) after any .dev.vars or astro.config.mjs change, on this Windows machine.
- **Problem**: astro dev's daemon has a hard 30s startup timeout. After a .dev.vars or astro.config.mjs change, Vite invalidates its dependency cache and re-bundles from scratch (slow here due to a large prismjs component set), routinely exceeding 30s - the daemon reports 'failed to start' even though nothing is broken, and blind retries can fail 4-5 times in a row. Hit repeatedly during first-timer-start Phase 3 and its follow-up manual re-tests.
- **Rule**: After changing .dev.vars or astro.config.mjs, run `npx astro check` once first (no hard startup timeout, just completes when bundling finishes) to warm Vite's dependency cache, THEN run `npx astro dev` - it reuses the warm cache and starts in seconds instead of hitting the 30s ceiling.
- **Applies to**: implement
