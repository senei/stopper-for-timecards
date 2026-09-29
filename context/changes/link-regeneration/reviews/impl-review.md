<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Regenerate own private link (S-07)

- **Plan**: context/changes/link-regeneration/plan.md
- **Scope**: Full plan (3 of 3 phases, code reviewed)
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-09-29
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

Method: reviewed inline by the main agent (no sub-agents). Read the migration, `regenerateLink` in `src/lib/links.ts`, the API route, the confirm page, the `WorkspaceCard.astro` diff, the smoke steps and the plan's Not-Doing list. Scope note: Progress rows 2.4-2.6 and 3.1 are still unticked, so phases 2 and 3 are not fully ticked; their code exists and was reviewed, and the unticked rows are reported as F1. Automated evidence: PR #14 CI is green on 992c7a2 (`ci`: lint, `astro check`, `npx vitest run`, build; `smoke`: `supabase test db` incl. `regenerate_link.test.sql`, and the regenerate smoke flow). The 13 changed files match the plan's file list exactly (migration, pgTAP file, `links.ts`, `status-messages.ts`, confirm page, API route, `WorkspaceCard.astro`, smoke) plus the expected roadmap status edit; `src/pages/w/[token].astro` is untouched, as the plan requires.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — Four Progress rows are still unticked and change.md is `implementing`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/link-regeneration/plan.md:413-415, 421 (rows 2.4, 2.5, 2.6, 3.1)
- **Detail**: Rows 2.4 (regenerate from the UI lands on a new URL with a banner, same projects and timer), 2.5 (old URL 404s), 2.6 (a second workspace's link is unaffected) are manual and unticked. Row 3.1 (`npm run smoke:local` passes) is unticked too. CI's `smoke` job now runs the same regenerate steps and passes (old token 404s, other person's link still works, project and entry counts survive), which covers the substance of 2.5, 2.6 and 3.1, but the banner and the visual flow in 2.4 have not been checked by a person. The phase 3 smoke check also had a bug (it rejected the `?status=link-regenerated` redirect) that only CI found, fixed in 992c7a2.
- **Fix**: Do the browser check for 2.4-2.6 (open a workspace, click Regenerate, confirm, check the banner and that the old URL 404s), tick the rows on your confirmation, and tick 3.1 citing the green CI `smoke` run.
- **Decision**: DEFERRED (Fix differently) — the user will do the browser check for rows 2.4-2.6 and confirm; rows stay unticked until then, and 3.1 can be ticked citing the green CI smoke run

### F2 — Whoever holds a link can regenerate it and lock the owner out

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/w/[token]/regenerate.ts:13-43
- **Detail**: The route authorizes only by the URL token, as every route here does (`findLinkByToken`, cookie never trusted). That means a person who received a leaked or forwarded link can regenerate it: the new token goes only to them and the owner's old link stops working, with no recovery path (no accounts, no email). This follows from the PRD's model (a link is the sole identity, FR-007's forward/leak scenario was accepted) and is not a defect in this slice, but it changes what "regeneration mitigates a leak" means: it mitigates it only if the owner acts first.
- **Fix**: No code change in this slice. Record it as an oracle question for `testing-link-abuse-guardrails` (does the PRD accept lockout as the cost of leak/forward?), so the tests state the accepted behavior rather than assume it.
- **Decision**: FIXED via Fix now — recorded as an oracle question in context/changes/testing-link-abuse-guardrails/change.md; no code change in this slice
