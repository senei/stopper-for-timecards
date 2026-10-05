# Failed lookup is not absence Implementation Plan

## Overview

When the database check behind a visitor's link cookie fails, the code reads the failure as "this browser has no link". The landing page then offers "Create my private link", and `POST /api/links` falls through to creation: if the database recovers in between, the visitor gets a second link, their old workspace is orphaned and one of the 10 slots is burned. The same shape sits in the throttle count (`count ?? 0`). This plan gives the failed check its own state, so the landing page shows the "Temporarily unavailable" view (503) and the sign-up POST refuses and sends the visitor back to `/`; and it makes a null throttle count an error. It implements S1, S7 and S9 (and the route half of S8) of the 2026-10-05 observability audit.

## Current State Analysis

The audit is this plan's frame and research (`context/audits/observability/2026-10-05_landing-signup.md`, findings S1, S7, S8, S9 and root cause 1); this plan does not re-investigate it. Spot-checked in the code on 2026-10-05.

- `src/lib/link-cookie.ts:30-48`: `resolveCookieLink(cookies): Promise<string | null>` returns `null` for four different cases: no cookie, a malformed cookie (cleared), a cookie whose link no longer exists (cleared), and a lookup that threw (logged as `cookie_link_lookup_failed` with `route: "lib/link-cookie"`, cookie kept). Its doc comment makes the last case deliberate ("so the caller can carry on").
- Two callers: `src/pages/index.astro:12-15` (redirect to the workspace, otherwise render the sign-up form) and `src/pages/api/links.ts:20-23` (redirect to the workspace, otherwise check the kill switch, Turnstile, throttle and create). Both treat `null` as "no link".
- `src/lib/links.ts:98-111`: `countRecentLinks` throws on `{ error }` but returns `count ?? 0`, so an unexpected null disables the 3-per-10-minutes throttle silently. Its neighbours (`createLink`, `findLinkByToken`) throw on unexpected shapes.
- A stale cookie (malformed, or its link was deleted or regenerated) is cleared with no event (`link-cookie.ts:47`), so mass clearing from a wrongly-null lookup would also be invisible.
- The pattern to repeat exists: five pages already render a "Temporarily unavailable" view with a "Try again" button and status 503 (`src/pages/w/[token].astro:28-38`, `src/components/WorkspaceCard.astro:83-90`, `grid.astro`, `delete.astro`, `delete-account.astro`).
- Tests: `src/lib/link-cookie.test.ts` pins the old behaviour ("returns null and leaves the cookie alone when the lookup throws") and mocks `./links`; `src/__tests__/links-route.test.ts` mocks `@/lib/link-cookie` as `resolveCookieLink: vi.fn()` resolving to `null` or a token string; no test covers `countRecentLinks`. No test imports an `.astro` file (`astro:env/server` and Astro components do not resolve in the default vitest run), so `index.astro` is proven by hand.
- The logger exists: `src/lib/log.ts` (`logError`, `logWarn`, `LogContext` with a required route template, optional `detail`, no token field). ESLint rejects a `catch` without a binding and any `console` call outside `log.ts`.

## Desired End State

- `resolveCookieLink(cookies, route)` returns `{ status: "linked", token }`, `{ status: "none" }` or `{ status: "unknown" }`. `unknown` means "the lookup failed, so we cannot tell", and the cookie is left alone.
- With a well-formed cookie and a failing database, `GET /` answers 503 with the "Temporarily unavailable" view and a "Try again" button, no sign-up form and no Turnstile script; the cookie stays.
- In the same situation `POST /api/links` creates nothing, calls neither Turnstile nor `countRecentLinks` nor `createLink`, and answers 303 to `/?error=1`.
- The log line for a failed check carries the caller's route (`GET /` or `POST /api/links`), never the token; a cleared stale cookie writes one `cookie_stale` warning with the reason (`malformed` or `not_found`).
- `countRecentLinks` throws when the database returns a null count, so the existing `link_create_failed` path refuses the sign-up instead of skipping the throttle.
- Everything else is byte-identical: a healthy returning visitor, a first-time visitor, the closed/busy/full banners and the Turnstile checks.

### Key Discoveries:

- `if (linkedToken)` on an object is always truthy, and `` `/w/${linkedToken}` `` would print `[object Object]`: the helper's return type and both callers must change in one commit (same trap as the Turnstile verdict change). ESLint's `restrict-template-expressions` and the TypeScript checks catch the template, but a mixed state must never be committed.
- The audit's own fix direction for S1 is to log the caller's route; passing it into the helper fixes the pseudo-route `lib/link-cookie` for this helper without adding request state.
- `?error=` values on `/` are forgeable (open F27), so reusing the existing generic code `1` adds no new forgeable message; the unavailable view is a real 503, not a query-driven banner.
- A failed check is never a reason to clear the cookie: the visitor's own link may be fine, and clearing it would orphan it from this browser.

## What We're NOT Doing

- No sign-up lifecycle events (`link_created`, `link_recognised`), no stage labels on `link_create_failed`, no logging of the created-but-undelivered case (audit S2, S3, S4): the next change.
- No events for `closed`, `busy`, `full` (open F9).
- No kill-switch warning, no site-key check, no Supabase-secret check (S5, S6, S10, F15).
- No widget callbacks and no new `?error=` code.
- No change to the Turnstile check, the throttle numbers, `createLink` or the cap.
- No change to the workspace pages' own lookup handling (they already log and show their 503 view).
- No test for `index.astro` in vitest (no Astro Container test; the page is proven by hand).
- No change to the kitchen-sink or any other page.

## Implementation Approach

Two steps, the risky one first. Phase 1 changes the helper's return type and both callers and their tests together (one commit), with the unavailable view on the landing page proven by hand against an unreachable Supabase URL. Phase 2 is the small data-layer fix for the null count and carries the last code-phase checks (full lint, `astro check`). The helper stays the only place that classifies the cookie; callers only decide what to show.

## Critical Implementation Details

- **State sequencing:** the helper, `index.astro`, `api/links.ts`, `link-cookie.test.ts` and `links-route.test.ts` change in one phase and one commit. Between the helper and a caller the type system may not stop an always-truthy check; a mixed state must never be committed.
- **User experience spec:** the landing page's unavailable view uses the same wording and structure as the workspace pages (heading "Temporarily unavailable", one sentence, a "Try again" link to the same URL) but its sentence says the link could not be checked ("We could not check your link right now. Please try again in a moment."). It does not render the sign-up form, the banners or the Turnstile script, and it leaves the `stopper_link` cookie untouched.
- **Debug & observability:** the failure line stays `cookie_link_lookup_failed` (so saved queries keep matching) and gains the caller's route; no line may contain the cookie token (the existing test asserts this and stays).

## Phase 1: Three-state cookie lookup and its two callers

### Overview

Make a failed cookie-link check its own state, log the caller's route and stale cookies, and make both callers act on it.

### Changes Required:

#### 1. The helper

**File**: `src/lib/link-cookie.ts`

**Intent**: Say which of three things is true about a browser's cookie (it resolves to a link, there is no usable link, or we could not check) so no caller can mistake an outage for absence.

**Contract**: `export type CookieLink = { status: "linked"; token: string } | { status: "none" } | { status: "unknown" }`; `resolveCookieLink(cookies: AstroCookies, route: string): Promise<CookieLink>`. No cookie → `none` (no log, nothing cleared). Malformed cookie → cleared, `logWarn("cookie_stale", { route, detail: "malformed" })`, `none`. Well-formed cookie whose link is gone → cleared, `logWarn("cookie_stale", { route, detail: "not_found" })`, `none`. Lookup throws → `logError("cookie_link_lookup_failed", { route }, err)`, cookie left alone, `unknown`. Resolves → `linked` with the token. The doc comment is rewritten to describe the three states and drops the "so the caller can carry on" sentence; the other helpers in the file are unchanged.

#### 2. The sign-up POST

**File**: `src/pages/api/links.ts`

**Intent**: A visitor whose cookie could not be checked must not be sent through creation.

**Contract**: `const cookieLink = await resolveCookieLink(cookies, ROUTE)`; `linked` redirects to `/w/<token>` as today; `unknown` returns `redirect("/?error=1", 303)` before the kill switch, Turnstile, throttle and `createLink` (the helper has already logged why); `none` continues exactly as today. Nothing else in the route changes.

#### 3. The landing page

**File**: `src/pages/index.astro`

**Intent**: Show an honest "cannot check right now" page instead of an invitation to create a second link.

**Contract**: `const cookieLink = await resolveCookieLink(Astro.cookies, "GET /")`; `linked` redirects as today; `unknown` sets `Astro.response.status = 503` and renders, instead of the sign-up content, the unavailable view described in "User experience spec" (heading, sentence, "Try again" link to the same path, built with `buttonVariants({ variant: "secondary" })` like `WorkspaceCard.astro:83-90`); in that state the Turnstile script tag is not rendered. The `none` path and the `?error=`, `?status=`, `?closed=`, `?full=` handling are unchanged.

#### 4. Tests

**Files**: `src/lib/link-cookie.test.ts` (update), `src/__tests__/links-route.test.ts` (update and extend)

**Intent**: Replace the test that pinned "an outage reads as no link" with tests that pin the three states, and pin that an `unknown` check creates nothing.

**Contract**: `link-cookie.test.ts` keeps the `setLinkCookie` cases and rewrites the `resolveCookieLink` cases to the new shape: no cookie → `none`, no log, nothing cleared; malformed → `none`, cleared, one `cookie_stale` warning with `detail: "malformed"` and the passed route; well-formed with no link → `none`, cleared, `cookie_stale` with `detail: "not_found"`; resolves → `linked` with the token, nothing cleared; lookup throws → `unknown`, cookie not cleared, one `cookie_link_lookup_failed` line whose `route` is the one passed in and whose text does not contain the token (the existing token-free assertion is kept). `links-route.test.ts` changes its mock to return `{ status: "linked", token }` / `{ status: "none" }` and adds: `unknown` redirects 303 to `/?error=1` and calls neither `verifyTurnstile`, `countRecentLinks`, `createLink` nor `setLinkCookie`; the existing cookie shortcut and kill-switch cases keep their assertions; the route passes `"POST /api/links"` as the route argument.

### Success Criteria:

#### Automated Verification:

- Cookie and route tests pass: `npx vitest run src/lib/link-cookie.test.ts src/__tests__/links-route.test.ts`
- Whole suite stays green: `npx vitest run`
- Type checking passes: `npx tsc --noEmit`
- Changed files lint clean: `npx eslint src/lib/link-cookie.ts src/lib/link-cookie.test.ts src/pages/api/links.ts src/__tests__/links-route.test.ts src/pages/index.astro`
- Deliberate break: in a worktree-only edit, making `resolveCookieLink` return `none` when the lookup throws turns the `unknown` case in `link-cookie.test.ts` red, and making the route fall through on `unknown` turns the `links-route.test.ts` refusal case red; both edits are reverted afterwards (`git diff --stat` lists only intended files)

#### Manual Verification:

- With the app running against an unreachable Supabase URL (for example `SUPABASE_URL=http://127.0.0.1:1`; start `astro dev` with `ASTRO_DEV_BACKGROUND=1`, per `lessons.md`) and a well-formed `stopper_link` cookie, opening `/` answers 503 with the "Temporarily unavailable" view, a "Try again" button, no sign-up form, the cookie still present in the browser, and one `cookie_link_lookup_failed` line with route `GET /` in the server output
- In the same state, submitting the form is not possible from `/`, so POST to `/api/links` with the cookie (for example `curl` with the cookie and an `Origin` header) answers 303 to `/?error=1`, creates nothing, and the log line's route is `POST /api/links`
- With a healthy Supabase and the same cookie the visitor is still redirected to their workspace, and with no cookie `/` still shows the sign-up form
- The wording of the unavailable sentence was read and approved

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Throttle count fails loudly

### Overview

Make an unexpected null throttle count an error, so the sign-up is refused through the existing failure path instead of the throttle being skipped. Run the last-code-phase checks.

### Changes Required:

#### 1. The count

**File**: `src/lib/links.ts`

**Intent**: Treat a null count like the other unexpected shapes in this file (a thrown error), not as "zero recent links".

**Contract**: in `countRecentLinks`, after the `{ error }` check, `if (count === null) throw new Error("recent link count returned null")`; otherwise return `count`. The `{ error }` branch and `dbError` stay as they are.

#### 2. Tests

**Files**: `src/lib/links.test.ts` (extend), `src/__tests__/links-route.test.ts` (extend)

**Intent**: Pin the new throw and that a failing count creates nothing.

**Contract**: `links.test.ts` adds a `countRecentLinks` block using the existing `adminOrThrow` mock with a small chain for `from().select().gte()`: returns the count when it is a number (including 0); throws `recent link count failed: <message>` with the original error as `cause` on `{ error }`; throws `recent link count returned null` when `count` is null. `links-route.test.ts` adds: when `countRecentLinks` rejects, the route answers 303 to `/?error=1`, calls neither `createLink` nor `setLinkCookie`, and writes one `link_create_failed` line (spy on `console.error`, as the other route tests do). Existing assertions are not edited.

### Success Criteria:

#### Automated Verification:

- Lib and route tests pass: `npx vitest run src/lib/links.test.ts src/__tests__/links-route.test.ts`
- Whole suite stays green: `npx vitest run`
- Type checking passes: `npx tsc --noEmit`
- Lint is clean (run once here, the last code phase; if it reports unresolved `import.meta.env` types, delete `node_modules/.cache/eslint/` and rerun per `lessons.md`): `npm run lint`
- Astro check passes (it covers the changed `index.astro`): `npx astro check`
- Deliberate break: in a worktree-only edit, restoring `return count ?? 0` turns the null-count case red; the edit is reverted afterwards (`git diff --stat` lists only intended files)

---

## Testing Strategy

### Unit Tests:

- The helper's five outcomes (no cookie, malformed, gone, resolves, throws), the events and routes they log, that the cookie is cleared only for the two stale cases, and that no line contains the token.
- The route: `unknown` creates nothing and redirects to `/?error=1`; the cookie shortcut and kill switch are unchanged; a failing count creates nothing.
- `countRecentLinks`: number, 0, `{ error }` with `cause`, null.

### Integration Tests:

- None added. The opt-in suite (`npm run test:integration`) is unaffected; run it if the local stack is up, since `findLinkByToken` is exercised there.

### Manual Testing Steps:

1. With an unreachable Supabase URL and a well-formed `stopper_link` cookie, open `/` and confirm the 503 unavailable view, the kept cookie and the log line (Phase 1).
2. POST to `/api/links` in the same state and confirm 303 to `/?error=1` and no new link.
3. Restore a healthy backend and confirm the returning visitor reaches their workspace and a cookie-less visitor sees the form.

## Performance Considerations

No change on the success path: one lookup per request exactly as before; a stale cookie now writes one short warning line, once per browser because the cookie is cleared.

## Migration Notes

None for data or deploy. A saved Workers Logs query on `cookie_link_lookup_failed` keeps matching; its `route` field is now `GET /` or `POST /api/links` instead of `lib/link-cookie`, so a query that filtered on the old route value must change. `cookie_stale` is a new warning event.

## References

- Audit (frame and research for this change): `context/audits/observability/2026-10-05_landing-signup.md` (S1, S7, S8, S9; root cause 1)
- Pattern to repeat: `src/pages/w/[token].astro:28-38`, `src/components/WorkspaceCard.astro:83-90`
- Verdict-type change in one commit: `context/archive/2026-10-02-turnstile-failure-visibility/plan.md` (Critical Implementation Details)
- Logger: `src/lib/log.ts`; error spy pattern: `src/lib/link-cookie.test.ts`, `src/__tests__/timer-routes.test.ts`
- Lessons applied: `context/foundation/lessons.md` (`ASTRO_DEV_BACKGROUND`, lint run once in the last code phase and cache clearing)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Three-state cookie lookup and its two callers

#### Automated

- [x] 1.1 Cookie and route tests pass: `npx vitest run src/lib/link-cookie.test.ts src/__tests__/links-route.test.ts` — 10abb2d
- [x] 1.2 Whole suite stays green: `npx vitest run` — 10abb2d
- [x] 1.3 Type checking passes: `npx tsc --noEmit` — 10abb2d
- [x] 1.4 Changed files lint clean: `npx eslint src/lib/link-cookie.ts src/lib/link-cookie.test.ts src/pages/api/links.ts src/__tests__/links-route.test.ts src/pages/index.astro` — 10abb2d
- [x] 1.5 Deliberate break: a helper that returns `none` when the lookup throws turns the `unknown` case red and a route that falls through on `unknown` turns the refusal case red; both edits are reverted — 10abb2d

#### Manual

- [x] 1.6 With an unreachable Supabase URL and a well-formed `stopper_link` cookie, `/` answers 503 with the "Temporarily unavailable" view, a "Try again" button, no sign-up form, the cookie kept, and one `cookie_link_lookup_failed` line with route `GET /` — 10abb2d
- [x] 1.7 In the same state a POST to `/api/links` with the cookie answers 303 to `/?error=1`, creates nothing, and logs route `POST /api/links` — 10abb2d
- [x] 1.8 With a healthy Supabase the same cookie still redirects to the workspace, and with no cookie `/` still shows the sign-up form — 10abb2d
- [x] 1.9 The wording of the unavailable sentence was read and approved — 10abb2d

### Phase 2: Throttle count fails loudly

#### Automated

- [x] 2.1 Lib and route tests pass: `npx vitest run src/lib/links.test.ts src/__tests__/links-route.test.ts`
- [x] 2.2 Whole suite stays green: `npx vitest run`
- [x] 2.3 Type checking passes: `npx tsc --noEmit`
- [x] 2.4 Lint is clean: `npm run lint`
- [x] 2.5 Astro check passes: `npx astro check`
- [x] 2.6 Deliberate break: restoring `return count ?? 0` turns the null-count case red; the edit is reverted
