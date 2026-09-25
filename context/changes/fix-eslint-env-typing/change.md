---
change_id: fix-eslint-env-typing
title: Fix ESLint import.meta.env typing errors
status: new
created: 2026-09-25
updated: 2026-09-25
archived_at: null
---

## Notes

Fix the 8 pre-existing ESLint errors that make `npm run lint` exit non-zero on main. All are @typescript-eslint/no-unsafe-* errors caused by `import.meta.env` resolving to an error type: src/lib/link-cookie.ts (15:5 no-unsafe-assignment, 15:29 no-unsafe-member-access .PROD), src/lib/supabase-admin.ts (10:23 and 10:37 no-unsafe-argument), src/pages/api/links.ts (22:24 and 35:51 no-unsafe-argument), src/pages/index.astro (17:33 no-unsafe-argument, 48:49 no-unsafe-assignment). Found 2026-09-25 during timer-stop-and-flags Phase 3 (row 3.1); those four files are byte-identical to main, so the errors pre-date that change. Repo wiring looks correct (.astro/types.d.ts references astro/client, tsconfig includes it) and astro check reports 0 errors, so the cause is unknown: check whether it is specific to this machine/worktree or also fails in CI, and whether ESLint projectService resolves .astro/types.d.ts (the .astro/ directory is gitignored). Note: an earlier full lint run also flagged src/pages/dev/kitchen-sink.astro:10 (.DEV) once, and a later run did not, so results may be flaky.
