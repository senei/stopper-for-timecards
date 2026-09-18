---
starter_id: 10x-astro-starter
package_manager: npm
project_name: stopper-for-timecards
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: cloudflare-builds
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: true
---

## Why this stack

A solo, 5-week after-hours build of a hosted multi-user web app needs a battle-tested, agent-friendly starter that ships auth, database, and edge deploy in one pinned stack — the recommended default for `(web, js)`. 10x-astro-starter clears all four agent-friendly gates and carries first-class bootstrapper confidence. The PRD's private-link identity model (no accounts, no passwords — a link is the identity) doesn't match the starter's built-in Supabase auth out of the box; this gap was flagged during selection, and the link-based identity layer will need to be built on top of Supabase rather than using its account/login flow as-is. The automatic purge of time entries older than 3 months (FR-008) is in scope and should stay lightweight given the starter's edge-runtime constraints on long-running tasks; heavier background work would need an external worker per the starter's own gotchas. CI runs on Cloudflare Builds with auto-deploy-on-merge, native to the Cloudflare deployment target. Deployment defaults to Cloudflare Pages, the starter's first-listed target.
