# Config as wrong, not off Implementation Plan

## Overview

Configuration that is wrong or missing is read as "off" and degrades silently on the sign-up path. `LINK_CREATION_CLOSED=yes` leaves sign-up open with no signal (S5). A missing `TURNSTILE_SITE_KEY` renders a widget that never challenges, so every visitor posts an empty token and sees "Verification failed", and the only trace is a `turnstile_missing_token` warning that looks like bot traffic (S6). Missing Supabase secrets are invisible until a visitor has solved the challenge, because `GET /` without a cookie never touches the database (S10, F15). This plan adds one small configuration check that runs when the landing page renders and writes one log line per problem, at most once per Worker isolate. It changes no response, redirect, cookie or accepted value: only what reaches Workers Logs changes. It implements S5, S6, S10 and the logging half of F15 of the 2026-10-05 observability audit (fix order step 1).

## Current State Analysis

The two audits are this plan's frame and research (`context/audits/observability/2026-10-05_verify-landing-signup.md`, findings S5, S6, S10, F15 and fix order step 1; and `context/audits/observability/2026-10-05_landing-signup.md`, section 5 and root cause 4); this plan does not re-investigate them. Spot-checked in the code on 2026-10-05.

- `src/lib/creation-closed.ts:6-9`: `isCreationClosed(value)` trims and lowercases, and is true only for `1` and `true`. Anything else, including `yes`, `on`, `closed`, is open. There is no third state, so a typo cannot be told from "unset".
- `src/pages/index.astro:25`: `closed = isCreationClosed(LINK_CREATION_CLOSED) || params.get("closed") === "1"`. `src/pages/api/links.ts:30` makes the same call before Turnstile. Both only use the boolean.
- `src/pages/index.astro:73`: the form always renders `<div class="cf-turnstile" data-sitekey={TURNSTILE_SITE_KEY}>`, with the script at line 84, even when the key is `undefined`. `src/lib/turnstile.ts:55-57` then logs `turnstile_missing_token` as a warn with route `lib/turnstile`. By contrast, `turnstile.ts:47-54` already logs `turnstile_secret_missing` as an error when the secret is missing.
- `astro.config.mjs:19-24`: every secret (`SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `LINK_CREATION_CLOSED`) is `optional: true`, so the build and the Worker start with any of them missing.
- `src/lib/supabase-admin.ts:5-8,24-29`: `createAdminClient()` returns `null` when `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is unset; `adminOrThrow()` throws `SupabaseNotConfiguredError`. `src/pages/api/links.ts:82-86` logs that as `supabase_not_configured`, but only after Turnstile has passed. `src/lib/link-cookie.ts:38-40` (the no-cookie path of `resolveCookieLink`) returns `none` without touching the database, so `GET /` is silent. With a cookie and no secrets, the lookup throws and is logged as `cookie_link_lookup_failed`, which names the symptom, not the cause.
- `src/lib/access-log.ts:21-23` returns silently when the admin client is null (F10). It is a separate open finding and stays out of this plan.
- `src/lib/log.ts:76-99`: `logError(event, context, err)`, `logWarn(event, context, ...err)` and `logInfo(event, context)`. One JSON line each; `LogContext` has `route`, `linkId`, `projectId`, `op`, `detail` and no field for configuration values. There is no sampling or de-duplication. Existing convention: `<noun>_<verb>` events (`turnstile_secret_missing`, `cookie_stale`, `link_creation_busy`); error for something an operator must fix, warn for something odd that did not fail the request, info for an expected outcome.
- Tests: `src/lib/creation-closed.test.ts` pins `isCreationClosed` (`yes` is open; `1`, `true`, `TRUE`, `true` are closed). `src/lib/turnstile.test.ts` and `src/lib/log.test.ts` show the pattern for asserting log lines by spying on `console.*`. `src/pages/index.astro` has no unit test (Astro pages are not unit-tested in this repo), so the logic goes into a library function that takes its inputs as arguments, as `verifyTurnstile` does with its secret.
- Lessons that apply: lint and `astro check` once, in the last code phase; in a fresh worktree run `npm ci` and `npx astro sync` first and clear the ESLint cache if unresolved-type errors appear only in cached runs; start `astro dev` with `ASTRO_DEV_BACKGROUND=1`; record how each manual row was verified (`context/foundation/lessons.md`).

## Desired End State

- `classifyKillSwitch(value)` in `src/lib/creation-closed.ts` returns `"closed"` (`1`, `true`), `"open"` (unset, empty, `0`, `false`, `no`, `off`, after trim and lowercase) or `"unrecognised"` (anything else). `isCreationClosed` keeps its signature and answers (true only for `closed`), so `yes` still leaves sign-up open.
- A new `src/lib/config-check.ts` exports `checkSignupConfig(input)`. Given the kill-switch value, the site key, the two Supabase values, whether the sign-up form is shown and the route, it writes at most one line per problem and at most once per isolate per event:
  - `creation_closed_unrecognised` (warn): the kill switch is set to an unrecognised value, so sign-up is open; `detail` says what is accepted and never contains the value.
  - `turnstile_site_key_missing` (error): the form is shown and the site key is unset or empty, so visitors cannot pass the check.
  - `supabase_secrets_missing` (error): `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is unset or empty; `detail` lists the variable names, never values.
- `GET /` calls it on every render that does not redirect to a workspace, so a misconfigured deploy shows a line on the first page view, before any visitor solves the challenge.
- Everything the visitor sees, every status code, redirect, cookie and accepted configuration value, is byte-identical to before. A missing site key still renders the same form.

### Key Discoveries:

- The three problems share one place where the values are in hand: the render of `GET /` (`index.astro:2,13-26`). A single helper there covers all of them without touching the POST route's flow.
- `isCreationClosed` is called from two places (`index.astro:25`, `api/links.ts:30`) and its tests pin `yes` as open; adding a classifier next to it and keeping the boolean untouched leaves both callers and the existing assertions alone.
- `turnstile_secret_missing` (`turnstile.ts:47-54`) is the in-repo precedent for a missing-config line: `logError` with a `{ message }` object as the error and no value in the line.
- The logger has no de-duplication, so "once per instance" has to be a module-level `Set` of event names inside the helper. On Cloudflare Workers that state lives for the life of an isolate: it is shared by the requests an isolate serves, and resets when the isolate is recycled or a new one starts, so the practical rate is a few lines per isolate, not one per deploy.
- The `closed` and `full` branches (`index.astro:67-70`) do not render the form, so a missing site key is only a problem when the form is shown; the helper takes that as an input instead of logging a false alarm.
- `SUPABASE_KEY` is declared in the schema but nothing in `src` reads it (`createAdminClient` uses the URL and the service-role key), so it is not part of the check.

## What We're NOT Doing

- No change to which values close sign-up: `yes`, `on`, `closed` still leave it open (they are now reported, not accepted).
- No change to the form: a missing site key does not hide it or replace it with a message.
- No required secrets in `astro.config.mjs` (no change of `optional: true`): a build or a preview without secrets must keep working; only the logging half of F15 is done.
- No change to `access-log.ts` or its silent return on a null client (F10), no change to `turnstile.ts` and its route label (S8), no change to `link-cookie.ts`.
- No check in `POST /api/links`, no check of `TURNSTILE_SECRET_KEY` at render time (the POST already logs `turnstile_secret_missing`), no check of Supabase reachability (only presence).
- No de-duplication in `log.ts` and no change to `LogContext`; no Turnstile widget callbacks; no new error codes on `/` (F27).
- No change to N1 (the unbounded `link_creation_closed` info line), the purge worker or any other route.

## Implementation Approach

Two small phases. Phase 1 adds the pure pieces with unit tests and no callers: the three-state kill-switch classifier next to `isCreationClosed`, and the `config-check` helper with its once-per-isolate flag, so it ships green on its own. Phase 2 calls the helper from `index.astro` and runs the last-code-phase checks (full lint, `astro check`) plus a manual check against the dev server with each variable broken in turn. The helper takes its inputs as arguments (like `verifyTurnstile`), so tests need no Astro runtime, and it never throws.

## Critical Implementation Details

- **State sequencing:** in `index.astro` the call goes after `closed`, `full` and `unavailable` are known (so `formShown = !unavailable && !full && !closed` is exact) and after the early redirect for a linked visitor, so it also runs on the 503 branch, where missing Supabase secrets are the likely cause.
- **Debug & observability:** the once-per-isolate flag is module state, so tests must load the helper fresh for each case (`vi.resetModules()` then a dynamic `import`); a test that reuses one import would see later cases silently pass. No line may contain a configuration value: the tests pass recognisable sentinel values and assert they never appear in any emitted line.

## Phase 1: Classifier and configuration check

### Overview

Add the three-state kill-switch classifier and the once-per-isolate configuration check, with unit tests. Nothing in the pages or routes changes yet.

### Changes Required:

#### 1. A three-state kill-switch classifier

**File**: `src/lib/creation-closed.ts`

**Intent**: Let a caller tell "off on purpose" from "set to something we do not understand", without changing what counts as closed.

**Contract**: `export type KillSwitchState = "closed" | "open" | "unrecognised"` and `export function classifyKillSwitch(value: string | undefined): KillSwitchState`: after `trim().toLowerCase()`, `1` and `true` are `closed`; `undefined`, empty, `0`, `false`, `no` and `off` are `open`; any other string is `unrecognised`. `isCreationClosed(value)` becomes `classifyKillSwitch(value) === "closed"`, so its signature and every answer stay as they are. The doc comment is updated to describe the three states.

#### 2. The configuration check

**File**: `src/lib/config-check.ts` (new)

**Intent**: Turn wrong or missing configuration into one log line per problem, at most once per isolate, without ever blocking or altering a request.

**Contract**: `export function checkSignupConfig(input: { route: string; killSwitch: string | undefined; turnstileSiteKey: string | undefined; supabaseUrl: string | undefined; supabaseServiceRoleKey: string | undefined; formShown: boolean }): void`. Values come in as arguments (no `astro:env` import), so the module is testable without the Astro runtime. A module-level `Set<string>` holds the event names already written; a problem whose event is in the set writes nothing. Problems, each with `route: input.route`:

- `classifyKillSwitch(killSwitch) === "unrecognised"` gives `logWarn("creation_closed_unrecognised", { route, detail: "LINK_CREATION_CLOSED is set but not recognised, so sign-up stays open; use 1 or true to close it" })`. The value is never logged.
- `formShown` and `turnstileSiteKey` unset or empty gives `logError("turnstile_site_key_missing", { route }, { message: "TURNSTILE_SITE_KEY is not set; the sign-up widget cannot challenge and every visitor is refused" })`.
- `supabaseUrl` or `supabaseServiceRoleKey` unset or empty gives `logError("supabase_secrets_missing", { route, detail: "<comma-separated names of the missing variables>" }, { message: "Supabase is not configured; sign-up and workspaces cannot work" })`.

The event is added to the set only when its line is written, so `formShown: false` does not consume the site-key flag. The function never throws.

#### 3. Unit tests

**Files**: `src/lib/creation-closed.test.ts` (extend), `src/lib/config-check.test.ts` (new)

**Intent**: Pin the three states, the line shapes, the once-per-isolate rule and the "no value in a line" rule.

**Contract**: `creation-closed.test.ts` adds a `classifyKillSwitch` block: `1`, `true`, `TRUE`, `true` are `closed`; `undefined`, `""`, `"0"`, `"false"`, `"No"`, `"off"` are `open`; `"yes"`, `"on"`, `"closed"`, `"enabled"` are `unrecognised`; existing assertions are not edited. `config-check.test.ts` spies on `console.error`, `console.warn` and `console.info` (restored in `afterEach`) and loads the module fresh per case with `vi.resetModules()` and a dynamic import. Cases: all configuration present with a recognised value writes nothing; `killSwitch: "yes"` writes exactly one `creation_closed_unrecognised` warn line, and a second call writes nothing; `killSwitch: "1"`, `"0"`, `""` and `undefined` write nothing; a missing site key with `formShown: true` writes one `turnstile_site_key_missing` error line, with `formShown: false` writes nothing and a later call with `formShown: true` still writes it; an empty-string site key counts as missing; missing `SUPABASE_URL` only, missing key only, and both give one `supabase_secrets_missing` line whose `detail` names exactly the missing variables; two problems at once write two lines; every line carries the given `route` and the right `level`; sentinel values (`killSwitch: "sentinel-kill-switch"`, and `"sentinel-url"` or `"sentinel-key"` for a Supabase value that is set while the other is missing) never appear in any emitted line.

### Success Criteria:

#### Automated Verification:

- New and extended unit tests pass: `npx vitest run src/lib/creation-closed.test.ts src/lib/config-check.test.ts`
- Whole suite stays green: `npx vitest run`
- Type checking passes: `npx tsc --noEmit`
- Changed files lint clean: `npx eslint src/lib/creation-closed.ts src/lib/creation-closed.test.ts src/lib/config-check.ts src/lib/config-check.test.ts`
- Deliberate break: in a worktree-only edit, making `isCreationClosed` also return true for `yes` turns the "yes is open" assertion in `creation-closed.test.ts` red; removing the once-per-isolate check turns the repeat-call case red; and logging the kill-switch value in `detail` turns the sentinel case red; all edits are reverted afterwards (`git diff --stat` lists only intended files)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for confirmation before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Check on render

### Overview

Call the check from the landing page so a wrong kill switch, a missing site key and missing Supabase secrets show in the logs on the first page view, and run the last-code-phase checks.

### Changes Required:

#### 1. The landing page

**File**: `src/pages/index.astro`

**Intent**: Surface configuration problems at the first place the values are in hand, before any visitor solves the challenge, without changing what the page renders.

**Contract**: import `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (next to the existing `LINK_CREATION_CLOSED, TURNSTILE_SITE_KEY`) from `astro:env/server` and `checkSignupConfig` from `@/lib/config-check`. After the `closed` and `full` lines (`index.astro:25-26`) call `checkSignupConfig({ route: "GET /", killSwitch: LINK_CREATION_CLOSED, turnstileSiteKey: TURNSTILE_SITE_KEY, supabaseUrl: SUPABASE_URL, supabaseServiceRoleKey: SUPABASE_SERVICE_ROLE_KEY, formShown: !unavailable && !full && !closed })`. The early redirect for a linked visitor, the 503 branch, the markup, the script tag and every status code stay as they are. No change to `api/links.ts`.

### Success Criteria:

#### Automated Verification:

- Whole suite stays green: `npx vitest run`
- Type checking and Astro diagnostics pass: `npx astro check`
- Lint is clean (run once here, the last code phase; in a fresh worktree run `npm ci` and `npx astro sync` first, and if lint reports unresolved `import.meta.env` types delete `node_modules/.cache/eslint/` and rerun per `lessons.md`): `npm run lint`
- The page calls the check and adds no `console`: `grep -n "checkSignupConfig" src/pages/index.astro` prints the import and the call, and `grep -n "console\." src/pages/index.astro src/lib/config-check.ts` prints nothing
- Only the intended files changed: `git diff --stat` lists `src/lib/creation-closed.ts`, `src/lib/creation-closed.test.ts`, `src/lib/config-check.ts`, `src/lib/config-check.test.ts` and `src/pages/index.astro` (plus this change's folder), and not `src/pages/api/links.ts`

#### Manual Verification:

- With the dev server (start `astro dev` with `ASTRO_DEV_BACKGROUND=1`, per `lessons.md`) and `LINK_CREATION_CLOSED=yes` in `.dev.vars`, `GET /` renders the same form as before and the server output shows one `creation_closed_unrecognised` warn line with route `GET /` and no value in it; a second `GET /` prints no second line; with `LINK_CREATION_CLOSED=1` the page shows the closed message and prints no config line
- With `TURNSTILE_SITE_KEY` removed from `.dev.vars`, `GET /` renders the same form and prints one `turnstile_site_key_missing` error line; with the key set it prints none
- With `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` removed, `GET /` without a cookie renders as before and prints one `supabase_secrets_missing` line naming the missing variable; with all values set no config line appears; restore `.dev.vars` afterwards, and record in the phase commit body which rows were confirmed by the user and which by the dev-server output (`lessons.md`)

---

## Testing Strategy

### Unit Tests:

- `classifyKillSwitch`: all three states, case and whitespace; `isCreationClosed` answers unchanged (`yes` still false).
- `checkSignupConfig`: nothing on a healthy config; each of the three events with its level and `detail`; once per isolate (fresh module per case); `formShown: false` does not consume the site-key flag; two problems write two lines; no configuration value ever in a line.

### Integration Tests:

- None added. The opt-in suite (`npm run test:integration`) is unaffected: no query, schema or route behaviour changes. The page wiring has no unit test (Astro pages are not unit-tested here), so Phase 2's proof is the manual check against the dev server.

### Manual Testing Steps:

1. Set `LINK_CREATION_CLOSED=yes`, request `/` twice, confirm one warn line and an unchanged page (Phase 2).
2. Remove the site key, request `/`, confirm one error line and an unchanged form.
3. Remove one Supabase variable, request `/` with no cookie, confirm one error line naming it.
4. Restart the server and confirm each line appears again after a restart (the flag is per process).

## Performance Considerations

One `Set` lookup and three cheap string checks per render of `/`; no I/O and no extra request. A configuration problem writes at most one line per event per isolate, so it cannot flood the log; a healthy deploy writes nothing.

## Migration Notes

None for data or deploy. `creation_closed_unrecognised`, `turnstile_site_key_missing` and `supabase_secrets_missing` are new events and appear only when the configuration is wrong. Because the flag is per isolate, an operator who sees one line should read it as "this deploy is misconfigured", not as a rate. After the deploy, a line in Workers Logs on the first page view is the signal that one of the variables is missing or wrong.

## References

- Audit (frame and research for this change): `context/audits/observability/2026-10-05_verify-landing-signup.md` (S5, S6, S10, F15; fix order step 1) and `context/audits/observability/2026-10-05_landing-signup.md` (section 5, root cause 4)
- Precedent plans: `context/archive/2026-10-05-signup-lifecycle-events/plan.md`, `context/archive/2026-10-05-failed-lookup-not-absence/plan.md`
- Missing-config line to copy: `src/lib/turnstile.ts:47-54`; logger: `src/lib/log.ts`; classifier and its tests: `src/lib/creation-closed.ts`, `src/lib/creation-closed.test.ts`
- Lessons applied: `context/foundation/lessons.md` (lint and `astro check` once in the last code phase; fresh worktree setup; `ASTRO_DEV_BACKGROUND`; record how manual rows were verified)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Classifier and configuration check

#### Automated

- [x] 1.1 New and extended unit tests pass: `npx vitest run src/lib/creation-closed.test.ts src/lib/config-check.test.ts` — cbb975e
- [x] 1.2 Whole suite stays green: `npx vitest run` — cbb975e
- [x] 1.3 Type checking passes: `npx tsc --noEmit` — cbb975e
- [x] 1.4 Changed files lint clean: `npx eslint src/lib/creation-closed.ts src/lib/creation-closed.test.ts src/lib/config-check.ts src/lib/config-check.test.ts` — cbb975e
- [x] 1.5 Deliberate break: `isCreationClosed` returning true for `yes` turns the "yes is open" test red, removing the once-per-isolate check turns the repeat-call case red, and logging the kill-switch value turns the sentinel case red; all edits are reverted — ef0d0cd

### Phase 2: Check on render

#### Automated

- [x] 2.1 Whole suite stays green: `npx vitest run` — cbb975e
- [x] 2.2 Type checking and Astro diagnostics pass: `npx astro check` — cbb975e
- [x] 2.3 Lint is clean: `npm run lint` — cbb975e
- [x] 2.4 The page calls the check and adds no `console`: `grep -n "checkSignupConfig" src/pages/index.astro` prints the import and the call, and `grep -n "console\." src/pages/index.astro src/lib/config-check.ts` prints nothing — cbb975e
- [x] 2.5 Only the intended files changed: `git diff --stat` lists the five source files and not `src/pages/api/links.ts` — cbb975e

#### Manual

- [x] 2.6 With `LINK_CREATION_CLOSED=yes`, `GET /` renders the same form and prints one `creation_closed_unrecognised` warn line with no value in it and no second line on a repeat request; with `1` the closed message shows and no config line is printed — ef0d0cd
- [x] 2.7 With `TURNSTILE_SITE_KEY` removed, `GET /` renders the same form and prints one `turnstile_site_key_missing` error line; with the key set none is printed — ef0d0cd
- [x] 2.8 With `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` removed, `GET /` without a cookie renders as before and prints one `supabase_secrets_missing` line naming the missing variable; with all values set no config line appears; `.dev.vars` is restored afterwards — ef0d0cd
