---
project: "Stopper for Timecards"
version: 1
status: draft
created: 2026-09-28
---

# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-09-28

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in area Y"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/`,
`scripts/`, `workers/` (main hand-written codebase roots; `node_modules`,
`dist`, `build`, `.astro`, `.wrangler` excluded).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | Time gets logged against the wrong project | High | High | PRD Guardrails ("project association must be correct — time logged against the wrong project defeats the entire purpose"); interview Q1 (top named worry); hot-spot dir `src/lib/` (43 commits/30d) |
| 2 | A timer switch or stop silently drops or double-counts a segment | High | High | PRD Guardrails (15-minute precision) + Success Criteria ("switch between projects... with time correctly allocated"); interview Q1 and Q3 (timer logic named as the area changed without confidence); hot-spot dir `src/lib/` (43 commits/30d) |
| 3 | A real-browser-only failure (forms, redirects, cookies) ships because automated checks can't see it | High | High | Interview Q2 — confirmed past incident (a `Referrer-Policy: no-referrer` page broke real-browser form submission with a 403 while the HTTP smoke script, which sets `Origin` itself, passed clean; recorded in `context/foundation/lessons.md`); interview Q4 (named as the scariest current gap) |
| 4 | A private link is leaked or forwarded, exposing or letting someone impersonate another person | High | Medium | PRD FR-007 Socrates note (explicit leak/forward scenario considered and accepted as a real threat); PRD Access Control section (a link is the sole identity — no accounts, no passwords) |
| 5 | The weekly grid shows wrong per-day rounded totals or the wrong Mon–Sun boundary | High | Medium | PRD Guardrails (15-minute precision) + roadmap S-06 (still `proposed`, with an explicitly open Mon–Sun timezone question); prior risk log (superseded) flagged the same rounding-precision concern |
| 6 | The irreversible full-account delete fires with the wrong scope, or without a real confirmation step | High | Low | PRD FR-010 Socrates note ("fully irreversible... one accidental confirm permanently locks someone out and destroys their history"); roadmap S-10 risk note ("the one mistake in this codebase with no undo path at all") |

**Impact × Likelihood rubric** — High/Medium/Low, scored coarsely so two
readers agree on the same row (see `references/test-plan-schema.md` §2 in
the `10x-test-plan` skill for the full rubric text).

Risks #1–#3 are High × High and protected first. #4 and #5 are High ×
Medium. #6 is High × Low but kept in the top set on explicit PRD/roadmap
signal: it is a single, fully irreversible, no-recovery action, which the
product's own authors singled out as the highest-consequence click in the
app — this is a testable behavior with a defined intended outcome (FR-010),
not a cloud-outage scenario that belongs to observability instead.

**Abuse / security lens.** This product has no accounts, but a private
link *is* the credential. Risk #4 is the abuse-lens row: it is framed
around leak/forward (the threat PRD FR-007 itself names), not brute-force
guessing, since token unguessability alone does not address a forwarded or
copy-pasted link.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | Every timer segment attributes to exactly the project the caller named (new project, reused project, case variations) | "The FK on `project_id` guarantees correct attribution" — a foreign key only proves the id exists, not that it's the *right* id | The project resolution/upsert-by-name entry point and whether name matching is case-insensitive/trimmed consistently | integration (database-level) | Asserting against whatever project id the implementation happens to resolve to, instead of an independently-named expected project (oracle problem) |
| #2 | A start→switch→switch→stop sequence produces time-entry rows whose durations sum losslessly to elapsed wall-clock time, with no gap and no overlap | "The one-open-timer-per-link constraint guarantees segments don't overlap" — that index blocks two *open* rows, it says nothing about whether a switch correctly closes the prior segment before opening the next, or what a partial failure mid-switch leaves behind | The exact write sequence performed on switch (close-then-open vs. one transaction) and how a partial failure is handled | integration | Checking only total durations without checking segment boundary timestamps; copying the current implementation's own rounding as the expected value |
| #3 | A real browser can complete open-link → start → switch → stop through actual UI interaction (forms, navigation, cookies), not just HTTP requests | "The HTTP smoke script passing means the browser flow works" — it sets `Origin` itself, which is exactly what hid the shipped Referrer-Policy bug | Which pages/forms are in scope for the flow, and how a browser-driven test authenticates via the link token | e2e (real browser context) — no cheaper layer sees this failure class | An e2e test that also manually sets headers/origin, reproducing the same blind spot the smoke script has today |
| #4 | Holding another person's link is the only way to see their data; regenerating a link invalidates the old one immediately, with no grace window | "An unguessable token means leakage doesn't matter" — PRD FR-007 explicitly treats forwarding/leaking, not brute-forcing, as the real threat | Token generation/lookup path; whether any response ever surfaces another user's identifiers; the regeneration invalidation mechanism once S-07 ships | integration now; e2e once link regeneration (S-07) ships | Only testing that a *valid* link works, never that an invalidated or another person's link is rejected |
| #5 | Given a set of raw start/switch/stop timestamps, the produced grid shows correct per-day rounded-up totals, laid out in the exact Project/Task/Type/Work Type × Mon–Sun shape | "Rounding each segment and summing equals rounding the daily total" — the resolved rule is per-day rounding, not per-segment; per-segment rounding silently overstates hours | The resolved Mon–Sun timezone boundary (currently an open roadmap question) and the per-day aggregation entry point once S-06 is planned | unit (rounding/aggregation function) + integration (grid assembly from real rows) | Hardcoding expected grid values by reading them off a manual run of the code under test, instead of computing them independently from raw timestamps and the written-down rounding rule |
| #6 | Delete-all removes exactly — all and only — the requesting person's projects, time entries, and link; the action cannot fire without the confirmation step succeeding | "A 200 response means deletion succeeded and was correctly scoped" — must verify no other user's rows were touched, not only that the caller's rows are gone | The confirmation UX once decided, and the exact deletion scope/transaction once S-10 is planned | integration (seeded multi-user fixture) + one e2e path for the confirmation UX | Testing deletion against a single-user fixture, where "no rows left" cannot distinguish correct scoping from an accidental delete-everything bug |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Timer precision & attribution regression guard | Harden the two guardrail risks the team trusts least, extending existing db coverage with deliberate-break checks | #1, #2 | integration | complete | `context/changes/testing-timer-guardrails/` |
| 2 | Real-browser flow coverage | Bootstrap a real-browser (e2e) layer to close the proven blind spot that HTTP-only smoke checks can't see | #3 | e2e | not started | — |
| 3 | Weekly grid rounding & aggregation | Build the test oracle for the still-unbuilt weekly grid (S-06) before/alongside its implementation | #5 | unit + integration | not started | — |
| 4 | Irreversible-action & link-abuse guardrails | Cover irreversible full-account delete (S-10) and link leak/regeneration (S-07) before/alongside those slices | #6, #4 | integration + e2e | not started | — |

Order rationale: Phase 1 protects the highest-ranked risks first at the
cheapest incremental cost (existing pgTAP coverage already exists to
extend). Phase 2 is the most evidence-backed gap (an incident that already
shipped) and builds infrastructure every later e2e need reuses. Phases 3–4
are sequenced to land alongside their still-`proposed` roadmap slices
(S-06, then S-10/S-07), so tests exist before or with the code rather than
trailing it. No AI-native phase is included — the interview (Q5) explicitly
excluded visual/styling test budget, and nothing else in the risk map
clears cost × signal for a vision-review layer.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit | Vitest | ^5.0.1 | `src/lib/*.test.ts`, `src/__tests__/`; happy-dom env |
| integration (database) | pgTAP via `supabase test db` | Supabase CLI ^2.23.4 | `supabase/tests/database/`; runs against a real local Postgres, no mocking |
| HTTP smoke | custom Node script (`scripts/smoke.mjs`) | n/a | exercises the deployed preview over HTTP; sets its own `Origin` header — this is the known blind spot behind Risk #3 |
| e2e (real browser) | none yet — see §3 Phase 2 | n/a | category example: Playwright; final choice is `/10x-research`'s job for that phase |
| lint + typecheck | ESLint (type-aware) + `astro check` | eslint ^10.10.0 | already wired in CI |

**Stack grounding tools (current session):**
- Docs: none available in current session; checked: 2026-09-28
- Search: WebSearch tool available, not used for this write (no stack-choice question needed it); checked: 2026-09-28
- Runtime/browser: no Playwright/browser-test MCP exposed in this session; checked: 2026-09-28
- Provider/platform: Cloudflare MCP available (`mcp__cloudflare__authenticate`) — relevant to the Workers/Pages deploy target if a future gate needs log/deploy inspection; not used yet; checked: 2026-09-28

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint + typecheck | local + CI (`ci.yml`) | required | syntactic / type drift |
| unit + integration (Vitest + pgTAP) | local + CI (`ci.yml`) | required | logic and data-integrity regressions |
| pre-prod HTTP smoke | CI, against built preview (`ci.yml` `smoke` job) | required | environment/deploy-specific failures reachable over HTTP |
| e2e on critical flows (real browser) | CI on PR | required after §3 Phase 2 | browser-only failures (forms, redirects, cookies) that HTTP smoke cannot see |
| post-edit hook | local (agent loop) | recommended | regressions at edit time — configured in Lesson 3, not this lesson |
| multimodal visual review | CI on PR | not planned | excluded — interview Q5 declined visual/styling test budget |
| visual diff (deterministic) | CI on PR | not planned | same exclusion as above |

## 6. Cookbook Patterns

How to add new tests in this project. Patterns that already exist in the
codebase are documented now; patterns the rollout will add read "TBD — see
§3 Phase N" until that phase ships.

### 6.1 Adding a unit test

- **Location**: `src/lib/` next to the module under test, or `src/__tests__/` for cross-cutting cases.
- **Naming**: `<module>.test.ts`.
- **Reference test**: `src/lib/project-name.test.ts`.
- **Run locally**: `npm test` (or `npx vitest run <path>` for a single file).

### 6.2 Adding a database integration test

- **Location**: `supabase/tests/database/`.
- **Policy**: pgTAP tests run against a real local Postgres via the Supabase CLI — no mocking; assert directly on rows and constraints.
- **Reference test**: `supabase/tests/database/projects_and_timer.test.sql`.
- **Run locally**: `npx supabase test db` (matches the CI `smoke` job).
- **Deliberate-break pattern**: when a guardrail is a DB constraint (a unique index, a partial index), don't just call the RPC that's supposed to trip it — prove the constraint itself is the backstop by bypassing the RPC with a direct `insert`/`update` and asserting the resulting SQLSTATE (e.g. `23505`). Reference test: `supabase/tests/database/timer_guardrails.test.sql` (established in §3 Phase 1). Before committing a new test written this way, break the production code it protects (a worktree-only edit, never staged), confirm the test goes red, then restore — this is the same check `/10x-implement`'s gate (b) runs automatically for any phase that adds or changes tests.

### 6.3 Adding a real-browser (e2e) test

- TBD — see §3 Phase 2 (bootstraps the tool choice, location, and CI wiring).

### 6.4 Adding a weekly-grid / rounding-aggregation test

- TBD — see §3 Phase 3.

### 6.5 Adding an irreversible-action or multi-user-isolation test

- TBD — see §3 Phase 4.

### 6.6 Per-rollout-phase notes

(Fills in after each phase lands, per that phase's final `/10x-plan`
sub-phase.)

## 7. What We Deliberately Don't Test

- **Visual/pixel-level Tailwind styling** — low blast radius for a
  solo/small-team internal tool; loosely covered by the `10x-ui` workflow
  already. Re-evaluate if a visual regression actually ships to production.
  (Source: Phase 2 interview Q5.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-09-28
- Stack versions last verified: 2026-09-28
- AI-native tool references last verified: 2026-09-28 (none in use)

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
