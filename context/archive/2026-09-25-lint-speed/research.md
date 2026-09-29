---
date: 2026-09-25T15:33:19+02:00
researcher: senei web
git_commit: c4bdfefd77c70958d22ca639c5270cfec6edaa08
branch: main
repository: x10-dev--curse
topic: "lint-speed: why does npm run lint feel slow (4 to 15 minutes cold), and what would make it faster?"
tags: [research, codebase, eslint, prettier, typescript-eslint, astro-check, lint-staged, ci]
status: partial
last_updated: 2026-09-25
last_updated_by: senei web
---

# Research: lint-speed — why does lint feel slow, and what would make it faster?

**Date**: 2026-09-25T15:33:19+02:00
**Researcher**: senei web
**Git Commit**: c4bdfefd77c70958d22ca639c5270cfec6edaa08
**Branch**: main (primary checkout; working tree clean apart from the untracked `context/changes/lint-speed/`)
**Repository**: x10-dev--curse

## Research Question

`npm run lint` has been recorded taking 13 to 15 minutes on a fresh worktree during S-08 work (`context/foundation/lessons.md:57`), and a similar multi-minute wait was seen in the S-04 worktree (not timed or recorded there). Where does the time go, what is the steady-state cost, and which changes would make lint (and the neighbouring `astro sync` / `astro check` steps) faster without weakening what it checks? `astro check` was added to the scope on the user's request.

Scope: the ESLint/Prettier/lint-staged setup, CI ordering, and measured timings on this machine (Windows 11, primary checkout). Not in scope: changing any configuration.

## Summary

- **The steady-state cost is small.** In the primary checkout at `c4bdfef`, with no ESLint result cache, a full lint of the 47 linted files took 33 s (direct `node`), 45 s (`npm run lint` with an empty cache), and 61 s (`npx`, with `TIMING=1` and `--stats`). With a warm cache, `npm run lint` took 12 s. Every run exited 0 with no problems reported.
- **The multi-minute runs are not explained by the configuration.** The very first full run took 253 s and the identical command later took 61 s. In that first run one file's parse time was 55.3 s (`astro.config.mjs`); in the later run it was 5.3 s. The recorded 13 to 15 minute runs (`lessons.md:57`) happened in a fresh worktree. The cause of the slow first runs is **not determined** (see Open Questions); it is the reason this research is `partial`.
- **One file accounts for about half of the measured cost.** `workers/purge-job/worker-configuration.d.ts` is a tracked, Wrangler-generated file of 15,384 lines. In the second full run it took 20.9 s of 40.4 s of parse-plus-rule time (52%), and Prettier alone took 20.1 s of Prettier's 22.3 s (90%). Ignoring it dropped a full uncached run from 33 s to 20 s (one run each).
- **Type-aware rules are cheap here.** The costliest, `@typescript-eslint/no-deprecated`, took 1.9 to 3.1 s in total across 45 files; no other type-aware rule exceeded 1 s in the first run's timing table.
- **Fixed costs.** `npx` alone adds about 9 s per invocation (`npx eslint --version` took 9 s), and loading the config adds about 5 s.
- **`astro sync` is the slowest neighbouring step.** It took 130 s in one run; `astro check` took 45 s then 22 s. CI runs sync, lint, check and build in one job (`.github/workflows/ci.yml:18-22`).

## Detailed Findings

### What gets linted

- `eslint.config.js` applies `strictTypeChecked` and `stylisticTypeChecked` to every file matched by the config with `projectService: true` (`eslint.config.js:16-23`). Only `scripts/**/*.mjs` opts out of type-aware rules (`:75-80`). `.astro` files use the older single-program `project: "./tsconfig.json"` mode because the Astro parser does not support `projectService` (`:60-65`).
- Prettier runs inside ESLint through `eslint-plugin-prettier` (`:4`, `:92`), so every linted file is also formatted-checked by Prettier with its two plugins (`prettier-plugin-astro`, `prettier-plugin-tailwindcss`, `.prettierrc.json`).
- Ignores come from `.gitignore` (`:14`, `:83`) plus `.claude/**` (`:85`). There is no `.prettierignore`.
- Tracked files by extension: 32 `.ts`, 3 `.tsx`, 8 `.astro`, 1 `.js`, 8 `.mjs`; 5 of them under `.claude/skills/` are ignored, leaving 47, which both `--stats` runs confirmed (`files: 47`).
- `npm run lint` is `eslint . --cache --cache-strategy content --cache-location node_modules/.cache/eslint/` (`package.json:10`). The commit hook `.husky/pre-commit` runs `npx lint-staged`, and `lint-staged` runs `eslint --fix` on staged `*.{ts,tsx,astro}` (`package.json:62-68`).
- Toolchain versions installed: eslint 10.10.0, typescript 6.0.3, typescript-eslint 8.70.0, prettier 3.9.6, eslint-plugin-prettier 5.5.6, astro-eslint-parser 3.1.0.
- In `git log -S`, the earliest commit containing the `projectService` and Astro `project: "./tsconfig.json"` strings in `eslint.config.js` is `300912b` ("Normalize line endings"), which does not show their origin; no commit or plan in `context/` records a deliberate performance trade-off for them (searched: `git log` for `eslint.config.js`, and `context/` for lint plus slow/minutes wording).

### Measurements (one machine, single runs unless stated)

Machine: Windows 11, primary checkout at `c4bdfef`, about 15:16 to 15:35 local time on 2026-09-25, other Claude sessions possibly running on the same machine. Every wall time includes process start-up.

| Run | What | Wall time | Result |
|---|---|---|---|
| First full run | `npx eslint . --no-cache --stats`, `TIMING=1` | **253 s** | exit 0 |
| R2 | `node node_modules/eslint/bin/eslint.js . --no-cache` | **33 s** | exit 0, no output |
| R3 | R2 plus `--ignore-pattern "workers/**/worker-configuration.d.ts"` | **20 s** | exit 0, no output |
| R4 | the first run's exact command, repeated | **61 s** | exit 0 |
| R5 | `npm run lint`, cache file deleted | **45 s** | exit 0, no output |
| R6 | `npm run lint` again (warm cache) | **12 s** | exit 0, no output |
| P0 | `npx eslint --version` | 9 s | |
| P1 | `npx eslint --print-config <file>` | 14 s | |
| P2 / P3 / P4 | one small `.ts` / one `.astro` / one `.tsx` file, no cache | 18 s / 18 s / 19 s | |
| P5 | the generated `.d.ts` alone, no cache | 43 s | |
| A1 | `npx astro sync` | 130 s | exit 0 |
| A2 / A3 | `npx astro check`, run 1 / run 2 | 45 s / 22 s | 0 errors |

Where the time went inside the two `--stats` runs (first run, then R4; `sum parse` and `sum rules` are per-file totals over 47 files):

| | First run | R4 |
|---|---|---|
| sum parse | 66.8 s | 13.9 s |
| sum rules | 47.4 s | 26.5 s |
| `astro.config.mjs` parse | 55.3 s | 5.3 s |
| first `.astro` file parse (`PageCard.astro`) | 8.7 s | 6.6 s |
| `prettier/prettier` (total) | 31.3 s (66% of rule time) | 22.3 s (84%) |
| Prettier on the generated `.d.ts` | 23.2 s | 20.1 s |
| `react-hooks/static-components` (total) | 9.3 s, of which 9.1 s on the first `.tsx` file | 0.46 s |
| `@typescript-eslint/no-deprecated` (total) | 3.1 s | 1.9 s |

In the first run, per-file parse plus rule time (114 s) accounts for less than half of the 253 s wall time; the remaining time is not attributed to any file or rule in the stats output.

### The generated types file

- `workers/purge-job/worker-configuration.d.ts` is tracked in git, has 15,384 lines, and starts with `/* eslint-disable */` and `// Generated by Wrangler by running wrangler types (hash: …)` (`workers/purge-job/worker-configuration.d.ts:1-3`).
- A file-level `eslint-disable` comment hides reported problems; it does not stop rules from executing. That is consistent with the measurements: Prettier and the type-aware rules still spent 20 to 24 s on it, and the single-file probe was 43 s against 18 to 19 s for an ordinary file.
- Because there is no `.prettierignore`, `npm run format` (`prettier --write .`, `package.json:12`) also processes the file. If a regenerated copy is staged, `lint-staged` would run `eslint --fix` on it at commit time (inference from `package.json:62-68`; not tested).

### CI ordering

- The `ci` job runs `npm ci`, `npx astro sync`, `npm run lint`, `npx astro check`, `npm run build` sequentially (`.github/workflows/ci.yml:18-22`). A fresh runner has no ESLint cache. No CI timing logs were available to this research, so CI's lint duration is unknown.

## Code References

- `eslint.config.js:16-23` — type-aware presets and `projectService` applied to all files
- `eslint.config.js:60-65` — `.astro` files use `project: "./tsconfig.json"` (a second program)
- `eslint.config.js:75-80` — only `scripts/**/*.mjs` disables type-aware rules
- `eslint.config.js:83-85, 92` — gitignore-based ignores, `.claude/**` ignore, `eslint-plugin-prettier`
- `package.json:10` — the `lint` script and its `--cache` flags
- `package.json:62-68` — `lint-staged` runs `eslint --fix` on staged ts, tsx and astro files
- `.husky/pre-commit` — runs `npx lint-staged`
- `.github/workflows/ci.yml:18-22` — sync, lint, check, build in one job
- `workers/purge-job/worker-configuration.d.ts:1-3` — generated-file header
- `context/foundation/lessons.md:40-45, 54-59` — stale-cache and fresh-worktree lessons
- `context/archive/2026-09-25-time-entry-purge-verified/plan.md:211` — records a cold `npm run lint` of about 15 minutes and `astro sync` hanging about 20 minutes on a fresh worktree

## Architecture Insights

- **What is cheap:** on this codebase (47 files) the type-aware rules, the Astro parser and the React rules are not the steady-state cost. Prettier-in-ESLint is the largest rule cost, and 90% of it is one generated file.
- **What is expensive and avoidable:** linting and format-checking a generated artifact that is already marked `eslint-disable`.
- **What is fixed per invocation:** about 9 s of `npx` start-up and about 5 s of config load, so single-file runs are never fast; the value of scoping lint to changed files is smaller than it looks.
- **What is variable and not explained:** cold-start behaviour. The same command varied from 253 s to 61 s within about 15 minutes, and the cost was concentrated in parse time (TypeScript program creation and first reads of files), not in rules.

## Options identified (evidence-based; none applied)

1. **Ignore the generated file** in ESLint (a `{ ignores: [...] }` entry in `eslint.config.js`) and add a `.prettierignore` for it. Measured: 33 s to 20 s in a full uncached run (one run each). Weakens nothing the repository checks by hand, since the file is generated.
2. **Diagnose cold starts before changing configuration.** Candidates not yet tested: first-read cost of a fresh `node_modules` (for example antivirus scanning on Windows) and concurrent load from other sessions. The steady state does not justify restructuring the type-aware setup.
3. **Prefer `npm run lint` to `npx eslint`** in manual and scripted runs to avoid roughly 9 s per invocation.
4. **Keep the existing practice** of running the full lint once per change (lessons and plans already do) and `lint-staged` at commit time.
5. **Considered and not supported by the measurements:** removing `eslint-plugin-prettier` (about 2 s of Prettier time remains once the generated file is excluded, from R4: 22.3 s total minus 20.1 s), or dropping type-aware rules (`no-deprecated` is 1.9 to 3.1 s in total).

## Historical Context (from prior changes)

- `context/foundation/lessons.md:54-59` — "budget for a slow first run": cold type-aware lint about 13 to 15 minutes and `astro sync` over 20 minutes in `time-entry-purge-verified`. **Partially supported**: the slowness was reproduced once (253 s here), but a repeat with the same command took 61 s, so it is not a stable property of the configuration.
- `context/foundation/lessons.md:40-45` — stale cached type errors after generated types appear: **supported** (resolved in `fix-eslint-env-typing`, archived); unrelated to speed except that it also makes people re-run lint.
- `context/archive/2026-09-25-time-entry-purge-verified/plan.md:211` — records the same slow first run: **supported as an observation**, cause not established there either.

## Related Research

- `context/archive/2026-09-25-fix-eslint-env-typing/change.md` — resolution of the stale-cache errors (archived).

## Open Questions

1. **What made the first full run 253 s and the recorded fresh-worktree runs 13 to 15 minutes, when the same command later took 33 to 61 s?** Not determined. The cost sat in file parsing and program creation, not in rules. Untested hypotheses: cold file cache or antivirus scanning of a fresh `node_modules`; other sessions' load. A controlled test would time lint in a brand-new worktree right after `npm ci` and `astro sync`, with and without a Windows Defender exclusion.
2. **How long does lint take on the CI runner?** No CI logs were inspected, so whether this matters there is unknown.
3. **Does ignoring the generated file change anything for `lint-staged` and `npm run format`?** Inferred from `package.json:12, 62-68`; not tested.
4. **How stable are the numbers?** Only R2/R4/R5/R6 were repeated at all; each figure is a single run and the machine was shared. The 13 s saving from ignoring the generated file (33 s to 20 s) should be re-measured a few times before it is quoted as a fixed number.
5. **Is `astro sync` at 130 s typical?** One run only, and it may have included first-run dependency optimization; not compared with a second run.
