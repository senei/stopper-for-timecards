# Make Turnstile failures visible to the operator Implementation Plan

## Overview

When Turnstile refuses a sign-up, nothing records why: `verifyTurnstile` returns a bare boolean, throws away Cloudflare's `error-codes`, and only its thrown-exception branch logs. This plan makes the verifier return a verdict that carries a reason, logs that reason through `src/lib/log.ts`, and has the route let only an explicit `ok` verdict through. The deliberate fail-closed rule, the visitor's message and the widget do not change.

## Current State Analysis

Problem statement, evidence and the scope split come from the frame (`context/changes/turnstile-failure-visibility/frame.md`); this plan does not re-investigate them.

- `src/lib/turnstile.ts:13-43`: `verifyTurnstile(token, ip, secret): Promise<boolean>` returns `false` for a missing token or secret (`:18-20`), a non-2xx response (`:33-35`) and anything but `success: true` (`:38`); only the `catch` logs (`:39-42`, event `turnstile_verify_failed`). Cloudflare's `error-codes` are never read (they appear only as a fixture in `src/lib/turnstile.test.ts:44`).
- `src/pages/api/links.ts:39-40`: `if (!(await verifyTurnstile(token, ip, TURNSTILE_SECRET_KEY))) return redirect("/?error=verify", 303)`. The token is read from the form at `:32,37`; the secret comes from `astro:env/server`, where both Turnstile keys are `optional: true` (`astro.config.mjs:22-23`).
- `src/pages/index.astro:21-26`: one generic banner, "Verification failed; please try again.", chosen on purpose (`context/archive/2026-09-21-private-link-access/plan.md:164`).
- Fail-closed is a standing decision: "Missing Turnstile configuration fails closed (no link can be created) rather than open" (`plan.md:55` of that change, `plan-brief.md:55`).
- No test covers the route `src/pages/api/links.ts`; the Turnstile gate is covered only by `scripts/smoke.mjs:128,143` with always-pass dummy keys.
- The logger exists: `src/lib/log.ts` (`logError`, `logWarn`, `LogContext` with `route`, `detail`, no token field), added by the shipped `fix-silent-error-logging` change. ESLint rejects a `catch` without a binding and any direct `console` call outside `log.ts`.
- Opt-in integration tests live in `vitest.integration.config.ts` (`src/**/*.integration.test.ts`, run by `npm run test:integration`, not in CI or the default suite); `astro:env/server` is aliased there to `src/test/astro-env-server-stub.ts`.

## Desired End State

- `verifyTurnstile` returns `{ ok: true }` or `{ ok: false, reason, errorCodes? }`, `reason` being `missing_token`, `missing_secret`, `rejected`, `unavailable` or `bad_response`.
- Every refusal writes one log line through `logError` / `logWarn` with the reason and, for a rejection, Cloudflare's codes; no line contains the token, the secret or the IP.
- `api/links.ts` creates a link only when the verdict is `ok: true`; every other verdict redirects to `/?error=verify` exactly as today.
- An opt-in test proves the real `siteverify` strings for Cloudflare's dummy secrets, and a runtime check shows the new lines in the logs of the real route.

### Key Discoveries:

- Cloudflare's documented `error-codes` (server-side validation docs): `missing-input-secret`, `invalid-input-secret` ("secret key is invalid or expired"), `missing-input-response`, `invalid-input-response` ("token is invalid, malformed, or expired"), `bad-request`, `timeout-or-duplicate` ("token has already been validated"), `internal-error`. A token is valid for 300 seconds and single-use. These confirm the frame's prior-knowledge items.
- `invalid-input-secret` separates a wrong or rotated secret from a bad token, and `timeout-or-duplicate` separates a spent token from a real rejection: exactly the causes that look identical today.
- A hostname mismatch is not an `error-codes` value: the widget reports it client-side (`110200`), and a success response carries a `hostname` field for the app to compare. The docs give no fail-open/closed guidance for a `siteverify` outage, so fail-closed stays our own decision.
- Cloudflare's dummy secrets force outcomes without injecting faults: `1x0000000000000000000000000000000AA` always passes, `2x0000000000000000000000000000000AA` always fails, `3x0000000000000000000000000000000AA` returns "token already spent"; the dummy token is `XXXX.DUMMY.TOKEN.XXXX`. Production secrets reject the dummy token.
- Changing the return type to an object is a fail-open trap: `!(await verifyTurnstile(...))` on an object is always `false`. Verifier and call site must change in one phase, and a route test must pin that a refusal creates nothing.
- The failure branches before the network (no secret, no token) cost no request, so they can be logged without any Cloudflare call.

## What We're NOT Doing

- No change to what the visitor sees: the single "Verification failed; please try again." banner stays, no new `?error=` value, no change to `index.astro`.
- No widget callbacks (`data-callback`, `data-error-callback`, `data-expired-callback`) and no gating of the submit button; the frame rates that path weak for the observed incident.
- No startup validation or required-secret change in `astro.config.mjs`, and no alerting: Workers Logs via `console` stay the only channel.
- No relaxation of fail-closed: no fallback that lets a link be created when verification is unavailable.
- No change to the throttle, the kill switch, the cookie shortcut or `createLink`.
- The page error boundary (F3, F13) is the separate change `page-error-boundary`.
- No smoke scenarios for failing keys: `smoke-local` writes the keys into env files per run, so each scenario would need an app restart.

## Implementation Approach

One change in three steps: make the verdict and its logs and the route that consumes it together (phase 1, unit- and route-tested), prove the real Cloudflare strings in an opt-in test (phase 2), then prove the new lines through the real route in `wrangler dev` against a baseline (phase 3). The verifier logs for itself, so no caller can forget; the route only decides. Log levels follow who can act: `error` when the operator must fix something, `warn` when a visitor was refused.

## Critical Implementation Details

- **State sequencing:** the verifier's return type and `api/links.ts` change in the same phase and the same commit. Between them the type system does not stop the always-false condition; ESLint's `no-unnecessary-condition` would, but a mixed state must never be committed.
- **Debug & observability:** nothing secret goes into a log line: not the token, the secret, the visitor's IP or the raw `siteverify` body. Only the reason, the status code of a non-2xx response and Cloudflare's `error-codes` strings are logged.

## Phase 1: Verdict with a reason, logs, and the route

### Overview

Change `verifyTurnstile` to return a verdict, log every refusal, and make `api/links.ts` fail closed on anything but `ok`. Rewrite the verifier's tests and add the first test of the route.

### Changes Required:

#### 1. The verdict and its logs

**File**: `src/lib/turnstile.ts`

**Intent**: Return why a verification did not pass, and write that to the log from the one place that knows it, so a caller cannot forget.

**Contract**: `type TurnstileVerdict = { ok: true } | { ok: false; reason: "missing_token" | "missing_secret" | "rejected" | "unavailable" | "bad_response"; errorCodes?: string[] }`; `verifyTurnstile(token, ip, secret): Promise<TurnstileVerdict>` keeps its parameters. Mapping: no token → `missing_token` (no network call); no secret → `missing_secret` (no network call); `fetch` throws, times out, or answers non-2xx → `unavailable`; the body is not JSON, or has no boolean `success` → `bad_response`; `success: true` → `ok`; `success: false` → `rejected` with `errorCodes` taken from the response's `error-codes` array (strings only, otherwise empty). Logging, through `src/lib/log.ts` with `route: "lib/turnstile"`: `turnstile_secret_missing` (`logError`), `turnstile_unavailable` (`logError`, with the thrown error or `detail` set to the HTTP status), `turnstile_bad_response` (`logError`), `turnstile_missing_token` (`logWarn`), and for `rejected` one line `turnstile_rejected` with `detail` set to the codes joined by commas: `logError` when any code is operator-side (`missing-input-secret`, `invalid-input-secret`, `bad-request`, `internal-error`), `logWarn` otherwise (`invalid-input-response`, `timeout-or-duplicate`, `missing-input-response`, none). The existing `turnstile_verify_failed` event is replaced by `turnstile_unavailable`. No token, secret, IP or response body in any line.

#### 2. The route fails closed on the verdict

**File**: `src/pages/api/links.ts`

**Intent**: Let a sign-up continue only on an explicit `ok`, and keep every other outcome identical for the visitor.

**Contract**: the call at `:39` becomes `const verdict = await verifyTurnstile(...)` followed by `if (!verdict.ok) return redirect("/?error=verify", 303)`. Nothing else in the route changes: the cookie shortcut, kill switch, form parsing, throttle and `createLink` keep their order and behaviour.

#### 3. Unit tests for the verdict

**File**: `src/lib/turnstile.test.ts`

**Intent**: Pin every outcome, its log line, and that no secret or token leaks.

**Contract**: replace the boolean assertions with verdict assertions, keeping the request-shape test. Cases: success → `{ ok: true }`; `success: false` with `invalid-input-response`, `timeout-or-duplicate` and with `invalid-input-secret` → `rejected` with the codes and the expected level (`warn` for the first two, `error` for the third); `success: false` with no `error-codes` → `rejected` with an empty list; non-2xx → `unavailable`; network error and timeout → `unavailable`; a body that is not JSON, and a body with no boolean `success` → `bad_response`; empty and null token → `missing_token` without a `fetch` call; missing secret → `missing_secret` without a `fetch` call; each refusal writes exactly one line with the expected `event`; no line contains the token, the secret or the IP; fail-closed: no input produces `{ ok: true }` unless `success === true`.

#### 4. A test for the route

**File**: `src/__tests__/links-route.test.ts` (new)

**Intent**: The route had no test; this pins that a refusal creates nothing and that only `ok` proceeds.

**Contract**: mock `astro:env/server` (the secret and `LINK_CREATION_CLOSED`), `@/lib/turnstile`, `@/lib/links` and `@/lib/link-cookie`, following the mocking style of `src/__tests__/timer-routes.test.ts`. Cases: every `ok: false` reason redirects to `/?error=verify` with status 303 and calls neither `countRecentLinks` nor `createLink`; `ok: true` reaches the throttle and `createLink`; a returning visitor with a valid cookie is redirected to their workspace without calling the verifier; creation closed redirects to `/?closed=1` without calling the verifier.

### Success Criteria:

#### Automated Verification:

- Verifier and route tests pass: `npx vitest run src/lib/turnstile.test.ts src/__tests__/links-route.test.ts`
- Whole suite stays green: `npx vitest run`
- Type checking passes: `npx tsc --noEmit`
- Changed files lint clean: `npx eslint src/lib/turnstile.ts src/lib/turnstile.test.ts src/pages/api/links.ts src/__tests__/links-route.test.ts`
- Deliberate break: in a worktree-only edit, making `verifyTurnstile` return `{ ok: true }` when the secret is missing turns a `turnstile.test.ts` case red, and making the route ignore the verdict (always continue) turns the `links-route.test.ts` refusal case red; both edits are reverted afterwards

---

## Phase 2: Opt-in test against the real Cloudflare siteverify

### Overview

Add a test that calls the real `siteverify` with Cloudflare's dummy secrets, so the mapped reasons and the real `error-codes` strings are proven rather than assumed.

### Changes Required:

#### 1. The live test

**File**: `src/lib/turnstile.integration.test.ts` (new)

**Intent**: Prove the verdict against what Cloudflare actually returns, and catch documentation drift, without injecting faults.

**Contract**: matches the existing integration pattern (`vitest.integration.config.ts`, run by `npm run test:integration`), gated by the environment variable `TURNSTILE_LIVE=1`; when it is unset the suite is skipped and its title says why, as `integrationTitle` does for the Supabase suites. It imports only `turnstile.ts`, so it needs no Supabase and no `astro:env` stub. Cases against `siteverify` with the dummy token `XXXX.DUMMY.TOKEN.XXXX`: secret `1x0000000000000000000000000000000AA` → `{ ok: true }`; secret `2x0000000000000000000000000000000AA` → `rejected` with a non-empty `errorCodes`; secret `3x0000000000000000000000000000000AA` → `rejected` whose codes include `timeout-or-duplicate`; a made-up secret string → `rejected` with `invalid-input-secret`. The actual codes the dummy secrets return are asserted as a non-empty list of strings and, once observed, written into this plan's Migration Notes.

### Success Criteria:

#### Automated Verification:

- Live test passes against Cloudflare: `TURNSTILE_LIVE=1 npx vitest run --config vitest.integration.config.ts src/lib/turnstile.integration.test.ts`
- Without the variable the suite is skipped, with the reason in its title, and does not fail: `npx vitest run --config vitest.integration.config.ts src/lib/turnstile.integration.test.ts`
- Lint is clean (run once here, the last code phase; if it reports unresolved `import.meta.env` types, delete `node_modules/.cache/eslint/` and rerun per `lessons.md`): `npm run lint`
- Astro check passes: `npx astro check`
- Whole suite and types stay green: `npx vitest run` and `npx tsc --noEmit`

#### Manual Verification:

- The actual `error-codes` returned for the `2x…AA`, `3x…AA` and made-up secrets were read and are recorded in Migration Notes

---

## Phase 3: Runtime proof through the real route

### Overview

Rerun the route in `wrangler dev` with three secret configurations and compare the console output with a baseline taken before this change, so the new lines are observed, not inferred.

### Changes Required:

#### 1. The probe script

**Location**: isolated worktree `.claude/worktrees/agent-a992330e2542a0e09`, untracked, nothing committed from it

**Intent**: Exercise `POST /api/links` the way production does, with a form carrying the dummy token, once per secret configuration.

**Contract**: a new script `probe/turnstile.mjs` that boots `wrangler dev -c dist/server/wrangler.json` (as `probe/suite.mjs` does) three times with `TURNSTILE_SECRET_KEY` set to Cloudflare's always-fail dummy secret, to its spent-token dummy secret, and unset; posts the form with the dummy token and the app's `Origin`; records the HTTP status, the `Location` header and the console output per scenario into `probe/out-turnstile/results.json`. The failing scenarios never reach the database, so no Supabase is needed and no link is created. The baseline is taken first, at the commit just before this change's phase 1 (`git checkout --detach <sha>`), then the worktree is moved to this change's final commit and the script reruns. The `wrangler`/`workerd` processes are stopped by port afterwards (`lessons.md`).

#### 2. The verify report

**File**: `context/audits/observability/<date>_verify-turnstile-failure-visibility.md`

**Intent**: Record the before/after table next to the audit that raised F2.

**Contract**: produced by `/10x-observability-audit --verify context/audits/observability/2026-10-02_timer-delete-link-grid.md` (new file; the original report is not edited), narrowed to the Turnstile finding.

### Success Criteria:

#### Automated Verification:

- The script runs on both commits and writes `probe/out-turnstile/results.json` for each: `node probe/turnstile.mjs`
- For all three scenarios the HTTP status and `Location` header after the change equal the baseline's (`303` to `/?error=verify`)
- After the change the always-fail scenario logs a `turnstile_rejected` line carrying a rejection code, the spent-token scenario a `turnstile_rejected` line carrying `timeout-or-duplicate`, and the unset-secret scenario a `turnstile_secret_missing` line; the baseline has none of these
- No line containing `"event":"turnstile_` contains the dummy token or any secret string
- No process is left listening on the probe ports

#### Manual Verification:

- The before/after table was read and the three scenarios are visibly told apart in the logs
- A `mode: verify` report with the table is written under `context/audits/observability/` and the original report is untouched

---

## Testing Strategy

### Unit Tests:

- Every verdict reason and its log event and level; Cloudflare codes mapped to the right level; fail-closed (only `success === true` is `ok`); no token, secret or IP in any line.
- The route: every refusal redirects to `/?error=verify` and creates nothing; `ok` proceeds; cookie shortcut and kill switch bypass the verifier.

### Integration Tests:

- Opt-in live test of the real `siteverify` with the dummy secrets (`TURNSTILE_LIVE=1`), not in the default suite or CI.

### Manual Testing Steps:

1. With the always-pass dummy keys in `.dev.vars`, create a link from the landing page in a browser and confirm sign-up still works and writes no `turnstile_*` line.
2. Swap in the always-fail secret and confirm the landing page shows the same banner as before and one `turnstile_rejected` line appears.
3. Unset the secret and confirm the same banner and one `turnstile_secret_missing` line.

## Performance Considerations

No work on the success path beyond reading `error-codes` on a rejection. A refusal writes one short JSON line; the volume is steerable by anonymous POSTs (accepted by the logging decision, and each such request is already an invocation in Workers Logs).

## Migration Notes

None for data or deploy. A saved Workers Logs query on the old `turnstile_verify_failed` event must move to `turnstile_unavailable`. What the real `siteverify` returned for Cloudflare's dummy secrets and the dummy token `XXXX.DUMMY.TOKEN.XXXX` (observed 2026-10-02, phase 2):

| Secret                                | HTTP    | `success` | `error-codes`                         | Verdict and log level |
| ------------------------------------- | ------- | --------- | ------------------------------------- | --------------------- |
| `1x…AA` (always passes)               | 200     | `true`    | `[]` (plus `hostname: "example.com"`) | `ok`, no log          |
| `2x…AA` (always fails)                | 200     | `false`   | `["invalid-input-response"]`          | `rejected`, warn      |
| `3x…AA` (token already spent)         | 200     | `false`   | `["timeout-or-duplicate"]`            | `rejected`, warn      |
| a secret Cloudflare does not know     | **400** | `false`   | `["invalid-input-secret"]`            | `rejected`, error     |
| no or empty secret (never sent by us) | **400** | `false`   | `["missing-input-secret"]`            | `rejected`, error     |

The two HTTP 400 rows corrected the phase 1 design: a wrong or missing secret arrives as a non-2xx answer with the verdict in the body, so the verifier reads the body before the status decides (commit `8a4d351`). Only a non-2xx answer without a spelled-out refusal is `unavailable`.

## References

- Frame: `context/changes/turnstile-failure-visibility/frame.md`
- Audit: `context/audits/observability/2026-10-02_timer-delete-link-grid.md` (F2), `2026-10-02_verify-fix-silent-error-logging.md`
- Fail-closed decision: `context/archive/2026-09-21-private-link-access/plan.md:55,156,164`, `plan-brief.md:55`
- Cloudflare Turnstile docs: server-side validation (`error-codes`, 300-second single-use tokens, response shape), testing (dummy keys and token), client-side error codes (`110200` domain not authorized)
- Route-test pattern: `src/__tests__/timer-routes.test.ts`; logger: `src/lib/log.ts`; integration gating: `src/test/integration-db.ts`, `vitest.integration.config.ts`
- Probe harness: `.claude/worktrees/agent-a992330e2542a0e09/probe/` (`suite.mjs`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Verdict with a reason, logs, and the route

#### Automated

- [x] 1.1 Verifier and route tests pass: `npx vitest run src/lib/turnstile.test.ts src/__tests__/links-route.test.ts` — b0c38d5
- [x] 1.2 Whole suite stays green: `npx vitest run` — b0c38d5
- [x] 1.3 Type checking passes: `npx tsc --noEmit` — b0c38d5
- [x] 1.4 Changed files lint clean: `npx eslint src/lib/turnstile.ts src/lib/turnstile.test.ts src/pages/api/links.ts src/__tests__/links-route.test.ts` — b0c38d5
- [x] 1.5 Deliberate break: a missing secret returning `{ ok: true }` turns a `turnstile.test.ts` case red and a route that ignores the verdict turns the `links-route.test.ts` refusal case red; both edits are reverted — b0c38d5

### Phase 2: Opt-in test against the real Cloudflare siteverify

#### Automated

- [x] 2.1 Live test passes against Cloudflare: `TURNSTILE_LIVE=1 npx vitest run --config vitest.integration.config.ts src/lib/turnstile.integration.test.ts` — 1f718d2
- [x] 2.2 Without the variable the suite is skipped, with the reason in its title, and does not fail — 1f718d2
- [x] 2.3 Lint is clean: `npm run lint` — 1f718d2
- [x] 2.4 Astro check passes: `npx astro check` — 1f718d2
- [x] 2.5 Whole suite and types stay green: `npx vitest run` and `npx tsc --noEmit` — 1f718d2

#### Manual

- [x] 2.6 The actual `error-codes` returned for the `2x…AA`, `3x…AA` and made-up secrets were read and are recorded in Migration Notes — 1f718d2

### Phase 3: Runtime proof through the real route

#### Automated

- [x] 3.1 The script runs on both commits and writes `probe/out-turnstile/results.json` for each: `node probe/turnstile.mjs` — 9e58afc
- [x] 3.2 For all three scenarios the HTTP status and `Location` header after the change equal the baseline's — 9e58afc
- [x] 3.3 After the change the three scenarios log `turnstile_rejected` with a rejection code, `turnstile_rejected` with `timeout-or-duplicate`, and `turnstile_secret_missing` respectively; the baseline has none of these — 9e58afc
- [x] 3.4 No line containing `"event":"turnstile_` contains the dummy token or any secret string — 9e58afc
- [x] 3.5 No process is left listening on the probe ports — 9e58afc

#### Manual

- [x] 3.6 The before/after table was read and the three scenarios are visibly told apart in the logs — 9e58afc
- [x] 3.7 A `mode: verify` report with the table is written under `context/audits/observability/` and the original report is untouched — 9e58afc
