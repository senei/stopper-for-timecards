<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Private Link Access Implementation Plan

- **Plan**: context/changes/private-link-access/plan.md
- **Mode**: Deep (local verification, no sub-agent)
- **Date**: 2026-09-21
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 3 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | FAIL (all findings fixed) |

## Grounding

13/13 existing paths ✓, `locals.cfContext.waitUntil` present in @astrojs/cloudflare 14.3.1 ✓, blast radius clean (only files the plan removes use the auth code) ✓, brief↔plan ✓. `context/foundation/lessons.md` and `docs/reference/contract-surfaces.md` absent, skipped.

## Findings

### F1 — `npm run lint` is already failing on main, but three phases require it

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Success criteria 1.4, 2.1, 3.2 (and the CI `ci` job)
- **Detail**: CI `ci` job fails at lint on every push since 2026-09-18: prettier errors in `src/__tests__/example.test.ts` and `src/lib/access-log.ts`; `no-undef 'process'` and ~20 typed-lint errors in `scripts/smoke.mjs`. No phase repaired it.
- **Fix**: Add a first Phase 1 change making lint green on the baseline (prettier on the flagged files; ESLint override for `scripts/**/*.mjs`).
- **Decision**: FIXED — added as Phase 1 change 5 "Lint baseline repair"; Current State Analysis updated.

### F2 — Smoke job's auth steps already fail, so criterion 2.5 cannot pass in Phase 2

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §6 and criterion 2.5; Phase 3 §3
- **Detail**: CI smoke fails "signup creates account" (Error sending confirmation email) and "dashboard renders for signed-in user"; `supabase/config.toml` enables Resend SMTP with unset `RESEND_SMTP_PASS`.
- **Fix A ⭐ Recommended**: Remove the auth steps from smoke in Phase 2.
  - Strength: Phase 2's smoke criterion becomes passable.
  - Tradeoff: Old flow has no automated check for a phase, but it was already failing.
  - Confidence: HIGH — failure visible in the CI log.
  - Blind spot: None significant.
- **Fix B**: Keep the steps and skip them when signup is not configured.
  - Strength: Old flow stays covered where it works.
  - Tradeoff: Extra conditional code deleted one phase later.
  - Confidence: MEDIUM
  - Blind spot: Local Supabase behaviour with partial SMTP config.
- **Decision**: FIXED via Fix A — Phase 2 §6 now replaces the auth steps; Phase 3 §3 only adds the 404 steps.

### F3 — The rate limiter blocks the smoke test's cap-fill

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §3 (5 per 60s) vs §6
- **Detail**: Eleven creation POSTs from one IP in seconds exceed the enforced binding, so the "full" step would see `/?error=busy`.
- **Fix A ⭐ Recommended**: Fill 9 slots through the `create_link` rpc with the service-role key, then one HTTP creation and one expecting "full".
  - Strength: No test-only switch in production code; exercises the cap at its boundary.
  - Tradeoff: Slots 1–9 not created via HTTP; manual 2.10 also needs an SQL fill.
  - Confidence: HIGH
  - Blind spot: Needs service-role credentials.
- **Fix B**: `RATE_LIMIT_DISABLED` secret.
  - Strength: Whole cap flow stays HTTP-only.
  - Tradeoff: Bypass flag in production code.
  - Confidence: MEDIUM
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — Phase 2 §6 rewritten (four HTTP POSTs total, under the limit); criterion 2.10 reworded.

### F4 — "Non-blocking" access log has no mechanism on Workers

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Performance Considerations vs Phase 2 §5
- **Detail**: An un-awaited promise can be cancelled after the response returns on Workers, silently dropping audit rows.
- **Fix A ⭐ Recommended**: Await `logAccess` before rendering.
  - Strength: Row is guaranteed; simplest.
  - Tradeoff: One extra Supabase round trip per workspace load.
  - Confidence: HIGH
  - Blind spot: Edge-to-eu-west-1 latency unmeasured.
- **Fix B**: `cfContext.waitUntil` with a guarded fallback.
  - Strength: No added latency.
  - Tradeoff: Absent in dev/tests.
  - Confidence: MEDIUM
  - Blind spot: `waitUntil` under `astro preview`.
- **Decision**: FIXED via Fix A — §5 awaits `logAccess`; Performance Considerations reworded.

### F5 — Landing page behaviour when the cookie lookup errors is unspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §4
- **Detail**: `findLinkByToken` throws on database errors; the plan did not say what `/` does.
- **Fix**: Render the create form without redirecting or clearing the cookie.
- **Decision**: FIXED — added to Phase 2 §4.

### F6 — Database tests need a running local stack and pgTAP

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 criteria 1.1–1.2, Testing Strategy
- **Detail**: `supabase db reset` and `supabase test db` need `npx supabase start` and Docker; no pgTAP reference exists in the repo.
- **Fix**: State the precondition and have the test file enable pgTAP itself.
- **Decision**: FIXED — Phase 1 Overview precondition and test-file contract updated.

## Addendum (2026-09-21, after triage)

The rate-limit mechanism was replaced after this review: the Workers Rate Limiting binding was dropped in favour of a Turnstile bot check plus a database-backed creation throttle (at most 3 links in any 10 minutes). F3's Fix A still applies in spirit: the smoke test fills slots through the `create_link` database function, and it now also exercises the throttle (expects "busy" with nine fresh links, then backdates `created_at` before creating the 10th). References above to "5 per 60 seconds" are superseded by plan.md.

A close-registration switch (`LINK_CREATION_CLOSED` secret) was added afterwards to address the slow-drip gap the throttle leaves; a per-IP creation limit and idle-slot reclaim were declined.
