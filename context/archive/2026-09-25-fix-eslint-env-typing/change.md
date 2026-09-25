---
change_id: fix-eslint-env-typing
title: Fix ESLint import.meta.env typing errors
status: archived
created: 2026-09-25
updated: 2026-09-25
archived_at: 2026-09-25T12:53:05Z
---

## Notes

Fix the 8 pre-existing ESLint errors that make `npm run lint` exit non-zero on main. All are @typescript-eslint/no-unsafe-* errors caused by `import.meta.env` resolving to an error type: src/lib/link-cookie.ts (15:5 no-unsafe-assignment, 15:29 no-unsafe-member-access .PROD), src/lib/supabase-admin.ts (10:23 and 10:37 no-unsafe-argument), src/pages/api/links.ts (22:24 and 35:51 no-unsafe-argument), src/pages/index.astro (17:33 no-unsafe-argument, 48:49 no-unsafe-assignment). Found 2026-09-25 during timer-stop-and-flags Phase 3 (row 3.1); those four files are byte-identical to main, so the errors pre-date that change. Repo wiring looks correct (.astro/types.d.ts references astro/client, tsconfig includes it) and astro check reports 0 errors, so the cause is unknown: check whether it is specific to this machine/worktree or also fails in CI, and whether ESLint projectService resolves .astro/types.d.ts (the .astro/ directory is gitignored). Note: an earlier full lint run also flagged src/pages/dev/kitchen-sink.astro:10 (.DEV) once, and a later run did not, so results may be flaky.

## Resolution (2026-09-25)

Resolved without a code change. The 8 errors were never real and were not present on main: they were stale entries in ESLint's content cache (`--cache --cache-strategy content`, `node_modules/.cache/eslint/`), recorded by the first lint run in this worktree before Astro's generated types (`.astro/types.d.ts`) existed. The cache keys on file content and config, not type information, so unchanged files replayed the errors on every later run, even after `astro sync`. That is also why `kitchen-sink.astro` "vanished" from the list once it was edited (it was re-linted), and why a direct `npx eslint <file>` on the affected files was clean.

Evidence: an uncached `npx eslint` on the four files produced no output; after deleting the cache file, `npm run lint` from a cold cache exited 0 with no errors and no warnings. Recorded as a lesson in `context/foundation/lessons.md` ("Clear the ESLint cache if unresolved-type errors appear only in cached runs"). Nothing was changed in link-cookie.ts, supabase-admin.ts, api/links.ts or index.astro.
