# Sign-up lifecycle events Implementation Plan

## Overview

`POST /api/links` is the only way to get a private link, and it leaves almost no trace. A created link emits no event, so a broken widget or a drop in sign-ups looks like "no traffic". The `closed`, `busy` and `full` refusals are silent redirects. One `try` covers the throttle count, the `create_link` call and the cookie, so `link_create_failed` cannot say which stage failed, and when the insert commits but a later step fails the log has no link id even though it was known. This plan gives every outcome of the route an event, labels the stage of a failure, keeps the link id on post-create failures and gives a missing Supabase configuration its own event. Responses, redirects and cookies do not change; only what reaches Workers Logs changes. It implements S2, S3, S4 and the route half of S8, plus open F9, of the 2026-10-05 observability audit.

## Current State Analysis

The audit is this plan's frame and research (`context/audits/observability/2026-10-05_landing-signup.md`, findings S2, S3, S4, S8, root causes 2 and 3, fix order step 2); this plan does not re-investigate it. Spot-checked in the code on 2026-10-05.

- `src/pages/api/links.ts:20-62`: after the cookie check (`resolveCookieLink(cookies, ROUTE)`, done in the last change), the route refuses silently on the kill switch (`/?closed=1`, line 28), runs Turnstile (refusals are logged inside `turnstile.ts`), then one `try` covers `countRecentLinks` (`/?error=busy`), `createLink` (`/?full=1` when the cap is reached), `setLinkCookie` and the redirect. Its `catch` writes `logError("link_create_failed", { route: ROUTE }, err)` and redirects to `/?error=1`.
- `src/lib/links.ts:11-27`: `createLink` calls the `create_link` RPC, which commits the row; the id comes back as `response.data`. A non-string, non-null result throws `new Error("create_link returned an unexpected value")` after the commit, with no hint of the value's type.
- `src/lib/supabase-admin.ts:17-22`: `adminOrThrow` throws a plain `new Error("Supabase is not configured")`, indistinguishable by type from any other failure.
- `src/lib/log.ts:76-93`: `toLine(level: "error" | "warn", …)`, `logError` (`console.error`) and `logWarn` (`console.warn`) are the only emitters; there is no info level and ESLint forbids `console` anywhere else.
- Tests: `src/__tests__/links-route.test.ts` mocks `astro:env/server`, `@/lib/link-cookie`, `@/lib/links` and `@/lib/turnstile`, drives the route with a fake context and already spies on `console.error` for the failing-count case (added in `failed-lookup-not-absence`); `src/lib/links.test.ts` mocks `./supabase-admin` and tests `deleteAccount` and `countRecentLinks`; `src/lib/log.test.ts` pins the logger's output shape. No test covers `createLink`.
- `access_log.outcome` is limited to `success`, `not_found`, `error` by a check constraint (`supabase/migrations/20260918082739_phase_b_c_purge_and_access_log.sql:46`), so a durable "created" row would need a migration; this plan does not add one.
- Lessons that apply: lint once in the last code phase and clear the ESLint cache if unresolved-type errors appear only in cached runs (`context/foundation/lessons.md`).

## Desired End State

- `log.ts` exposes `logInfo(event, context)`: one JSON line with `level: "info"` through `console.info`, same shape and key rules as the other two.
- A successful sign-up writes one `link_created` info line with `route` and `linkId`, emitted as soon as `createLink` returns, so a later failure cannot lose the id; the line never contains the token.
- The refusals write one line each: `link_creation_closed` (info), `link_creation_busy` (warn, with the count and limit in `detail`) and `link_creation_full` (warn). The redirects are unchanged.
- `link_create_failed` carries `op` set to the failed stage (`count_recent`, `create_link` or `set_cookie`) and, once the link exists, its `linkId`. A missing Supabase configuration writes `supabase_not_configured` instead, with the same `op`.
- The "unexpected value" error from `createLink` names the value's `typeof`.
- Everything the visitor sees, every status code, redirect and cookie, is byte-identical to before.

### Key Discoveries:

- The id is known the moment `createLink` returns (`links.ts:17-27`), before `setLinkCookie` and the redirect, so logging `link_created` there means the id is in the log whatever happens next.
- The route's `catch` cannot tell stages apart today because the stages share one `try` (`api/links.ts:45-60`); a variable updated before each stage gives the `catch` its `op` without nesting.
- `adminOrThrow` is the single throw site for "Supabase is not configured" (`supabase-admin.ts:19`); a subclass of `Error` with the same message keeps every existing message match and lets the route use `instanceof`.
- `LogContext` already has `op` and `detail` (`log.ts:6-13`); no new context fields are needed, and it still has no token field.
- The anonymous POST path is reachable by bots before Turnstile (the kill switch comes first), so `link_creation_closed` is steerable volume; it is one short line per request, and each such request is already a Workers invocation (the same accepted trade-off as the Turnstile refusal lines).

## What We're NOT Doing

- No `link_recognised` event for returning visitors (decided: Workers Logs already show request volume).
- No `access_log` row and no migration for a created link (decided: log lines only; open F10 stays open).
- No change to `turnstile.ts`, its route label or its events, and no change to `link-cookie.ts` or `access-log.ts` (the rest of S8).
- No kill-switch warning, site-key check or Supabase-secret check at render time (S5, S6, S10, F15).
- No change to responses, redirects, status codes, cookies, the throttle numbers or the cap.
- No request id and no `linkId` in `locals` for the error boundary (P3).
- No change to `regenerate.ts` or its post-commit `try` (P4) and no change to the other routes' events.
- No new error codes on `/` (F27).

## Implementation Approach

Two steps, shared pieces first. Phase 1 adds the building blocks as pure additions with unit tests and no callers (the info logger, the configuration error class and the clearer `createLink` message), so it ships green on its own. Phase 2 rewrites the route around them: events for every outcome, a stage variable for the failure path, and the link id captured as soon as it exists, with route tests for each event and the last-code-phase checks. The route keeps its order of checks and its responses exactly.

## Critical Implementation Details

- **State sequencing:** in the route the created link's id must be recorded in a variable declared outside the `try` before `setLinkCookie` runs, and `link_created` must be written before `setLinkCookie`, so the `catch` can attach `linkId` when only the cookie or the redirect fails.
- **Debug & observability:** no log line may contain the link token (`result.token`); only `result.id` is logged. The route test asserts this by checking every emitted line against the token the mocked `createLink` returns.

## Phase 1: Logger and library support

### Overview

Add the info level, the configuration error class and a clearer `createLink` error, with unit tests. Nothing in the route changes yet.

### Changes Required:

#### 1. The info level

**File**: `src/lib/log.ts`

**Intent**: Give successes and expected outcomes the same one-line JSON shape as failures, without any caller touching `console`.

**Contract**: `logInfo(event: string, context: LogContext): void` writes one `console.info(JSON.stringify({ level: "info", event, ...context }))`; `toLine`'s level parameter becomes `"error" | "warn" | "info"`; the serialization-failure fallback and the "no extra keys" rule are unchanged. `console.info` is covered by the same `src/lib/log.ts` override that already allows `console.error` and `console.warn`.

#### 2. A distinguishable configuration error

**File**: `src/lib/supabase-admin.ts`

**Intent**: Let a caller tell "Supabase is not configured" from a database failure without parsing a message.

**Contract**: `export class SupabaseNotConfiguredError extends Error` whose constructor takes no arguments, calls `super("Supabase is not configured")` and sets `name`; `adminOrThrow` throws it instead of the plain `Error`. The message text is unchanged, so the existing assertions that match it keep passing.

#### 3. A clearer unexpected-value error

**File**: `src/lib/links.ts`

**Intent**: When the `create_link` RPC returns something that is neither null nor a string, say what it returned (its type, never its value) so a schema drift is diagnosable.

**Contract**: in `createLink`, the error becomes `` `create_link returned an unexpected value (typeof ${typeof id})` ``; the `null` branch (`full`), the string branch (`created`) and every other function in the file are unchanged.

#### 4. Unit tests

**Files**: `src/lib/log.test.ts` (extend), `src/lib/links.test.ts` (extend), `src/lib/supabase-admin.test.ts` (new)

**Intent**: Pin the new shapes so the route tests and the later probe can rely on them.

**Contract**: `log.test.ts` adds: `logInfo` writes exactly one `console.info` line that parses as JSON with `level: "info"`, `event` and the context fields, adds no other key, and does not call `console.error` or `console.warn`. `links.test.ts` adds a `createLink` block with the existing `adminOrThrow` mock and an `rpc` stub: a string id gives `{ status: "created", id }` with a token that is not the id; `null` gives `{ status: "full" }`; an `{ error }` throws `create_link failed: <message>` with the original error as `cause`; a number answer throws a message containing `unexpected value (typeof number)`. `supabase-admin.test.ts` (mock `astro:env/server` with both variables unset) asserts that `adminOrThrow()` throws a `SupabaseNotConfiguredError` that is also an `Error` and whose message is `Supabase is not configured`, and that `createAdminClient()` still returns `null`. Existing assertions are not edited.

### Success Criteria:

#### Automated Verification:

- New and extended unit tests pass: `npx vitest run src/lib/log.test.ts src/lib/links.test.ts src/lib/supabase-admin.test.ts`
- Whole suite stays green: `npx vitest run`
- Type checking passes: `npx tsc --noEmit`
- Changed files lint clean: `npx eslint src/lib/log.ts src/lib/log.test.ts src/lib/links.ts src/lib/links.test.ts src/lib/supabase-admin.ts src/lib/supabase-admin.test.ts`
- Deliberate break: in a worktree-only edit, making `logInfo` call `console.warn` instead of `console.info` turns the `logInfo` test red, and making `adminOrThrow` throw a plain `Error` turns the `supabase-admin.test.ts` instance check red; both edits are reverted afterwards (`git diff --stat` lists only intended files)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for confirmation before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Route events and stages

### Overview

Make `POST /api/links` write one event per outcome, label the stage of a failure, keep the link id on post-create failures and give a missing configuration its own event.

### Changes Required:

#### 1. The route

**File**: `src/pages/api/links.ts`

**Intent**: Every outcome of the sign-up leaves one correlatable line, and a failure says where it happened and which link it concerned; the visitor's experience does not change.

**Contract**: the order of checks and every response stay exactly as they are. Added logging, all with `route: ROUTE` and never the token: kill switch → `logInfo("link_creation_closed", { route })` before the redirect to `/?closed=1`; throttle at or above the limit → `logWarn("link_creation_busy", { route, op: "count_recent", detail: "<count> of <THROTTLE_MAX_LINKS> in <THROTTLE_WINDOW_MINUTES> minutes" })` before `/?error=busy`; `createLink` returning `full` → `logWarn("link_creation_full", { route, op: "create_link" })` before `/?full=1`; `createLink` returning `created` → `logInfo("link_created", { route, linkId: result.id })` immediately, before `setLinkCookie`. The single `try` stays one `try`, but a variable (`stage`, one of `"count_recent"`, `"create_link"`, `"set_cookie"`) is set before each step and a variable holds the created link's id as soon as it is known, both declared outside the `try`. The `catch` writes `supabase_not_configured` (`logError`, `{ route, op: stage }`) when `err instanceof SupabaseNotConfiguredError`, otherwise `link_create_failed` with `{ route, op: stage, linkId }` (`linkId` only when the link was already created), and redirects to `/?error=1` as today.

#### 2. Route tests

**File**: `src/__tests__/links-route.test.ts` (extend)

**Intent**: Pin one event per outcome, the stage and link id on failures, and that no line ever contains the token.

**Contract**: spy on `console.info`, `console.warn` and `console.error` (restored in `finally` or `afterEach`, as the other route tests do). Cases: a created link writes exactly one `link_created` info line with `linkId: "link-1"` and the response is unchanged; the kill switch writes one `link_creation_closed` info line and no Turnstile call; a count at the limit writes one `link_creation_busy` warn line whose `detail` carries the count and the limit; `createLink` returning `full` writes one `link_creation_full` warn line; the failing-count case gains `op: "count_recent"`; `createLink` rejecting gives `link_create_failed` with `op: "create_link"` and no `linkId`; `setLinkCookie` throwing gives `link_create_failed` with `op: "set_cookie"` and `linkId: "link-1"`, after a `link_created` line; a rejection with a `SupabaseNotConfiguredError` gives `supabase_not_configured` with the stage and no `link_create_failed`; across all cases, no emitted line contains the token returned by the mocked `createLink` (`"new-token"`). If importing the error class requires it, mock `@/lib/supabase-admin` so the class stays real (`importActual`) without pulling `astro:env/server`. Existing assertions are not edited.

### Success Criteria:

#### Automated Verification:

- Route tests pass: `npx vitest run src/__tests__/links-route.test.ts`
- Whole suite stays green: `npx vitest run`
- Type checking passes: `npx tsc --noEmit`
- Lint is clean (run once here, the last code phase; if it reports unresolved `import.meta.env` types, delete `node_modules/.cache/eslint/` and rerun per `lessons.md`): `npm run lint`
- No `console` call or disable comment was added outside `log.ts`: `grep -rnE "console\.|eslint-disable-next-line no-console" src/pages/api/links.ts` prints nothing
- Deliberate break: in a worktree-only edit, removing the `link_created` call turns the created case red, and setting the stage variable only once (so a failing cookie reports `count_recent`) turns the `set_cookie` case red; both edits are reverted afterwards (`git diff --stat` lists only intended files)

#### Manual Verification:

- With the local Supabase stack and the dev server (start `astro dev` with `ASTRO_DEV_BACKGROUND=1`, per `lessons.md`), a POST to `/api/links` with Turnstile's always-pass dummy token creates a link and the server output shows exactly one `link_created` line with `route: "POST /api/links"` and a `linkId`, and no line contains the token from the redirect URL
- With `LINK_CREATION_CLOSED=1` the same POST redirects to `/?closed=1` and prints one `link_creation_closed` line; the visitor-facing redirects in both cases are unchanged from today

---

## Testing Strategy

### Unit Tests:

- Logger: `logInfo` shape and emitter; `createLink` statuses, error with `cause`, unexpected-value message; the configuration error class.
- Route: one event per outcome (created, closed, busy, full), the stage and link id on each failure path, the configuration event, and no line containing the token.

### Integration Tests:

- None added. The opt-in suite (`npm run test:integration`) is unaffected; run it if the local stack is up, since `createLink` is exercised against the real RPC there.

### Manual Testing Steps:

1. With the local stack up, create a link through the route and confirm the single `link_created` line (Phase 2).
2. Close creation with `LINK_CREATION_CLOSED=1` and confirm `link_creation_closed` and the unchanged redirect.
3. Optionally, repeat creation until the throttle (3 in 10 minutes) fires and confirm `link_creation_busy` with the count.

## Performance Considerations

One short JSON line per outcome; no work on any other path. Refusal lines are reachable by anonymous POSTs (the kill switch comes before Turnstile), the same accepted trade-off as the Turnstile refusal lines: each such request is already a Workers invocation.

## Migration Notes

None for data or deploy. `link_create_failed` keeps its name and gains `op` and, after the insert, `linkId`; a saved Workers Logs query on it keeps matching, and a failure with a missing configuration now appears as `supabase_not_configured` instead, so a query that counted configuration failures under `link_create_failed` must add the new event. `link_created`, `link_creation_closed`, `link_creation_busy`, `link_creation_full` and `supabase_not_configured` are new events.

## References

- Audit (frame and research for this change): `context/audits/observability/2026-10-05_landing-signup.md` (S2, S3, S4, S8; root causes 2 and 3; fix order step 2), and F9 of `context/audits/observability/2026-10-02_timer-delete-link-grid.md`
- Route and error-spy pattern to extend: `src/__tests__/links-route.test.ts` (the failing-count case from `context/archive/2026-10-05-failed-lookup-not-absence/`)
- Logger: `src/lib/log.ts`; logger tests: `src/lib/log.test.ts`; admin-client mock pattern: `src/lib/links.test.ts:1-14`
- Lessons applied: `context/foundation/lessons.md` (lint run once in the last code phase and cache clearing; `ASTRO_DEV_BACKGROUND`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Logger and library support

#### Automated

- [x] 1.1 New and extended unit tests pass: `npx vitest run src/lib/log.test.ts src/lib/links.test.ts src/lib/supabase-admin.test.ts` — d465192
- [x] 1.2 Whole suite stays green: `npx vitest run` — d465192
- [x] 1.3 Type checking passes: `npx tsc --noEmit` — d465192
- [x] 1.4 Changed files lint clean: `npx eslint src/lib/log.ts src/lib/log.test.ts src/lib/links.ts src/lib/links.test.ts src/lib/supabase-admin.ts src/lib/supabase-admin.test.ts` — d465192
- [x] 1.5 Deliberate break: `logInfo` calling `console.warn` turns the `logInfo` test red and `adminOrThrow` throwing a plain `Error` turns the instance check red; both edits are reverted — d465192

### Phase 2: Route events and stages

#### Automated

- [x] 2.1 Route tests pass: `npx vitest run src/__tests__/links-route.test.ts` — bd1229a
- [x] 2.2 Whole suite stays green: `npx vitest run` — bd1229a
- [x] 2.3 Type checking passes: `npx tsc --noEmit` — bd1229a
- [x] 2.4 Lint is clean: `npm run lint` — bd1229a
- [x] 2.5 No `console` call or disable comment was added outside `log.ts`: `grep -rnE "console\.|eslint-disable-next-line no-console" src/pages/api/links.ts` prints nothing — bd1229a
- [x] 2.6 Deliberate break: removing the `link_created` call turns the created case red and setting the stage only once turns the `set_cookie` case red; both edits are reverted — bd1229a

#### Manual

- [x] 2.7 With the local stack and dev server, a POST to `/api/links` with the always-pass dummy token creates a link and the server output shows exactly one `link_created` line with route `POST /api/links` and a `linkId`, and no line contains the token from the redirect URL — bd1229a
- [x] 2.8 With `LINK_CREATION_CLOSED=1` the same POST redirects to `/?closed=1` and prints one `link_creation_closed` line; the visitor-facing redirects in both cases are unchanged from today — bd1229a
