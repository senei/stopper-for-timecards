<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Private Link Access Implementation Plan

- **Plan**: context/changes/private-link-access/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-09-22
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — No FK constraint from access_log.link_id / time_entries.link_id to links.id

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (data safety)
- **Location**: supabase/migrations/20260921120000_private_links.sql (new `links` table); referenced columns live in the prior migration `20260918082739_phase_b_c_purge_and_access_log.sql`
- **Detail**: Nothing in the schema stops an `access_log` or `time_entries` row from referencing a `link_id` that doesn't correspond to any row in `links`. The plan's migration contract didn't call for a foreign key either way. `time_entries` is explicitly commented in the prior migration as a placeholder pending rework by a later roadmap slice (S-02), so an FK there may be short-lived.
- **Fix A ⭐ Recommended**: Add `references links(id)` on `access_log.link_id` only, in a follow-up migration; leave `time_entries` alone until S-02 reworks its schema.
  - Strength: Closes the more permanent gap — `access_log` is finished schema for this change — without constraining a table already flagged for near-term replacement.
  - Tradeoff: `time_entries` stays unconstrained a while longer.
  - Confidence: MEDIUM — reasonable given `time_entries`'s documented placeholder status, but S-02's actual plan doesn't exist yet to confirm the timeline.
  - Blind spot: Haven't seen S-02's plan.
- **Fix B**: Add the FK on both `access_log.link_id` and `time_entries.link_id` now.
  - Strength: Closes the gap uniformly on both tables.
  - Tradeoff: The `time_entries` FK is plausibly throwaway work once S-02 reworks that table; `ON DELETE` behavior is undecided either way (moot today since links are never deleted, per the no-removal design).
  - Confidence: MEDIUM.
  - Blind spot: `ON DELETE` behavior undecided.
- **Decision**: FIXED via Fix A — `supabase/migrations/20260922100433_access_log_link_fk.sql` adds `access_log_link_id_fkey` (default `ON DELETE NO ACTION`, `time_entries` left alone). Two new pgTAP tests added; deliberate-break check confirmed the FK-rejection test goes red without the constraint. All gates re-verified green (db reset, 12/12 pgTAP, 20 unit tests, lint, astro check, build).

### F2 — Creation throttle isn't atomic with insert (independently confirmed, already an accepted tradeoff)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/links.ts:40-44 (countRecentLinks then createLink, no shared lock)
- **Detail**: A burst of concurrent requests can overshoot `THROTTLE_MAX_LINKS = 3` per window, since the count check and the insert aren't in the same transaction/lock. The safety-review sub-agent flagged this independently; the plan's own Implementation Approach section already named and accepted this exact race ("a race can overshoot by a link or two... accepted because the hard cap of 10 is atomic"). No new decision needed — recorded here so the independent confirmation is visible.
- **Fix**: No action. If stricter enforcement is ever wanted, fold the recent-count check into `create_link`'s existing advisory lock.
- **Decision**: PENDING

### F3 — Landing page doesn't set the same token-hygiene headers as the workspace/404 pages

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/index.astro (no Referrer-Policy/Cache-Control/X-Robots-Tag); compare src/pages/w/[token].astro and src/pages/404.astro, which set all three
- **Detail**: `index.astro` can `Astro.redirect` to a token-bearing `/w/<token>` URL when the visitor's cookie resolves. It never renders the token itself, and the exposure is limited to the `Location` header any redirect carries, but the other two token-adjacent pages are more defensive.
- **Fix**: Optionally add the same three headers to index.astro for consistency. Not required.
- **Decision**: PENDING

### F4 — Audit-log IP falls back to X-Forwarded-For, which is spoofable

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/access-log.ts:24 (falls back to x-forwarded-for when cf-connecting-ip is absent)
- **Detail**: The audit trail's IP can be spoofed if a request ever reaches the Worker without passing through Cloudflare's edge. Low impact since this IP is audit-only — the Turnstile check (the actual security-sensitive use of IP, in src/pages/api/links.ts) correctly uses only `cf-connecting-ip` with no XFF fallback.
- **Fix**: No action needed; awareness only.
- **Decision**: PENDING
