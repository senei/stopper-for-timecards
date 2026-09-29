---
change_id: testing-link-abuse-guardrails
title: Testing link leak and regeneration guardrails
status: new
created: 2026-09-29
updated: 2026-09-29
archived_at: null
---

## Notes

Test-plan §3 Phase 3, first half: risk #4 (a private link is leaked or forwarded, exposing or letting someone impersonate another person). Split from the delete-account half by decision on 2026-09-29; see `context/changes/testing-delete-account-guardrails/`.

Planning-agent findings (2026-09-29, unverified by research):
- S-07 (link-regeneration) is built but unmerged, on branch `link-regeneration` (worktree `../x10-dev--curse-link-regeneration`): migration `regenerate_link`, `regenerateLink` in `src/lib/links.ts`, API route and confirm page, its own pgTAP file (12 assertions). Nothing of it is on `main` yet.
- Already on `main`: `private_links.test.sql` (create_link cap), `link-token.test.ts` (token shape). Not covered anywhere: `findLinkByToken` against a real DB, wrong/foreign token rejection end to end, cookie behaviour (`src/lib/link-cookie.ts`).
- Likely layer: the opt-in vitest integration harness from `testing-weekly-grid-rounding-aggregation` (`npm run test:integration`, pattern `src/lib/weekly-grid-query.integration.test.ts`), because the lookup and swap live in TypeScript. pgTAP for `regenerate_link` already exists on the branch; do not repeat it. Browser paths (confirm page, stale cookie) belong to test-plan Phase 4 (e2e).
- Oracle sources: PRD FR-007 and Access Control, roadmap S-07 ("old link stops working immediately"), `context/foundation/parallel-goals.md` Lane 2.
- Not settled by the sources, to resolve in research (ask the user, do not guess): old URL 404 vs another response, grace window, stale cookie handling, whether leak mitigation also covers cache/referrer headers.
- Open question: wait for S-07 to merge, or research and plan against the `link-regeneration` branch. Both S-07 and S-10 branches change `[token].astro`, `WorkspaceCard.astro`, `status-messages.ts`, so expect merge conflicts.
- Lessons to apply: shared local Supabase stack per worktree lane; run the integration break-check with env vars set (a skipped run proves nothing).
- Oracle question from the link-regeneration impl review (2026-09-29): the regenerate route authorizes by the URL token alone, so whoever holds a leaked or forwarded link can regenerate it, and the owner's old link then stops working with no recovery path (no accounts). This follows from the PRD's model (a link is the sole identity; FR-007 accepted the forward/leak scenario), but the tests must state whether lockout is the accepted behavior, or whether the PRD needs a decision first. Ask the user during research; do not assume.
