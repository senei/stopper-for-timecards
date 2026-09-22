---
project: stopper-for-timecards
researched_at: 2026-09-17
recommended_platform: Cloudflare Workers (SSR via @astrojs/cloudflare)
runner_up: Vercel
context_type: mvp
tech_stack:
  language: js
  framework: astro
  runtime: cloudflare-workers-ssr
---

## Recommendation

**Deploy on Cloudflare Workers, using the `@astrojs/cloudflare` SSR adapter the 10x Astro Starter already ships with.**

This is a server-rendered, multi-user Astro app: the private-link identity layer and Supabase-backed data access both require server-side logic, and FR-008 requires a scheduled purge job. That rules out the pure-static hosting decision from an earlier, now-superseded research pass on this project (which assumed no backend at all). Against the actual shape — SSR, external Supabase database/auth, a background cron job, and this round's explicit priority of minimizing cost — Cloudflare scored highest (4 Pass + 1 Partial) and is the only platform that is simultaneously free at this scale, natively serverless, and requires zero adapter migration from what the starter already ships. Its closest competitor, Vercel, ties on raw score but carries two real risks specific to this project (detailed below) that keep it as runner-up rather than co-leader.

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP/Integration | Total |
|---|---|---|---|---|---|---|
| **Cloudflare (Workers, SSR)** | Pass | Pass | Pass | Pass | Partial | 4 Pass + 1 Partial |
| **Vercel** | Pass | Pass | Pass | Pass | Partial | 4 Pass + 1 Partial *(two caveats — see below)* |
| Netlify | Partial | Pass | Pass | Partial | Pass | 2 Pass + 3 Partial |
| Render | Partial | Partial | Pass | Partial | Pass | 2 Pass + 3 Partial |
| Railway | Partial | Partial | Pass | Partial | Partial | 1 Pass + 4 Partial |
| Fly.io | Partial | Fail | Pass | Partial | Partial | 1 Pass + 3 Partial + 1 Fail |

**Cloudflare** — `@astrojs/cloudflare` (the starter's pre-wired adapter) is GA for SSR. Cron Triggers are GA and free (5 triggers/account on the free plan — comfortably covers the FR-008 purge job) with 1-minute granularity via `wrangler.jsonc`. `wrangler deploy` / `rollback` / `tail` / `secret put` cover the full deploy lifecycle with clean exit codes. Free tier (100k requests/day) makes $0/month realistic at ~10 users. Docs are GA markdown/llms.txt. Gap: MCP (Workers Bindings MCP) is available but still evolving, not clearly versioned GA.

**Vercel** — `@astrojs/vercel` is GA and a low-risk ~30-minute swap from the Cloudflare adapter (no Cloudflare-specific bindings are in use, since Supabase is external). Cron Jobs are GA on Hobby but capped at once/day — sufficient for a monthly-scale purge. Free tier ($0) is realistic. Two caveats keep it out of the top spot: (1) Hobby tier's fair-use terms explicitly cover "financial gain of anyone involved," which is ambiguous for a company timesheet tool used inside paid employment — Vercel's own docs say to contact support if unsure; (2) Vercel's default Fluid compute reuses warm instances across requests, so a Supabase client instantiated at module scope can leak one user's session into another's request — a real correctness/security risk for this app's private-link identity design, requiring disciplined per-request client instantiation that the Cloudflare Workers model doesn't need to think about (each invocation is more strictly isolated).

**Netlify** — GA SSR adapter, GA scheduled functions, official MCP server. The blocking concern: Netlify's new credit-based free tier (300 credits/month, ~20 production deploys before exhaustion) risks running out from deploy churn alone during this project's active 5-week build phase — directly conflicting with this round's cost-minimizing priority.

### Shortlisted Platforms

#### 1. Cloudflare Workers, SSR (Recommended)

Zero migration cost (already the starter's adapter), $0/month realistic, native free cron for the purge job, and the strongest CLI of the six researched. The main watch-item is observability: free-tier logs aren't persisted, so a silently-failing cron job could go unnoticed (see risk register).

#### 2. Vercel

Same raw score, but the Hobby tier's commercial-use ambiguity and the warm-instance session-isolation gotcha are project-specific risks worth taking seriously before treating this as the default — not disqualifying, but real engineering discipline required if chosen.

#### 3. Netlify

Genuinely serverless with GA scheduled functions and the most mature official MCP server of the group, but the credit-metered free tier's ~20-deploys/month ceiling is a poor fit for a solo dev iterating daily during an active build sprint.

## Anti-Bias Cross-Check: Cloudflare Workers (SSR)

### Devil's Advocate — Weaknesses

1. `nodejs_compat` is a mandatory compatibility flag for Supabase's JS client (needs Node's `crypto`/`buffer`) — omitting it produces opaque 500s with no obvious diagnostic path, and it must be set on every worker involved, not just the main one.
2. Free-tier KV limits (100k reads / **1,000 writes per day**) could be hit if the private-link identity layer uses KV for session or rate-limit state — even at only ~10 users, a naive per-request KV write pattern burns through that ceiling faster than the "generous free tier" framing suggests.
3. The "Pages is being folded into Workers" narrative is drawn from third-party writeups, not an official Cloudflare deprecation notice — a reasonable bet, not a documented guarantee, and the starter's own deployment hint still says `cloudflare-pages`.
4. The FR-008 purge job runs inside a cron-triggered Worker with a CPU-time ceiling even on paid tiers; if the time-entries table grows before the purge query is optimized, a single invocation could time out with no automatic retry built in.
5. `wrangler rollback` reverts Worker code only — not KV state or the Cron Trigger schedule set at the time of deploy. A bad deploy that also changed cron cadence needs a second corrective deploy, not a clean rollback.

### Pre-Mortem — How This Could Fail

Six months in, the purge job had quietly been failing for weeks after a Supabase schema migration renamed a column; the cron-triggered Worker caught the error internally and logged to `console.error`, which nobody was watching, since `wrangler tail` only streams live and Cloudflare's persistent log retention (Logpush) requires a paid plan nobody budgeted for. The dev only discovered four-month-old stale data when a coworker's weekly table looked wrong. Separately, the free tier's 5-cron-trigger cap became a real constraint when a second maintenance job (auto-expiring stale links) was added later — the team hit the ceiling and had to make an unplanned choice under time pressure: delete an existing trigger or start paying. The root cause wasn't Cloudflare being unreliable — it was that "free and seemingly infinite" lured the team into skipping the observability investment they'd have budgeted for on a paid platform with built-in log retention.

### Unknown Unknowns

- Free-tier logs aren't persisted anywhere by default — `wrangler tail` is a live stream only; a silent 3am cron failure leaves no trace unless Logpush (paid) or a custom logging sink is wired up.
- Every request validates the private link against Supabase, an entirely separate service — a Supabase-side outage makes the app look "down" with nothing in Cloudflare's own dashboard explaining why, since the two systems' health is invisible to each other.
- Workers' CPU-time limit measures compute, not wall-clock request duration — a Supabase query that's slow due to network latency (not CPU) doesn't count against the limit the same way, which can produce "worked in testing, times out in prod under a slow response" bugs that look like Cloudflare's fault but aren't.
- The free-tier request cap (100k/day) resets **daily**, not monthly — bot/scanner traffic probing the private-link URLs (even non-malicious scanning, since links are unguessable but URLs are still public-facing) could burn through the daily cap in a way wildly disproportionate to ~10 real users.
- The starter's pinned `@astrojs/cloudflare` adapter version may lag Cloudflare's own `workerd` runtime changes; a routine `npm update` months in could silently shift dev/prod parity behavior the original scaffold didn't anticipate.

**Decision recorded:** proceed with Cloudflare — risks noted and captured in the risk register below.

### Role-Rotation Check

Walking the decision through three team perspectives surfaced one finding not caught by the three lenses above:

- **Frontend developer**: minor friction — every new npm dependency (e.g. a future CSV/Excel export for the FR-006 weekly table) needs an edge-runtime compatibility check before use, since packages assuming a full Node environment (`fs`, `child_process`) can fail at build or deploy time rather than immediately locally. Not disqualifying.
- **Cost owner**: no concerns — Cloudflare's hard free-tier caps (vs. metered overage billing) mean the worst case is service degradation, not a surprise invoice. This is the platform best aligned with this round's cost-minimizing priority.
- **Security**: **real concern.** The private-link identity model (link = identity, no accounts/passwords) makes an access audit trail the primary tool for investigating a suspected leaked link — but free-tier Cloudflare logs aren't persisted (`wrangler tail` is live-stream only), so there is no way to reconstruct "who accessed this link, when, from where" after the fact. This is distinct from the general observability gap already flagged in the Pre-Mortem (silent cron failure) — it's a security audit-trail gap, not just a debugging one.

**Resolution**: no platform swap needed — Vercel and Netlify have the same ephemeral free-tier log retention, so switching wouldn't close the gap for free. Instead, extend the app itself: log every private-link access (link ID, timestamp, IP, user-agent) to a Supabase table. This reuses the same Supabase-logging mechanism already planned for cron-job observability, so it costs nothing extra to add. Captured as a risk-register row and a Getting Started step below.

## Operational Story

- **Preview deploys**: `wrangler versions upload` creates a zero-traffic preview version with its own URL before promoting to production. No PR-based preview automation is wired up for this solo flow (CI is Cloudflare Builds, not GitHub Actions, per `tech-stack.md`) — the dev triggers preview versions manually pre-merge, or configures Cloudflare Builds' own preview-deployment behavior for branch pushes.
- **Secrets**: Supabase URL and anon key can ship client-side; the Supabase **service-role key** and any other server-only secret go through `wrangler secret put <NAME>` — encrypted at rest, write-only after creation. Local dev uses a gitignored `.dev.vars`. Non-secret config lives in `wrangler.jsonc` `vars`.
- **Rollback**: `wrangler rollback [<version-id>]` reverts Worker code to a prior version in seconds. Caveat: this does not revert KV state or the Cron Trigger schedule active at deploy time — a deploy that also changed cron cadence needs a follow-up deploy, not just a rollback. Supabase-side schema changes (migrations) are a separate rollback surface entirely, outside Cloudflare's control.
- **Approval**: Routine deploys (`wrangler deploy`) and secret rotation via `wrangler secret put` for non-primary secrets may run agent-driven. Domain/DNS delegation to Cloudflare, rotating the Supabase service-role key, and any change to the Cron Trigger schedule are human-reviewed given their blast radius (schedule changes silently alter when user data gets purged).
- **Owner-only data deletion (support tooling, not a product feature)**: the app itself has no admin role and no way to identify "the owner" versus any other link-holder — that's a deliberate PRD decision (see `prd.md`'s Non-Goals and Access Control), not a gap. When the project owner personally needs to remove a specific person's data (e.g. a support request, a mistaken test link), do it directly against Supabase with the service-role key — never build this into the app's UI or auth model:
  ```sql
  -- Given the person's link id (look it up by token_hash if only the URL is known):
  delete from time_entries where link_id = '<link-id>';
  delete from projects where link_id = '<link-id>';
  delete from access_log where link_id = '<link-id>';
  delete from links where id = '<link-id>';
  ```
  Run via `npx supabase db execute` against the linked remote project, or the Supabase Studio SQL editor. This is always a human-initiated, human-reviewed action — never automate or expose it as a callable route, since doing so would recreate the admin/no-admin conflict the PRD explicitly closed. If this need becomes routine rather than exceptional, that's a signal to properly plan S-10 (self-service `delete-account`) instead of growing ad hoc tooling around it.
- **Logs**: `wrangler tail --format pretty` streams live request logs read-only from the terminal — this is the only log visibility on the free tier (no persistent retention without paid Logpush). Given the Pre-Mortem finding above, treat wiring up *some* persistent log capture (even a lightweight one, e.g. logging cron outcomes to a Supabase table) as a near-term follow-up, not an optional nice-to-have. The same table pattern doubles as the private-link access audit trail flagged in the Role-Rotation Check — one Supabase table, two purposes (operational debugging and security audit).

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Cron-triggered purge job fails silently; free-tier logs aren't persisted, so failures go unnoticed until stale data is visibly wrong | Pre-mortem | M | H | Have the purge Worker write its own outcome (success/failure + row count) to a small Supabase table on every run; check that table periodically, or alert on missing recent rows |
| `nodejs_compat` flag omitted on a worker touching Supabase, producing opaque 500s | Devil's advocate | M | M | Set `compatibility_flags: ["nodejs_compat"]` in `wrangler.jsonc` for every worker at scaffold time; add a smoke test that exercises a Supabase call post-deploy |
| Free-tier KV write cap (1,000/day) hit if session/rate-limit state is written to KV per request | Devil's advocate | L | M | Avoid per-request KV writes for the private-link identity layer; prefer stateless validation against Supabase directly, or batch/throttle any KV writes |
| Free-tier daily request cap (100k/day, resets daily) exhausted by scanning/bot traffic against unguessable-but-public private-link URLs | Unknown unknowns | L | M | Add basic rate limiting (Cloudflare's built-in Rate Limiting rules) in front of the private-link routes |
| `wrangler rollback` doesn't revert KV state or Cron Trigger schedule changes made in the same deploy | Devil's advocate | L | M | Treat cron-schedule changes as their own deploy step, reviewed separately from routine code deploys |
| Starter's `deployment_target: cloudflare-pages` hint is stale relative to the SSR-on-Workers path actually being used | Devil's advocate | M | L | Confirm `wrangler.jsonc` targets Workers (not legacy Pages config) during bootstrap; update the hint if `/10x-bootstrapper` reads it literally |
| Pinned `@astrojs/cloudflare` adapter version drifts from Cloudflare's `workerd` runtime on a routine `npm update` | Unknown unknowns | L | M | Pin the adapter and `wrangler` as exact devDependency versions; re-test the private-link flow after any adapter/wrangler bump before deploying |
| No persistent access log for the private-link identity model — a suspected leaked link can't be investigated after the fact, since free-tier logs aren't retained | Role-rotation (security) | M | H | Log every private-link access (link ID, timestamp, IP, user-agent) to a Supabase table — the same table/pattern used for cron-job observability, at no extra cost |

## Getting Started

1. Confirm `astro.config.mjs` uses `@astrojs/cloudflare` with `output: 'server'` (already the starter's default — verify it wasn't reconfigured to `static` during scaffolding).
2. Set `compatibility_flags: ["nodejs_compat"]` in `wrangler.jsonc` before the first deploy — required for the Supabase JS client's use of Node's `crypto`/`buffer`.
3. Add the purge job as a Cron Trigger in `wrangler.jsonc` (`{ "triggers": { "crons": ["0 3 * * *"] } }` for a daily 3am run), and implement it as a scheduled handler that deletes entries older than 3 months and logs its outcome (row count, success/failure) to a Supabase table per the risk-register mitigation above.
4. Add a Supabase-backed access log for the private-link identity flow: on every successful (and failed) link lookup, insert a row with the link ID, timestamp, IP, and user-agent. This is the same table/pattern as step 3's cron-outcome logging and closes the security audit-trail gap identified in the Role-Rotation Check.
5. Store the Supabase service-role key with `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`; keep the anon key in `wrangler.jsonc` `vars` since it's safe to ship client-side.
6. Build and deploy: `npm run build && npx wrangler deploy`, then verify the private-link flow end-to-end and confirm the cron trigger fires with `npx wrangler tail --format pretty` during a manually-triggered test run.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup
- Production-scale architecture (multi-region, HA, DR)
