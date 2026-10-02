# Fix silent error logging Implementation Plan

## Overview

Production failures in Stopper for Timecards currently vanish: pages swallow backend errors with bare `catch {`, the data layer rethrows only `error.message`, and every `console.error` is a static string with no route or link id. This plan adds one structured logger and a `cause`-preserving error helper, then routes every silent or thin site in `src` through them. HTTP responses (303, 503, 404) do not change; only what reaches Workers Logs changes. It implements fixes 1 and 2 of the observability audit.

## Current State Analysis

Source of truth for the problem and its evidence: `context/audits/observability/2026-10-02_timer-delete-link-grid.md` (root causes 1–4, findings F1, F4, F5, F7, F14, part of F3; runtime probes R1, R3, R5, R7, R8, R12–R14). The audit acts as this plan's frame and research; this plan does not re-investigate.

- 12 server-side bare `catch {` plus 1 client-side: `pages/w/[token].astro:31`, `grid.astro:33,75`, `delete-account.astro:29`, `regenerate.astro:26`, `projects/[projectId]/delete.astro:28`, `lib/link-cookie.ts:40`, `lib/turnstile.ts:37`, and form-body parses in `api/links.ts:30`, `delete-account.ts:37`, `timer/start.ts:37`, `timer/switch.ts:36`. The client one is `WorkspaceCard.astro:273` (a clipboard fallback with a visible message, correct as is).
- 13 `throw new Error(\`… ${error.message}\`)`in`src/lib` (`links.ts:14,41,63,83,106`, `projects.ts:26,60,92`, `timer.ts:70,91,110,127`, `weekly-grid-query.ts:26`): `code`, `details`, `hint`and the original error are dropped (probe R1/R3/R5: code`XX000` never printed).
- 15 `console.error("<static>:", err)` calls in `src` (`access-log.ts:31,35`, `api/links.ts:53`, six `link lookup failed` routes, five action-failure routes), each carrying `// eslint-disable-next-line no-console`. None logs `link.id`, the route or the operation.
- The race backstops (`NoActiveTimerError`, `TimerAlreadyRunningError`, `ProjectInUseError`) redirect silently with no log (`timer/start.ts:47-50`, `stop.ts:35-38`, `switch.ts:46-49`, `projects/[projectId]/delete.ts:41-43`).
- Existing tests: route tests already spy on `console.error` (`src/__tests__/delete-account-route.test.ts:98,122`); lib tests mock `adminOrThrow` (`src/lib/links.test.ts:1-14`). Both patterns stay valid if the logger writes through `console.error` / `console.warn`.
- The probe harness from the audit lives in the isolated worktree `.claude/worktrees/agent-a992330e2542a0e09` (`bash probe/suite.sh`); its last output in `probe/out/` is the "before" baseline.

## Desired End State

- `src/lib/log.ts` exposes `logError` / `logWarn`; one JSON line per event with `level`, `event`, `route`, optional `linkId` / `projectId` / `op` / `detail`, and for errors a serialized `error` (name, message truncated, stack, `code`, `details`, `hint`, and `cause` unwrapped to depth 3).
- `src/lib/db-error.ts` exposes `dbError(op, error)`; every Supabase `{ error }` in `src/lib` is rethrown through it, so `cause` carries the PostgREST object while the message text is unchanged.
- No bare `catch {` and no direct `console.*` call remains in `src` outside `log.ts` (except the one documented client-side clipboard fallback); ESLint enforces both.
- Rerunning the audit's probe suite shows a log line with `event` and `route` for R7, R8, R12, R13, R14, a `code` for R1, R3, R5, and identical HTTP statuses to the baseline.

### Key Discoveries:

- Workers Logs collect `console.*` output (`wrangler.jsonc:12`); the probe row P9a showed workerd prints `Error` with `[cause]`, and P9b that a plain `{message, code, details, hint}` object keeps all fields, so cause survives, but a single JSON line is the portable form (P9c: `String(err)` loses everything).
- Astro's own 500 logger uses `err.stack || err.message` and ignores `cause` (`node_modules/astro/dist/core/routing/handler.js:101`), so errors that escape to Astro are still thin; that is left to a later change.
- A 502 from Supabase returns an HTML body as the error message (probe R1b), so the serializer must truncate messages.
- The link token is only ever in the URL, never in a log call today; the logger's context type has no token field, and the plan keeps it that way (log `link.id`, never the token).
- Lint is type-aware and slow on a cold cache (`context/foundation/lessons.md`, worktree lessons): run it once, in the last code phase.

## What We're NOT Doing

- Turnstile as a discriminated result (F2), `access_log` fail-open and rotation event (F10), purge worker (F20–F22): separate changes. `turnstile.ts:37` only gets its catch bound and logged; its `false` return is unchanged.
- No `500.astro`, no middleware, no wrapping of the unguarded page reads (`getCurrentTimer`, `listProjects`, `getProject`): that would turn a 500 into a 503.
- No events for `full` / `busy` / `closed`, and no logging of `rewrite("/404")` for malformed or unknown tokens (attacker-steerable volume).
- No change to HTTP status codes, redirects, cookies or messages shown to users.
- No release/environment tag, and no decision on the token appearing in platform request logs (F16, F17).
- No new typed `DbError` class and no logging inside `src/lib`.
- `workers/purge-job` is untouched (its own `eslint-disable` comments stay valid under the stricter `no-console`).

## Implementation Approach

Build the shared pieces first as pure additions (phase 1), then convert in layers from the bottom up so every phase leaves a green build: data layer (2), routes (3), pages plus the lint guard (4). The guard comes last on purpose: it would fail until every site is converted. The final phase is the audit's own before/after proof. Error shape is flattened explicitly in the logger rather than relying on how a given runtime prints `cause`.

## Phase 1: Logger and error helper

### Overview

Add `src/lib/log.ts` and `src/lib/db-error.ts` with unit tests. Nothing calls them yet.

### Changes Required:

#### 1. Structured logger

**File**: `src/lib/log.ts`

**Intent**: One place that turns an event plus context plus an unknown error into a single parseable log line, so no call site decides formatting and no secret can ride along by accident.

**Contract**: `interface LogContext { route: string; linkId?: string; projectId?: string; op?: string; detail?: string }`; `logError(event: string, context: LogContext, err: unknown): void` writes one `console.error(JSON.stringify({ level: "error", event, ...context, error }))`; `logWarn(event: string, context: LogContext): void` writes one `console.warn` line with `level: "warn"`; exported `serializeError(err: unknown)` returns `{ name?, message, stack?, code?, details?, hint?, cause? }` where `cause` recurses to depth 3, messages are truncated to 500 characters, an `Error` and a PostgREST-style plain object are both handled, and any other value becomes `{ message: String(value) }`. `JSON.stringify` failure falls back to a minimal line, never a throw. `route` is the route template (for example `POST /api/w/[token]/timer/start`), never a concrete URL. The context type deliberately has no token field. This file is the only place allowed to call `console.*`.

#### 2. Cause-preserving database error helper

**File**: `src/lib/db-error.ts`

**Intent**: Replace `new Error(\`op failed: ${error.message}\`)` with something that keeps the original error, without changing any message text that tests or callers match on.

**Contract**: `interface DbErrorLike { message: string; code?: string; details?: string; hint?: string }`; `dbError(op: string, error: DbErrorLike): Error` returns `new Error(\`${op} failed: ${error.message}\`, { cause: error })`. For the existing `recent link count failed`style messages,`op`is the whole prefix (for example`"recent link count"`).

#### 3. Unit tests

**Files**: `src/lib/log.test.ts`, `src/lib/db-error.test.ts`

**Intent**: Pin the output shape so later phases and the probe rerun can rely on it.

**Contract**: log tests cover: output is one parseable JSON line with `level`, `event`, `route`, context fields; an `Error` with a `cause` carrying a PostgREST-style object surfaces `error.cause.code`; a plain `{message, code, details, hint}` object keeps all four; a non-error value (string, `null`, `undefined`) does not throw; a 600-character HTML message is truncated; `logWarn` uses `console.warn`; no key outside the context and `error` is ever added. `db-error` tests: message text equals the old format and `cause` is the same object.

### Success Criteria:

#### Automated Verification:

- New unit tests pass: `npx vitest run src/lib/log.test.ts src/lib/db-error.test.ts`
- Whole suite stays green: `npx vitest run`
- Type checking passes: `npx tsc --noEmit`

#### Manual Verification:

- Printed sample lines for an `Error` with `cause`, a PostgREST-style object and a 600-character HTML message each read as one JSON line containing `event`, `route` and `error.code` where the input had one

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Data layer keeps the cause

### Overview

Convert the 13 message-only rethrows to `dbError`, and route the three lib-level catch/log sites through the logger. Messages and return values do not change.

### Changes Required:

#### 1. Supabase wrappers

**Files**: `src/lib/links.ts`, `src/lib/projects.ts`, `src/lib/timer.ts`, `src/lib/weekly-grid-query.ts`

**Intent**: Every `if (response.error) throw …` keeps the PostgREST object as `cause` so code, details and hint reach the logger.

**Contract**: replace each `new Error(\`<op> failed: ${….message}\`)`with`dbError("<op>", error)`using the same`<op>` text (13 sites listed in Current State). The existing code-based branches (`23503`in`projects.ts:89`, `23505`/`P0001`in`timer.ts`) stay exactly as they are. The "unexpected value / row" throws are unchanged.

#### 2. Library-level logging sites

**Files**: `src/lib/access-log.ts`, `src/lib/link-cookie.ts`, `src/lib/turnstile.ts`

**Intent**: Stop losing the failure inside helpers that deliberately never throw.

**Contract**: `access-log.ts` replaces both `console.error("logAccess failed:", …)` with `logError("access_log_failed", { route: "lib/access-log", linkId, op: outcome }, err)`, passing the Supabase error object on the `{ error }` branch so `code` is kept; still never throws and still returns silently when the admin client is null (that gap is out of scope). `link-cookie.ts:40` binds the error and logs `cookie_link_lookup_failed` before `return null`. `turnstile.ts:37` binds and logs `turnstile_verify_failed` before `return false` (the other `false` paths stay silent).

#### 3. Tests

**Files**: `src/lib/links.test.ts` (extend), plus extend or add the closest existing test for `projects`, `timer`, `weekly-grid-query`, `access-log` and `link-cookie` where a mock of the admin client already exists

**Intent**: Prove the cause survives and the message did not drift.

**Contract**: for each converted wrapper one test asserts the thrown error's `message` is unchanged and `error.cause` is the original PostgREST object (code and details intact); `access-log` and `link-cookie` tests assert `console.error` receives a line with the event name and, for access-log, the link id and outcome. Existing assertions are not edited.

### Success Criteria:

#### Automated Verification:

- Suite passes with the extended lib tests: `npx vitest run`
- Type checking passes: `npx tsc --noEmit`
- No message-only rethrow remains in the data layer: `grep -rnE "new Error\(\`._(error|Error)\.message" src/lib --include=_.ts --exclude=*.test.ts` prints nothing

---

## Phase 3: API routes log with context

### Overview

Convert the seven API routes to the logger: errors with `route` and ids, warnings for the race backstops and form-parse failures.

### Changes Required:

#### 1. Link-lookup and action-failure logging

**Files**: `src/pages/api/links.ts`, `src/pages/api/w/[token]/delete-account.ts`, `src/pages/api/w/[token]/regenerate.ts`, `src/pages/api/w/[token]/projects/[projectId]/delete.ts`, `src/pages/api/w/[token]/timer/start.ts`, `stop.ts`, `switch.ts`

**Intent**: Every existing `console.error` becomes a distinguishable, correlatable event, and the `eslint-disable` comments go away.

**Contract**: lookup failures log `link_lookup_failed` with `route` only (no `link.id` exists yet); action failures log `<op>_failed` (`timer_start_failed`, `timer_stop_failed`, `timer_switch_failed`, `account_delete_failed`, `project_delete_failed`, `link_regenerate_failed`, `link_create_failed`) with `route` and `linkId` (and `projectId` where in scope). The response each branch returns is untouched.

#### 2. Expected-outcome and parse warnings

**Files**: same routes

**Intent**: Make race backstops and malformed bodies countable without logging attacker-steerable 404 traffic.

**Contract**: `logWarn` with `route` and `linkId` for `timer_start_already_running` (`TimerAlreadyRunningError`), `timer_stop_no_active` / `timer_switch_no_active` (`NoActiveTimerError`) and `project_delete_in_use` (`ProjectInUseError`). The body-parse `catch {` in `api/links.ts:30`, `delete-account.ts:37`, `timer/start.ts:37` and `timer/switch.ts:36` binds the error and logs `form_parse_failed` (with `detail` set to the request content-type; `linkId` where the link was already resolved) before falling through to the existing behaviour. `rewrite("/404")` for malformed or unknown tokens stays unlogged.

#### 3. Route tests

**Files**: `src/__tests__/delete-account-route.test.ts` (extend), `src/__tests__/timer-routes.test.ts` (new)

**Intent**: Lock in that logs carry the ids and never the token, and that responses did not change.

**Contract**: delete-account: the existing failure cases additionally assert a `console.error` line with `event`, `route` and the link id. Timer routes: mocking `@/lib/links` and `@/lib/timer` as the delete-account route test does, assert each failure and backstop emits the expected event with `linkId`, that the response status and `Location` match today's behaviour, and that no emitted line contains the request token.

### Success Criteria:

#### Automated Verification:

- Route tests pass: `npx vitest run src/__tests__`
- Whole suite stays green: `npx vitest run`
- Type checking passes: `npx tsc --noEmit`
- No inline console call or disable comment remains in the routes: `grep -rnE "console\.|eslint-disable-next-line no-console" src/pages/api` prints nothing

---

## Phase 4: Pages and the lint guard

### Overview

Log the page-level swallowed errors, then make the pattern impossible to reintroduce.

### Changes Required:

#### 1. Page catches

**Files**: `src/pages/w/[token].astro`, `src/pages/w/[token]/grid.astro` (two catches), `src/pages/w/[token]/delete-account.astro`, `src/pages/w/[token]/regenerate.astro`, `src/pages/w/[token]/projects/[projectId]/delete.astro`

**Intent**: A backend failure on a page still renders the friendly 503, but now leaves an event behind (the four "missed" probe rows).

**Contract**: bind the error and `logError("page_link_lookup_failed", { route: "GET /w/[token]" … }, err)` before `unavailable = true`; the `grid.astro:75` catch logs `page_week_entries_failed` with `linkId` and `op` set to the requested week start. Route strings are the page templates. Status codes, `logAccess` calls and rendered output are unchanged.

#### 2. ESLint guard

**File**: `eslint.config.js`

**Intent**: Fail the build when someone adds a catch that discards the error or calls `console` directly.

**Contract**: in the base rules add `no-restricted-syntax` with selector `CatchClause[param=null]` (message pointing to `src/lib/log.ts`), scoped to `src/**/*.{ts,tsx,astro}`; raise `no-console` from `"warn"` to `"error"` and add a `src/lib/log.ts` override turning it off. The single client-side `catch {` in `src/components/WorkspaceCard.astro:273` gets a one-line `eslint-disable-next-line no-restricted-syntax` with its reason (client clipboard fallback, nothing to report to). The `scripts/**` override stays as is.

### Success Criteria:

#### Automated Verification:

- Lint is clean (run once, here; if it reports unresolved `import.meta.env` types, delete `node_modules/.cache/eslint/` and rerun per `lessons.md`): `npm run lint`
- Astro check passes: `npx astro check`
- Whole suite stays green: `npx vitest run`
- Type checking passes: `npx tsc --noEmit`
- Deliberate break: adding `try { await Promise.resolve(); } catch { /* x */ }` to a file in `src/lib` makes `npx eslint <that file>` report `no-restricted-syntax`; remove it afterwards and confirm the working tree has no stray edit (`git diff --stat` lists only intended files)

---

## Phase 5: Runtime proof (before/after)

### Overview

Rerun the audit's probe suite on the new code and compare with the baseline, so "we think it's fixed" becomes evidence.

### Changes Required:

#### 1. Probe rerun

**Location**: isolated worktree `.claude/worktrees/agent-a992330e2542a0e09`, nothing committed from it

**Intent**: Same harness, new code, same probes.

**Contract**: first copy `probe/out/` to `probe/out-before/`; move the worktree onto this change's final commit with `git checkout --detach <sha>` (untracked probe files survive); run `bash probe/suite.sh` (needs the local Supabase stack running; lessons.md: give each database-touching lane its own stack slot if another lane is active). Do not edit `src/` in the worktree. Per `lessons.md`, find and stop the `wrangler`/`workerd` processes by port afterwards.

#### 2. Optional verify report

**File**: `context/audits/observability/<date>_verify-fix-silent-error-logging.md`

**Intent**: Record the before/after table next to the original audit.

**Contract**: produced by `/10x-observability-audit --verify context/audits/observability/2026-10-02_timer-delete-link-grid.md` using the table from this phase; new file, the original report is not edited.

### Success Criteria:

#### Automated Verification:

- The suite completes and writes `probe/out/results.json`: `bash probe/suite.sh`
- Every probe's HTTP status equals its status in `probe/out-before/results.json`
- Probe rows R7, R8, R12, R13, R14 now show a log line containing an `"event"` and a `"route"` (they showed only the request line before)
- Probe rows R1, R2s, R3, R5 now show the database `code` (previously dropped)
- No line containing `"event"` in `probe/out/full-console.log` contains the seeded link token

#### Manual Verification:

- The before/after table was read and the four formerly "missed" rows (R7, R12, R13, R14) are visibly diagnosable
- A `mode: verify` report with the table is written under `context/audits/observability/` and the original report is untouched

---

## Testing Strategy

### Unit Tests:

- Logger output shape, `cause` unwrapping depth, truncation, non-error inputs, `console.warn` for warnings, no extra keys.
- `dbError` message format and `cause` identity.
- Each converted lib wrapper: message unchanged, `cause` equals the original object; access-log and link-cookie emit their events.
- Route tests: event, route and `linkId` present, token absent, response unchanged.

### Integration Tests:

- None added. The opt-in integration suite (`npm run test:integration`) is not required to change; run it if the local stack is up, since it exercises the real lib wrappers.

### Manual Testing Steps:

1. Read the probe before/after table (Phase 5).
2. In a browser against a local build with Supabase stopped, open the workspace page and confirm the friendly "Temporarily unavailable" page still appears and the console shows one `page_link_lookup_failed` line.

## Performance Considerations

One `JSON.stringify` per failure event; no work on the success path. Stack and cause depth are bounded (depth 3, message 500 characters) so a 502 HTML body cannot bloat a log line.

## Migration Notes

None. No schema, env or deploy changes; log shape changes only, so any saved Workers Logs query matching the old static strings (for example `link lookup failed:`) must move to the `event` field.

## References

- Audit (frame and research for this change): `context/audits/observability/2026-10-02_timer-delete-link-grid.md`, sections 4 and 6
- Lessons applied: `context/foundation/lessons.md` (lint run once and cache clearing; `ASTRO_DEV_BACKGROUND`; `wrangler dev` cleanup; own Supabase slot per lane)
- Error spy pattern to follow: `src/__tests__/delete-account-route.test.ts:98,122`; admin-client mock pattern: `src/lib/links.test.ts:1-14`
- Probe harness: `.claude/worktrees/agent-a992330e2542a0e09/probe/` (`suite.mjs`, `suite.sh`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Logger and error helper

#### Automated

- [x] 1.1 New unit tests pass: `npx vitest run src/lib/log.test.ts src/lib/db-error.test.ts`
- [x] 1.2 Whole suite stays green: `npx vitest run`
- [x] 1.3 Type checking passes: `npx tsc --noEmit`

#### Manual

- [ ] 1.4 Printed sample lines for an `Error` with `cause`, a PostgREST-style object and a 600-character HTML message each read as one JSON line containing `event`, `route` and `error.code` where the input had one

### Phase 2: Data layer keeps the cause

#### Automated

- [ ] 2.1 Suite passes with the extended lib tests: `npx vitest run`
- [ ] 2.2 Type checking passes: `npx tsc --noEmit`
- [ ] 2.3 No message-only rethrow remains in the data layer: `grep -rnE "new Error\(\`._(error|Error)\.message" src/lib --include=_.ts --exclude=*.test.ts` prints nothing

### Phase 3: API routes log with context

#### Automated

- [ ] 3.1 Route tests pass: `npx vitest run src/__tests__`
- [ ] 3.2 Whole suite stays green: `npx vitest run`
- [ ] 3.3 Type checking passes: `npx tsc --noEmit`
- [ ] 3.4 No inline console call or disable comment remains in the routes: `grep -rnE "console\.|eslint-disable-next-line no-console" src/pages/api` prints nothing

### Phase 4: Pages and the lint guard

#### Automated

- [ ] 4.1 Lint is clean: `npm run lint`
- [ ] 4.2 Astro check passes: `npx astro check`
- [ ] 4.3 Whole suite stays green: `npx vitest run`
- [ ] 4.4 Type checking passes: `npx tsc --noEmit`
- [ ] 4.5 Deliberate break: a bare `catch {` added in `src/lib` makes `npx eslint <that file>` report `no-restricted-syntax`, and the temporary edit is removed afterwards

### Phase 5: Runtime proof (before/after)

#### Automated

- [ ] 5.1 The suite completes and writes `probe/out/results.json`: `bash probe/suite.sh`
- [ ] 5.2 Every probe's HTTP status equals its status in `probe/out-before/results.json`
- [ ] 5.3 Probe rows R7, R8, R12, R13, R14 now show a log line containing an `"event"` and a `"route"`
- [ ] 5.4 Probe rows R1, R2s, R3, R5 now show the database `code`
- [ ] 5.5 No line containing `"event"` in `probe/out/full-console.log` contains the seeded link token

#### Manual

- [ ] 5.6 The before/after table was read and the four formerly "missed" rows (R7, R12, R13, R14) are visibly diagnosable
- [ ] 5.7 A `mode: verify` report with the table is written under `context/audits/observability/` and the original report is untouched
