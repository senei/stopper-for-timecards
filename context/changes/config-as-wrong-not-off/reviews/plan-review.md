<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Config as wrong, not off

- **Plan**: context/changes/config-as-wrong-not-off/plan.md (with plan-brief.md)
- **Mode**: Deep (done inline, no sub-agent, read-only checks of the code)
- **Date**: 2026-10-05
- **Verdict**: REVISE (light: the design is sound; the fixes are to the verification rows and a few wording gaps)
- **Findings**: 0 critical, 5 warnings, 3 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

Grounding: 9/9 paths exist (creation-closed.ts and test, index.astro, api/links.ts, astro.config.mjs, supabase-admin.ts, log.ts and test, turnstile.ts, access-log.ts, link-cookie.ts), 10/10 symbols and line references match (index.astro:25,26,73,84; links.ts:30 and the `supabase_not_configured` branch; turnstile.ts:47-54; astro.config.mjs:19-24; supabase-admin.ts:5-8,24-29; access-log.ts silent return), brief and plan agree (same decisions, same scope, the two user-confirmed rows match the plan text). Progress maps one to one onto the success criteria (1.1-1.5, 2.1-2.8), one `## Progress` heading at the end, phase blocks use plain bullets.

Plan claims checked against the code:

- `SUPABASE_KEY` is unused in `src` (only `scripts/smoke-local.mjs` sets it): true.
- `GET /` without a cookie never touches the database: true (`resolveCookieLink` returns `none` before any lookup; `src/middleware.ts` only wraps `errorBoundary`).
- The call placed after line 26 is after the 503 status is set and after the early redirect, so a linked visitor is never checked and the 503 branch is (the Supabase check still fires there). The call sits before any markup and touches no status, cookie or redirect.
- Nothing in the plan contradicts the code. One assumption is untrue on this machine: the state of `.dev.vars` (see F1).
- Line 83 of index.astro (`!unavailable && !full && !closed`) is exactly the plan's `formShown`, so the site-key check cannot fire on the closed, full or 503 states.
- `wrangler.jsonc` has `observability.enabled: true` and `head_sampling_rate: 1`, so a written line is not sampled away.

Working tree note: the plan is `planned`, but the main checkout already has `src/lib/config-check.ts` (untracked) and a modified `src/lib/creation-closed.ts`, both matching the Phase 1 contract; `creation-closed.test.ts` and `config-check.test.ts` are not there yet. The start-of-session git status showed neither, so someone started Phase 1 while this review ran. Findings below that touch Phase 1 may already be cheap to apply to that code.

## Findings

### F1 — Manual rows 2.6-2.8 assume a `.dev.vars` that does not exist here

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Manual Verification (2.6, 2.7, 2.8) and Manual Testing Steps 1-4
- **Detail**: `.dev.vars` in this checkout (gitignored) holds only three names, `SUPABASE_URL=`, `SUPABASE_KEY=`, `SUPABASE_SERVICE_ROLE_KEY=`, all with empty values, and no `TURNSTILE_SITE_KEY` or `LINK_CREATION_CLOSED` line. So the rows "with the key set it prints none", "with all values set no config line appears" and "with `SUPABASE_URL` removed" have no healthy baseline to compare against, and the Supabase stack cannot start here (port 54322 is reserved), so real values are not available. Also: the once-per-process flag means every variable change needs a server restart, `astro dev` does not pick up `.dev.vars` edits live, and the lessons say a cold start after a `.dev.vars` change is slow (start with `ASTRO_DEV_BACKGROUND=1` as a background task and poll the log for the ready line). Nothing in the plan confirms that `console.warn` and `console.error` from the workerd-hosted render reach the dev-server output; if they do not, all three rows are unobservable. Row 2.8 needs no database (GET / without a cookie), so placeholder values are enough.
- **Fix**: Rewrite the rows around an explicit baseline: back up `.dev.vars`, write placeholder values for the names (`SUPABASE_URL=http://127.0.0.1:1`, a dummy service-role key, Cloudflare's published Turnstile test site key, `LINK_CREATION_CLOSED` absent), start the server once with the output redirected to a file, and first prove with a request that the healthy baseline prints no config line; then change one variable per run with a restart each time, always requesting `/` with no cookie; restore `.dev.vars` from the backup at the end. Add a probe step that confirms workerd console output reaches the captured log (the missing-key line itself serves), and say in the phase commit body that the rows were verified from the captured output. Never print `.dev.vars` contents in the evidence.
- **Decision**: PENDING

### F2 — Phase 2 has no automated proof that `index.astro` calls the helper correctly

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Automated Verification 2.1-2.5, Testing Strategy
- **Detail**: The only page-level checks are a grep that the import and call exist and a no-`console` grep. `astro check` only proves the argument types. A call placed before the `resolveCookieLink` redirect, or one that passes `formShown: true` or the wrong variable (for example `SUPABASE_KEY` instead of the service-role key), passes every automated row; only the manual rows, which F1 shows are fragile here, would catch it. The plan admits the gap ("Phase 2's proof is the manual check") but does not weigh it. The unit tests cover the helper fully, so the remaining risk is wiring only, and it is small: one call, five arguments. The gap is acceptable if 2.4 is tightened.
- **Fix A ⭐ Recommended**: Accept the gap, but tighten 2.4 so it checks wiring, not presence: `grep -n` the call and require its line number to be after the `const full =` line and before `<Layout`, and require the five argument names (`LINK_CREATION_CLOSED`, `TURNSTILE_SITE_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `formShown`) on the call.
  - Strength: no new test infrastructure; catches the two plausible slips (wrong order, wrong variable).
  - Tradeoff: still a text check, not behaviour.
  - Confidence: HIGH — the call is a single statement in a small frontmatter.
  - Blind spot: it cannot prove the `formShown` expression equals line 83's.
- **Fix B**: Extract the `formShown` expression into one `const` in `index.astro` and use it for both the call and the script-tag condition at line 83.
  - Strength: removes the one place the two could drift apart.
  - Tradeoff: touches a markup line that the plan says stays unchanged (output identical, diff bigger).
  - Confidence: MED — behaviour-neutral by inspection, not by test.
  - Blind spot: the form branch uses its own `full ? … : closed ? …` chain, so it would still not share the constant.
- **Decision**: PENDING

### F3 — `git diff --stat` cannot show the new files and is misleading after a phase commit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 criterion 1.5 (revert check), Phase 2 criterion 2.5
- **Detail**: `git diff --stat` ignores untracked files, and `config-check.ts` and `config-check.test.ts` are new, so 2.5's "lists the five source files" cannot be true while they are untracked (already visible: `config-check.ts` is untracked now). If Phase 1 is committed first (the plan pauses after it and mentions a phase commit), the Phase 2 diff against HEAD shows only `index.astro`. Also 1.5 says "in a worktree-only edit", but the work is in the main checkout, so the deliberate-break edits touch the real files and a revert mistake would land in the tree.
- **Fix**: Use `git status --short` for the revert check in 1.5 and `git diff --stat <phase-1-commit>..` plus `git status --short` for 2.5; reword 1.5 so the break is made on a saved copy or reverted with `git checkout -- <file>` for tracked files.
- **Decision**: PENDING

### F4 — Plan runs lint and type checks in Phase 1 although its own lesson says once, in the last phase

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Current State (lessons line), Phase 1 criteria 1.3 and 1.4, Phase 2 criterion 2.3
- **Detail**: The plan cites "lint and `astro check` once, in the last code phase" as an applied lesson, but 1.4 lints four files (type-aware, `projectService: true`, the slow cold run the lessons describe) and 2.3 lints the whole repo again. 1.3 uses `npx tsc --noEmit`, which is not the repo's type check (CI and the lessons use `astro sync` then `astro check`; there is no `tsc` script in package.json). Phase 1 and Phase 2 are one session, so the extra runs buy little.
- **Fix**: Drop 1.4 (unit tests are the Phase 1 gate), drop 1.3 or replace it with the single `astro check` in Phase 2, keep full lint only in Phase 2, and renumber the Progress rows to match.
- **Decision**: PENDING

### F5 — "Once per isolate" can hide a standing misconfiguration for a long-lived isolate

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Key Discoveries (flag lifetime), Migration Notes, Open Risks in the brief
- **Detail**: The mechanism works as claimed: a module-level `Set` lives as long as the isolate and is shared by its requests, and in vitest `vi.resetModules()` plus a dynamic import gives a fresh set per case (the helper imports `log` and `creation-closed`, both stateless, and the console spies are on the global `console`, so they survive the reset). The weakness is operational: a busy isolate can live for many hours or days, the line is written once at its first render, and Workers Logs keep events for a limited window, so on day N a still-misconfigured deploy may show nothing in the dashboard even though it is still broken. The plan frames the risk only the other way round (repeated lines are not a rate). Head sampling is 1 (`wrangler.jsonc`), so the line is not sampled away. A deliberate `0`/`false`/`no`/`off` value never reaches the set, so there is no false alarm from it.
- **Fix A ⭐ Recommended**: Keep per-isolate, but re-emit after a fixed interval: store `Map<event, lastWrittenMs>` and write again when `Date.now() - last >= 1 hour`; test with `vi.useFakeTimers()` and `vi.setSystemTime` (a repeat inside the hour writes nothing, one after it writes again).
  - Strength: a standing problem keeps reappearing in the log window at a bounded rate (at most 24 lines a day per isolate), while a healthy deploy still writes nothing.
  - Tradeoff: slightly more code and one more test; the log is no longer strictly "one line per isolate".
  - Confidence: HIGH — `Date.now()` is available and stable inside a request on Workers.
  - Blind spot: the retention window of the dashboard in use was not checked.
- **Fix B**: Accept as is and say in Migration Notes that the absence of a line after a long time does not prove a healthy deploy (look at the first minutes after each deploy).
  - Strength: no code change.
  - Tradeoff: the signal this change adds can be missed on a stable deploy.
  - Confidence: MED — depends on dashboard retention.
  - Blind spot: whether anything alerts on these events at all (not part of this plan).
- **Decision**: PENDING

### F6 — Gaps in the helper contract: whitespace-only values, and "never throws" is a claim not a construct

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — configuration check contract; Critical Implementation Details
- **Detail**: The plan says a value is missing when "unset or empty". The check `createAdminClient` uses is `!value`, so a whitespace-only secret counts as set there; the drafted `config-check.ts` trims and reports it missing. Either is defensible, but the plan should pick one and the tests should pin it. Separately, nothing wraps the helper body or the call in a `try`/`catch`; by construction it has no throwing operation (a `Set`, string checks, a logger whose serialisation is already wrapped), and an exception would reach `errorBoundary` and turn the front page into a 500, so the "never throws" claim deserves a one-line justification or a guard. Visitor-facing behaviour is otherwise unaffected: no status, cookie or redirect is touched, and no log line can carry a configuration value (details are static strings or variable names; `LogContext` has no value field).
- **Fix**: State "empty after trim counts as missing" in the contract and add a whitespace-only case; either wrap the helper body in `try { … } catch { /* never block a render */ }` or add the sentence that the body has no throwing operation.
- **Decision**: PENDING

### F7 — Local, preview and e2e runs will log error lines by design

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Migration Notes, Desired End State ("a healthy deploy writes nothing")
- **Detail**: Any environment without the secrets (this checkout's `.dev.vars`, the Playwright `webServer` build-and-preview run when `.env` lacks them, CI) now prints `supabase_secrets_missing` and `turnstile_site_key_missing` on the first `GET /`. Nothing in `tests/e2e` or `scripts/smoke.mjs` asserts on console output, so no test breaks, but the lines will appear in dev and test output and should not be mistaken for a regression or an incident.
- **Fix**: Add one sentence to Migration Notes saying these error lines are expected outside a configured deploy.
- **Decision**: PENDING

### F8 — Deliberate-break list does not cover the two rules most likely to regress

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 criterion 1.5
- **Detail**: The three listed breaks do turn a test red provided the cases exist as written: `yes` open (existing assertion at `creation-closed.test.ts:13`), a second call writing nothing (needs the fresh-module-per-case rule, which the plan has), and the sentinel case (it must assert over every captured `error`, `warn` and `info` call, not only one level). Two rules are not exercised by any break: the site-key check firing when `formShown` is false (false-alarm rule) and a deliberate `0`/`off` value warning.
- **Fix**: Add two breaks to 1.5: drop the `formShown &&` condition (the `formShown: false` case must go red) and treat `off` as unrecognised (the quiet-value case must go red).
- **Decision**: PENDING
