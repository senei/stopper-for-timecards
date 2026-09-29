---
date: 2026-09-29T12:45:00+02:00
researcher: senei web
git_commit: 9feba16b4aa6218910c2bd9b00db0d71327de7ca
branch: main
repository: stopper-for-timecards
topic: "Oracle and coverage gaps for link leak / regeneration guardrails (test-plan §3 Phase 3, risk #4)"
tags: [research, testing, private-link, regeneration, isolation, oracle]
status: complete
last_updated: 2026-09-29
last_updated_by: senei web
---

# Research: Link leak & regeneration guardrails — oracle and coverage gaps

**Date**: 2026-09-29T12:45:00+02:00
**Researcher**: senei web
**Git Commit**: 9feba16 (S-07 is on `main` as merge `cb5c1c6`, so this research reads merged code, not a branch)
**Branch**: main
**Repository**: stopper-for-timecards

## Research Question

For risk #4 in `context/foundation/test-plan.md` §2 ("a private link is leaked or forwarded, exposing or letting someone impersonate another person"): what must a test prove (the oracle, taken from sources), what already protects it, and what is left uncovered? Scope: link lookup and regeneration, the cookie, cross-person isolation and the leak surface. Delete-account (risk #6) is a separate change.

## Summary

1. **S-07 is built and merged, so tests can target real code.** `regenerate_link` (SQL), `regenerateLink` and `findLinkByToken` (`src/lib/links.ts:32-75`), the API route and confirm page all exist on `main`.
2. **The oracle is short and settled for the core behavior.** After regeneration the old token must stop working immediately, the new token must land in the same workspace (same projects, entries), and nobody else is affected (`prd.md` FR-007 and Access Control; roadmap S-07; `parallel-goals.md` Lane 2; test-plan §2 risk #4). The PRD is silent on what the old URL returns (the plans say 404), on stale cookies, and on someone other than the owner regenerating a leaked link.
3. **Much of the SQL and HTTP behavior is already protected.** pgTAP covers the swap (`regenerate_link.test.sql`, 12 assertions). CI smoke covers the HTTP flow (old token 404, new token opens the same workspace, links row count unchanged, another person's link still works). What is not tested against a real database is the TypeScript layer: `findLinkByToken`, `regenerateLink`, and the `link_id` scoping in `projects.ts` and `timer.ts`.
4. **One existing "isolation" test tests a copy, not the code.** `delete_project.test.sql:64-80` runs a hand-written `delete ... where link_id = ...` in SQL, so removing `.eq("link_id", linkId)` from `deleteProject` (`src/lib/projects.ts:87`) would not fail it.
5. **No defects found in the paths inspected** (the migration, `links.ts`, the regenerate route and page, `link-cookie.ts`, the workspace page, and the scoped queries listed under Code References); they behave as the plan describes. The gaps below are unprotected behavior, not bugs.

## Detailed Findings

### Oracle (from sources, not from code)

- **Regeneration invalidates the old link, others unaffected**: `prd.md:78-79` (FR-007 and its Socrates note: regeneration lets "the affected person alone" invalidate a suspected leak, "without touching anyone else's link") and `prd.md:102` (Access Control: "invalidates the old one without affecting anyone else's access").
- **Old token stops working immediately; new token reaches the same workspace**: roadmap S-07 ("old link stops working immediately", `context/foundation/roadmap.md`, S-07 block) and `context/foundation/parallel-goals.md:119-125` (Lane 2: old token 404 through `findLinkByToken`, new token lands in the same workspace with projects and entries intact).
- **No grace window**: test-plan §2 Risk Response Guidance row #4. The PRD itself does not say "no grace window"; it says "invalidates".
- **Isolation**: `prd.md:102` ("sees only their own weekly table, never anyone else's") and `prd.md:90` (access restricted to holders of a valid private link; "no coworker can see another coworker's data").
- **Leak surface (headers)**: the team-accepted rule in `context/foundation/lessons.md:19` (use `Referrer-Policy: strict-origin`, never `no-referrer`, on pages with forms). That is a lesson, not a PRD requirement.

### What already protects the risk

| Behavior | Existing test | File |
|---|---|---|
| SQL swap: hash replaced in place, no new `links` row, projects and entries survive, bystander untouched, second regenerate with the old hash returns null, function privileges (`anon`/`authenticated` denied, `service_role` allowed) | pgTAP, 12 assertions | `supabase/tests/database/regenerate_link.test.sql:5-97` |
| HTTP flow: confirm page opens, regenerate redirects to a fresh token with `?status=link-regenerated`, old token 404, new token 200, row and entry counts survive, another person's link still 200, old token cannot regenerate again | CI smoke | `scripts/smoke.mjs:467-513` |
| Browser keeps its own remembered link when opening someone else's | CI smoke | `scripts/smoke.mjs:435` |
| Anon key reads no rows from `links`; access log has success and not_found rows | CI smoke | `scripts/smoke.mjs:445-456` |
| Token shape, hash, `isWellFormedToken` | unit | `src/lib/link-token.test.ts:1-54` |
| Weekly grid query is scoped to one link | integration | `src/lib/weekly-grid-query.integration.test.ts` (from the previous change) |
| Stopping one link's timer leaves another link's open entry alone | pgTAP | `supabase/tests/database/stop_timer.test.sql:83-94` |

### Gaps (each a candidate test; expected values come from the oracle)

| # | Gap | Oracle source | Layer |
|---|---|---|---|
| G1 | `findLinkByToken` and `regenerateLink` are never exercised as TypeScript against a real database. Cases: token resolves to the link id; an unknown well-formed token gives null; after `regenerateLink`, the old token gives null and the new token gives the same id; a second `regenerateLink(old)` returns `not_found`; a second person's token still resolves to their own id. The TS side computes the hashes (`hashToken`, `src/lib/link-token.ts:14-17`), which pgTAP cannot see. | PRD FR-007; roadmap S-07 | opt-in integration (`npm run test:integration`) |
| G2 | Ownership scoping in the real TS functions: `listProjects` (`projects.ts:20-24`), `getProject` (`:52-60`), `deleteProject` (`:87`, returns `response.data.length > 0` at `:94`), `getCurrentTimer` (`timer.ts:123`). Current coverage for delete is a SQL copy (`delete_project.test.sql:64-80`). Cases with two people: A's list never contains B's project; `deleteProject(A, B's project id)` returns false and B's project survives; `getProject(A, B's id)` is null. | PRD Access Control (`prd.md:102`) | opt-in integration |
| G3 | The cookie: `setLinkCookie` flags (`httpOnly`, `sameSite: "lax"`, `path: "/"`, `secure` in production, one-year `maxAge`; `link-cookie.ts:10-18`) and `resolveCookieLink` (`:29-47`): no cookie gives null; malformed or unresolvable cookie is cleared and gives null; a resolvable one returns the token; a failing lookup returns null and leaves the cookie. No test exists for any of it. The oracle is the code comment at `:24-28`, not a PRD line, so these tests document current behavior and must say so. | code comment only (weak) | hermetic unit test with `findLinkByToken` mocked |
| G4 | Leak-surface headers `Referrer-Policy: strict-origin`, `Cache-Control: no-store`, `X-Robots-Tag: noindex` are set on four token pages (`[token].astro:16-18`, `grid.astro:18-20`, `regenerate.astro:10-12`, `projects/[projectId]/delete.astro:13-15`). Smoke asserts only the referrer policy on the workspace page (`smoke.mjs:131-132`), so dropping the headers on the other pages would fail nothing. | `lessons.md:19`; PRD FR-007 leak scenario | extend the HTTP smoke (cheapest) |
| G5 | Anon-key exposure of data tables: RLS is enabled on `links`, `access_log`, `time_entries`, `job_runs` (`20260921120000_private_links.sql:44-47`) and `projects` (`20260922150000_projects_and_timer.sql:31`), but among the smoke checks whose names I read, only one asserts anon reads, and it is for `links` (`smoke.mjs:456`). A real-database check as the `anon` role on `projects`, `time_entries`, `access_log` would prove the "no public access" line. | `prd.md:90` | pgTAP (asserts on real grants/RLS, not a copy of app code) |
| G6 | Regenerate writes access-log rows (`regenerate.ts:38,42,48`) that are not asserted anywhere. The PRD does not require it (the audit rationale is in `access-log.ts:5-14` and `infrastructure.md`), so this is a product decision before it is a test. | none in PRD | decision first |
| G7 | Browser-only paths: the confirm form posting under a real browser's `Origin` handling, and the cookie replacement after regeneration (`regenerate.ts:45`). The smoke script sets `Origin` itself, which is the blind spot behind risk #3. | lessons.md:19, test-plan risk #3 | e2e, deferred to test-plan §3 Phase 4 |

### Layer choice (cost × signal)

- G1 and G2: the logic is TypeScript calling the database, so the opt-in vitest integration harness from the previous change is the cheapest layer that sees the real code. pgTAP would test a copy for G2 and cannot see the TS hashing for G1.
- G5: pgTAP is the right layer, since the claim is about database grants and RLS themselves.
- G3: a hermetic test is enough because the only external call is `findLinkByToken`.
- G4: a few lines in the existing smoke run.
- No first-red-test exists, because no bug was found, so `/10x-tdd` is not a fit for any of these; use `/10x-implement`.

## Code References

- `src/lib/links.ts:32-52` — `regenerateLink` (hashes old and new token in TS, calls the RPC)
- `src/lib/links.ts:55-75` — `findLinkByToken`
- `src/lib/link-token.ts:4-21` — token generation, hash, shape check
- `src/lib/link-cookie.ts:10-47` — cookie set, clear and resolve
- `src/pages/w/[token].astro:20-52` — workspace: token check, lookup, `not_found` and `error` logging, cookie set only when the browser has none
- `src/pages/api/w/[token]/regenerate.ts:13-51` — regenerate route (POST only; re-derives the link from the URL token)
- `supabase/migrations/20260926120000_regenerate_link.sql` — swap function, `service_role`-only
- `src/lib/projects.ts:20-24,52-60,87-94` — `link_id`-scoped queries
- `scripts/smoke.mjs:435,456,467-513` — existing HTTP coverage

## Architecture Insights

- The token is the only credential: every route re-derives the link from the URL token via `findLinkByToken` and never trusts the cookie for authorization (`regenerate.ts` header comment; `link-cookie.ts:5`). Isolation between people therefore depends on `link_id` scoping in each query, which is the property G2 tests.
- The regenerate route authorizes by the URL token alone, like every other route. So whoever holds a link can regenerate it and lock the owner out, with no recovery path (no accounts). This follows from the PRD's model and is not a defect; see Open Questions.
- Local and remote conventions to reuse: opt-in integration harness (`vitest.integration.config.ts`, gated on `SUPABASE_URL` pointing at a local stack), deliberate-break checks, and the "documents the current decision" framing for decisions that are not in the PRD.

## Historical Context (from prior changes)

- `context/archive/2026-09-29-testing-weekly-grid-rounding-aggregation/` — the integration harness pattern and the "run the break-check with env vars actually set" lesson. Supported.
- `context/changes/link-regeneration/plan.md` (branch merged; folder still active) — plan decisions for the confirm step and cookie behavior; its `impl-review.md` recorded F2, the lockout observation, and its Progress rows 2.4-2.6 (browser check) are still unticked.
- `context/archive/2026-09-21-private-link-access/` — original link model (S-01).

## Related Research

- `context/archive/2026-09-29-testing-weekly-grid-rounding-aggregation/research.md` — same oracle-first method.

## Open Questions

1. **Lockout by a holder of a leaked link (user to decide).** The route authorizes by the URL token alone, so a holder can regenerate the link and the owner's link stops working. `prd.md:78-79` accepts the leak/forward scenario and offers regeneration as the mitigation, but does not say whether lockout is acceptable. Tests can assert "regenerating with a valid token works for whoever holds it" only if the user confirms that is intended.
2. **Old URL response.** The plans and test-plan say 404 with no grace window; the PRD says only "invalidates". Confirm 404 as the required response.
3. **Stale cookie after regeneration in another browser.** `resolveCookieLink` clears a cookie whose link no longer resolves (`link-cookie.ts:29-47`). This is a code-comment contract; confirm it as intended before writing tests for it (G3).
4. **Access log for regenerate (G6).** Should a regenerate attempt be a required audit event, or only best-effort? If required it belongs in the PRD or infrastructure notes first.
5. **Headers as a requirement (G4).** Confirm that `strict-origin`, `no-store` and `noindex` on all token pages are required behavior (they are a team lesson, not a PRD line).
6. **Sequencing.** G1, G2, G3, G4 can be planned now on `main`. G7 (browser) waits for test-plan Phase 4. Progress rows 2.4-2.6 of `link-regeneration` (manual browser check) are still unticked, so G7's manual counterpart has not been run by anyone.
