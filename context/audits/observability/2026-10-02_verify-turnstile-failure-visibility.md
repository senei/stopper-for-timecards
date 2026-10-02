---
type: observability-audit
date: 2026-10-02 14:50
mode: verify
commit: 1f718d2
branch: main
dirty_tree: true
areas: [link-create-and-regenerate]
area_source: arguments
runtime_proof: observed
error_tracker: none (Cloudflare Workers Logs via console only; wrangler.jsonc:12)
previous_report: context/audits/observability/2026-10-02_timer-delete-link-grid.md
findings: { critical: 0, high: 4, medium: 11, low: 5 }
---

# Observability audit, verify — turnstile-failure-visibility (2026-10-02)

Checks finding **F2** of `2026-10-02_timer-delete-link-grid.md` against the code at `1f718d2` (`context/changes/turnstile-failure-visibility`, phases 1 and 2). `findings` above counts what is still open across the whole original report: the one critical finding is closed. Nothing in the application was changed by this run.

## 1. TL;DR

- **The four ways a sign-up can be refused are now told apart in the logs.** A refused check, a spent token, an unset secret and a secret Cloudflare does not know each leave a distinct line (observed in `wrangler dev`, real `siteverify`); before, all four left nothing.
- **The visitor sees exactly what they saw before.** All four scenarios answer `303 → /?error=verify`, identical to the baseline, so fail-closed is untouched and no new copy exists.
- **The live test caught a design flaw the unit tests could not.** Cloudflare answers an unknown or missing secret with HTTP 400 and the verdict in the body; the first version of the verifier treated every non-2xx as "unavailable" and lost the code. Fixed in `8a4d351` and covered by 9 new cases.
- **No log line contains the token or a secret** (4 scenarios, script check plus an independent grep).
- **Still open, deliberately out of scope:** the visitor-facing message is still one generic banner, and the widget still has no `data-callback` / `data-error-callback`, so a blocked or expired widget is only visible as `turnstile_missing_token`.

## 2. Capture model

Unchanged from the original report except for Turnstile: `src/lib/turnstile.ts` now returns `{ ok: true }` or `{ ok: false, reason, errorCodes? }` and logs every refusal through `src/lib/log.ts` (`route: "lib/turnstile"`); `src/pages/api/links.ts:39-42` continues only on `ok`. Levels follow who can act: `error` when the operator must fix something (`turnstile_secret_missing`, `turnstile_unavailable`, `turnstile_bad_response`, and a `turnstile_rejected` whose codes include `missing-input-secret`, `invalid-input-secret`, `bad-request` or `internal-error`), `warn` when a visitor was refused (`turnstile_missing_token`, `turnstile_rejected` for `invalid-input-response`, `timeout-or-duplicate`, `missing-input-response`).

**Assumptions (unconfirmed, outside the repo):** Workers Logs parse JSON log lines into fields; whether production is misconfigured right now (the new logs are how that gets answered).

## 3. What reaches the logs: before and after

Real route `POST /api/links` under `wrangler dev` on a production build, with the form carrying Cloudflare's dummy token and the real `siteverify` called with Cloudflare's documented dummy secrets. "Before" is the code at `6231ebc`, "after" is `1f718d2`. The failing scenarios end before the database, so no link was created.

| Scenario               | Secret         | HTTP and Location (before → after) | Log before | Log after                                                                                                   | Verdict              |
| ---------------------- | -------------- | ---------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------- | -------------------- |
| always-fail            | `2x…AA`        | 303 `/?error=verify` → same        | nothing    | `warn` `turnstile_rejected`, `detail: invalid-input-response`                                               | **blind → readable** |
| spent-token            | `3x…AA`        | 303 `/?error=verify` → same        | nothing    | `warn` `turnstile_rejected`, `detail: timeout-or-duplicate`                                                 | **blind → readable** |
| secret-unset           | not configured | 303 `/?error=verify` → same        | nothing    | `error` `turnstile_secret_missing`: "TURNSTILE_SECRET_KEY is not set; every sign-up is refused until it is" | **blind → readable** |
| unknown-secret (extra) | made-up string | 303 `/?error=verify` → same        | nothing    | `error` `turnstile_rejected`, `detail: invalid-input-secret`                                                | **blind → readable** |

Raw data: `probe/out-turnstile-before/results.json`, `probe/out-turnstile-after/results.json` and the per-scenario `.log` files in the harness worktree.

## 4. Systemic root causes

| Root cause (original report §4)                         | Status                                                                                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5. Expected and unexpected outcomes share a silent path | **Fixed for Turnstile**: every refusal now carries a reason and a log line. Still open for the `closed` / `busy` / `full` outcomes and the `access_log` fail-open. |

## 5. Findings by area

| Finding                                         | Status                                                                                                                           | Evidence                                                                                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| F2 Turnstile collapses every failure to `false` | **fixed (operator visibility)**                                                                                                  | the four scenarios above (observed); `turnstile.test.ts` (35 cases), `links-route.test.ts` (15), `turnstile.integration.test.ts` (4, real Cloudflare) |
| F2 widget half (no error/expired callback)      | **still open, by decision**                                                                                                      | frame and plan keep the widget unchanged; `turnstile_missing_token` is the only trace of a blocked widget                                             |
| F15 optional secrets with no signal             | **partly fixed** for the Turnstile secret only (`turnstile_secret_missing`); the Supabase secrets and the site key are untouched | scenario secret-unset                                                                                                                                 |
| All other findings                              | unchanged, see `2026-10-02_verify-fix-silent-error-logging.md`                                                                   |                                                                                                                                                       |

## 6. Recommended fix order (what remains)

1. **Boundary and pages** (F3, F13): the separate change `page-error-boundary` (R9 / R10 are still the only probed rows that did not improve).
2. **`access_log` and lifecycle events** (F10, F9): log when the admin client is null, a distinct rotation outcome, a delete-account event, and one event per `closed` / `busy` / `full`.
3. **Purge worker** (F20–F22).
4. **Optional, from this change's evidence:** if `turnstile_missing_token` shows up in real traffic, add the widget callbacks; the log is now the evidence for that decision.

## 7. Changes since last audit

See §5; this report is a verify run against `2026-10-02_timer-delete-link-grid.md`, narrowed to F2.

## 8. Method and limits

- **Run:** `node probe/turnstile.mjs --label before` with the worktree `.claude/worktrees/agent-a992330e2542a0e09` detached at `6231ebc`, then `--label after` at `1f718d2` (the same script, a fresh `astro build` and a fresh `wrangler dev` process on its own port for each of the four scenarios). The comparison reads `results.json` of both runs; the leak check greps the `"event":"turnstile_` lines for the dummy token and every secret, and the script's own flag agrees.
- **Not probed:** the `unavailable` (network error, timeout, non-2xx without a verdict) and `bad_response` paths, and the empty-token path: they cannot be produced against the real endpoint without fault injection and are covered by unit tests with a mocked `fetch`. A real production secret, hostname and site key were not exercised; only Cloudflare's dummy keys.
- **Not verifiable here:** production Workers Logs (JSON parsing into fields, retention), and whether production is misconfigured now.
- **Cleanup:** after the runs no process was listening on ports 8811–8814. The worktree is left in place at `1f718d2`; `probe/turnstile.mjs` and its output directories are untracked there.
