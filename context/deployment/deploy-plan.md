---
project: stopper-for-timecards
planned_at: 2026-09-17
platform: cloudflare-workers
deploy_mechanism: wrangler deploy
based_on:
  - context/foundation/infrastructure.md
  - context/foundation/tech-stack.md
status: phase-a-deployed
live_url: https://stopper-for-timecards.senei-web.workers.dev
---

# Deploy Plan — First Production Deployment

This is the audit trail for the first deployment of `stopper-for-timecards` to Cloudflare Workers. It records what was supposed to happen, in order, so a live run that goes sideways can be compared against intent.

**Important correction carried forward from `infrastructure.md`'s risk register**: `tech-stack.md` hints `deployment_target: cloudflare-pages`, but that hint is stale. The actual deploy mechanism is **Cloudflare Workers via `wrangler deploy`**, not Pages (`wrangler pages deploy`). The two are not interchangeable — this plan uses Workers commands throughout.

**CI/CD ownership constraint (explicit, verified 2026-09-17)**: auto-deploy-on-merge to `main` is owned **exclusively by Cloudflare Builds** (the git-connected CI gate 4 sets up), never by GitHub Actions. Verified `.github/workflows/ci.yml` currently has no deploy step and no reference to `wrangler`/`cloudflare` anywhere in `.github/workflows/` — GitHub Actions is scoped to lint/type-check/build/smoke-test only, and must stay that way. **Do not add a `wrangler-action` (or any `wrangler deploy` step) to `ci.yml`** — running two independent deploy paths against the same Worker would race and produce non-deterministic "which version is actually live" outcomes, defeating the audit-trail purpose of this plan.

## Current repo state (as of planning)

- Fully bootstrapped Astro 7 + React + TypeScript app (`10x-astro-starter`). `package.json` already has `astro`, `@astrojs/cloudflare` (^14.3.1), `@supabase/supabase-js`, `@supabase/ssr`, `wrangler` (^4.131.1, devDep).
- `astro.config.mjs`: `output: "server"`, `adapter: cloudflare()` — already correct for SSR-on-Workers.
- `wrangler.jsonc` already exists with `compatibility_flags: ["nodejs_compat"]` set and an `assets` binding to `./dist`. **No cron/triggers block, no KV bindings yet.** `name` is still `"10x-astro-starter"`, not renamed.
- `.env.example` exists; **no real `.env`**. Supabase is not yet linked to a real remote project — `supabase/config.toml` is local CLI config only.
- The app currently ships the starter's **default email/password auth** (`src/pages/auth/signin`, `signup`, `confirm-email`; `src/middleware.ts`). The PRD's actual access model — **private-link identity, no accounts/passwords** — and **FR-008's scheduled purge job** are not implemented anywhere in `src/`.
- `.github/workflows/ci.yml` runs lint/astro-check/build/smoke-test on push/PR — **no deploy step**. Deploy is meant to run through Cloudflare's native git-connected CI ("Cloudflare Builds" / Workers Builds), per `tech-stack.md`'s `ci_provider: cloudflare-builds`, not GitHub Actions.
- **Bug found (verified 2026-09-17): `ci.yml` triggers on `branches: [master]`, but the repo's actual branch is `main`.** CI is very likely not running at all on pushes/PRs to `main` right now — this predates this plan and isn't caused by it, but should be fixed alongside Phase A since it affects whether lint/build checks actually gate anything.
- `ci.yml`'s `ci` and `smoke` jobs consume `secrets.SUPABASE_URL` / `secrets.SUPABASE_KEY` as **GitHub Actions repo secrets** — a separate secret store from Cloudflare Workers Secrets (`wrangler secret put`) and from `wrangler.jsonc` `vars`. These need to be configured independently in the GitHub repo's own secrets settings; see the Secrets table below.

## Scope — revised to follow `infrastructure.md`'s Getting Started steps

`infrastructure.md`'s Getting Started section (steps 1–6) includes implementing the FR-008 purge job and a Supabase access-log table as part of getting to a working deployment — not as deferred follow-up. This plan now mirrors that, split into three phases:

- **Phase A — Deploy pipeline mechanics** (infra.md steps 1, 2, 5, 6): credentials, secrets, build, deploy, verify. No code changes beyond config.
- **Phase B — Purge job** (infra.md step 3): FR-008 is independent of the auth/identity model — it deletes time entries older than 3 months regardless of who owns them — so this can be implemented and deployed now, ahead of the identity layer.
- **Phase C — Access-log table** (infra.md step 4): the table schema and logging helper can be built now, but the actual call site — "log every private-link lookup" — has nothing to hook into yet. **Blocked** on the private-link identity layer (FR-007), which is not part of `infrastructure.md` and remains out of scope for this plan. The table is created proactively so Phase C's wiring is a one-line addition once FR-007 lands.

## Out of scope for this deployment

- **Private-link identity layer** (FR-007) — replacing the starter's default email/password auth is a separate feature-implementation task, not a deployment-mechanics concern. This deployment ships with the current default auth; Phase C's access-log table is created now but its logging call is wired in when FR-007 is built.
- Custom domain / DNS delegation — deferred; this deploy uses the default `*.workers.dev` subdomain.

## 0. Prerequisites

Confirmed or required before any gate below can be attempted.

**Already satisfied (verified 2026-09-17):**
- GitHub access is fully working. `gh` CLI was not installed on this machine (winget MSI install failed with a permissions error, exit 1603); installed portably instead at `C:\Users\MAKGRU\tools\bin\gh.exe` (no admin rights needed). Logged in as **`senei`** (matches the repo owner and `senei.web@gmail.com`), token scopes `repo` + `workflow`. A second cached account (`Maks-G`) exists but is inactive — the git remote and this login now correctly match.
- Git can fetch/push. The global `~/.gitconfig` (resolves to `P:\.gitconfig` in this environment) is not writable, so the `gh`-issued credential helper was configured **locally** for this repo instead (`git config --local credential.https://github.com.helper`). Local git identity is also set locally: `senei web <senei.web@gmail.com>`.
- **Local and remote history were reconciled.** They had unrelated histories — the GitHub-created repo had its own auto-generated `LICENSE`-only initial commit, while local development had proceeded independently without ever fetching first. Resolved via `git pull origin main --allow-unrelated-histories` (clean merge, only added `LICENSE`, no conflicts) then `git push origin main` — both sides are now in sync (`de56f3e..f261a06`). Local `main` tracks `origin/main`.
- Local Node.js (v24.18.0) is installed and no `engines` field pins a specific version in `package.json` — local build tooling works as-is. Note this is independent of the Workers runtime's own Node API surface, which is governed by `wrangler.jsonc`'s `compatibility_date`/`compatibility_flags`, not the local Node version.
- Supabase CLI is already a devDependency (`supabase` ^2.23.4) — available via `npx supabase` for writing/testing the Phase B/C migrations locally before a remote project exists.
- `wrangler` (^4.131.1) is already a devDependency — no global install needed, use `npx wrangler`.
- `wrangler` is already authenticated (`npx wrangler whoami`, verified 2026-09-17): logged in via OAuth as `senei.web@gmail.com`, account `Senei.web@gmail.com's Account` (`850b866957c01705a4974bd9578828d5`). **This satisfies gate 1 below — `wrangler login` does not need to be run.**

**Note on token scope**: the active OAuth session carries very broad account-level permissions (workers, workers_kv, d1, pages, queues, containers, email, browser, ai, etc.) — normal for an interactive `wrangler login` session, but not the narrow, project-scoped token gate 2 asks for. Gate 2's scoped API token (Workers-edit-only, this project) is for **Cloudflare Builds CI specifically** and must still be created separately — do not reuse this broad OAuth session for that purpose.

**Not yet satisfied (verified 2026-09-17):**
- ~~Supabase CLI not authenticated~~ — **resolved**: `supabase login`'s automatic device-flow doesn't work in a non-TTY shell (`LegacyLoginMissingTokenError`); worked around with a personal access token via `SUPABASE_ACCESS_TOKEN` (set with `setx`, persists across shell sessions). `npx supabase projects list` now works.
- ~~No project linked~~ — **resolved**: a project already existed (`senei's Project`, ref `gylmckjkykvxwsqyzisg`, region `eu-west-1`, status `ACTIVE_HEALTHY`) — gate 3 didn't need a new project created, just discovering and linking the existing one via `npx supabase link --project-ref gylmckjkykvxwsqyzisg`. Real API keys retrieved via `npx supabase projects api-keys --project-ref gylmckjkykvxwsqyzisg` (legacy anon + service_role JWTs, plus newer `sb_publishable_`/`sb_secret_` keys — the app's existing code (`src/lib/supabase.ts`) uses the legacy anon JWT via `@supabase/ssr`, so that's what was used).
- ~~No Worker existed~~ — **resolved as a side effect**: running `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` auto-created an empty Worker named `stopper-for-timecards` when none existed (wrangler asks "create a new Worker with that name?" and defaults to yes in non-interactive context).
- **New gate found (verified 2026-09-17), not anticipated by the original plan: no `workers.dev` subdomain is registered on this Cloudflare account.** `npx wrangler deploy` got through building, asset upload, and KV/Images/Assets binding provisioning, then failed at the final publish step: "You need to register a workers.dev subdomain before publishing to workers.dev" — confirmed no CLI flag or subcommand exists for this (`wrangler deploy --help` has no subdomain option); it's dashboard-only. **Action needed**: visit `https://dash.cloudflare.com/?to=/850b866957c01705a4974bd9578828d5/workers-and-pages` (Cloudflare's own documented redirect-URL pattern for the account's Workers & Pages page — an initial guessed URL, `.../workers/onboarding`, was wrong and 404'd) and look for **"Your subdomain"** with a **"Change"**/**"Set up"** button, then re-run `npx wrangler deploy`. This is account-level (picks the `<subdomain>.workers.dev` prefix shared by all Workers on this account), one-time.

**Must be true before Phase A starts:**
- You (not the agent) have — or can create — a Cloudflare account with permission to create API tokens and connect Git repositories.
- You have — or can create — a Supabase account with permission to create a new project (or an existing project this app can be pointed at).
- ~~Push/admin access to `github.com/senei/stopper-for-timecards`~~ — **confirmed**: authenticated as `senei` (repo owner) with `repo` + `workflow` scopes, push verified working.
- The `SUPABASE_URL`/`SUPABASE_KEY` secret-vs-public discrepancy (flagged in section 2) is resolved — this affects whether Phase A step 2 writes them to `.env`/`wrangler.jsonc` `vars` or behind `wrangler secret put`, so resolve it before, not during, that step.

### CLI configuration reference

How to configure each CLI this plan depends on, from a clean machine or to redo/extend what's already set up here. All three follow the same shape: install → interactive login (browser-based, human-only) → verify → (optionally) link a specific project/resource.

**`wrangler` (Cloudflare)** — status: ✅ configured
- Already a pinned devDependency (`^4.131.1`); always invoke via `npx wrangler <command>`, never a separate global install, so everyone/every environment uses the same version.
- Login: `npx wrangler login` — opens a browser OAuth flow. Credentials land at `C:\Users\MAKGRU\AppData\Roaming\xdg.config\.wrangler\config\default.toml` in this environment.
- Switch/reset identity: `npx wrangler logout` then `npx wrangler login` again.
- Verify: `npx wrangler whoami` (shows account name/ID and token permission scopes).
- **Non-interactive alternative** (useful for scripts or CI outside Cloudflare Builds, though Cloudflare Builds manages its own auth internally and doesn't need this): set the `CLOUDFLARE_API_TOKEN` environment variable — wrangler picks it up automatically instead of requiring `wrangler login`. This is the mechanism gate 2's scoped token would use if ever invoked from a script rather than pasted into the Cloudflare Builds dashboard.

**`gh` (GitHub CLI)** — status: ✅ configured
- Not installed system-wide on this machine (winget MSI install failed, exit 1603 — likely needs admin rights this environment doesn't have). Installed portably instead: downloaded `gh_2.101.0_windows_amd64.zip` from the [official releases page](https://github.com/cli/cli/releases) and extracted to `C:\Users\MAKGRU\tools\bin\gh.exe`. To make this permanent (not just full-path invocation), add `C:\Users\MAKGRU\tools\bin` to the user `PATH` environment variable (Windows Settings → Environment Variables, or `setx PATH "%PATH%;C:\Users\MAKGRU\tools\bin"` in a fresh shell).
- Login: `gh auth login` — interactive device-code flow (prints a one-time code + a URL to open in a browser). Supports multiple cached accounts simultaneously.
- Switch between cached accounts: `gh auth switch --hostname github.com --user <username>`.
- Add a missing token scope without re-logging-in from scratch: `gh auth refresh --hostname github.com --scopes <scope1,scope2>` — this is how the `workflow` scope was added after the first push was rejected for touching `.github/workflows/ci.yml`.
- Wire it into git: `gh auth setup-git` normally does this globally, but that failed here (`P:\.gitconfig` not writable in this environment) — worked around with a **local**, repo-scoped credential helper instead: `git config --local credential.https://github.com.helper "!'C:/Users/MAKGRU/tools/bin/gh.exe' auth git-credential"`. On a normal machine with a writable home directory, `gh auth setup-git` alone is sufficient and repo-scoping isn't needed.
- Verify: `gh auth status`.

**`supabase` (Supabase CLI)** — status: ❌ not yet configured (blocks gate 3)
- Already a devDependency (`^2.23.4`, resolves to `2.117.0` via `npx`); invoke via `npx supabase <command>`.
- Login: `npx supabase login` — interactive browser flow, stores an access token locally. For non-interactive/CI use, the `SUPABASE_ACCESS_TOKEN` environment variable is the equivalent of `wrangler`'s `CLOUDFLARE_API_TOKEN` — set it instead of running `login` interactively.
- **After** a project exists (gate 3, via the Supabase dashboard or `npx supabase projects create`): link this repo to it with `npx supabase link --project-ref <project-ref>` — this is what makes `npx supabase db push` and migration commands target the correct remote database instead of only the local dev stack in `supabase/config.toml`.
- Verify login: `npx supabase projects list` (currently fails with `LegacyPlatformAuthRequiredError` — expected until `login` is run). Verify linking: `npx supabase status` (currently shows `linked_project: null`).

## 1. Manual setup gates (human-only)

These require an interactive login, dashboard click-through, or entering real credentials — none of this can be done by the agent.

- [x] **Cloudflare account + `wrangler login`** — **already done** (see Prerequisites: authenticated as `senei.web@gmail.com`, verified via `npx wrangler whoami`). No action needed.
- [x] **Scope a Cloudflare API token** for CI use. Done 2026-09-18 — the dashboard's actual custom-token UI didn't expose the per-specific-Worker resource picker the Sept 2026 changelog described (searched for it, wasn't there for this account/UI version); went with the pragmatic fallback instead: custom token named `cloudflare-builds-ci-stopper-for-timecards`, permission `Workers Scripts:Edit` on the account, no other permissions (no DNS, no billing). **The first generated token value was accidentally pasted into chat — rolled it immediately** (Cloudflare's "Roll" button generates a fresh value for the same token, invalidating the exposed one) before using it anywhere real. The rolled value was never pasted here.
- [x] **Create or link a real Supabase project** — done earlier (2026-09-17), see Prerequisites: linked to the existing `senei's Project` (ref `gylmckjkykvxwsqyzisg`).
- [x] **Connect the GitHub repo to Cloudflare Builds** — done 2026-09-18, via the Worker's own dashboard page (Workers & Pages → `stopper-for-timecards` → connect Git), not a separate top-level onboarding flow. Confirmed: `Git repository: senei/stopper-for-timecards`, `Production branch: main` (correct — didn't repeat the `master` mistake), `Build command: npm run build`, `Deploy command: npx wrangler deploy`, `Version command: npx wrangler versions upload`, scoped API token attached (`Workers Builds - 2026-09-18 09:55`). Dashboard shows: "You can now push a commit to your Git repository to start your first build" — connection is live, first automated build just hasn't been triggered yet (needs a push to `main`).
  - **Ordering note (verified 2026-09-17)**: no Worker exists on the Cloudflare account yet (`npx wrangler deployments list` → `[code: 10007]`), so there's nothing to attach git integration to. Do this step *after* Phase A's first `wrangler deploy` creates the Worker, not before.
  - **Edge case — name mismatch**: Cloudflare requires the dashboard Worker's name to exactly match `wrangler.jsonc`'s `name` field, or the git-connected build fails outright. Phase A step 1 renames it to `stopper-for-timecards` before this gate — do the rename *before* connecting git, not after.
  - **Edge case — one Cloudflare account per repo**: the same GitHub repo cannot be connected to Workers/Pages projects in two different Cloudflare accounts simultaneously. If this repo was ever test-connected under a different account (e.g. while `wrangler` was authenticated as the wrong identity earlier in this session), disconnect it there first.
  - **Edge case — fork PRs**: Cloudflare Builds does not generate preview deployments for PRs from forked repositories (platform limitation, not a misconfiguration) — irrelevant for this solo project today, but worth knowing if external contributors ever open PRs.
  - **Edge case — build duration**: builds are killed at a hard 20-minute ceiling. This app's build is small (static Astro + a few dependencies) and should be well under that, but worth knowing if a dependency bump ever bloats build time.
- [x] **Provide real secret values** — done 2026-09-17: all three (`SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) set via `wrangler secret put`, confirmed live on the deployed Worker.

## 2. Secrets to configure

| Name | Type | Where it lives | Used by |
|---|---|---|---|
| `SUPABASE_URL` | **Secret** (resolved 2026-09-17, see below) | `wrangler secret put` (Workers Secrets store) + local `.env` | All Supabase client calls |
| `SUPABASE_KEY` (anon key) | **Secret** (resolved 2026-09-17, see below) | Same as above | Client-facing Supabase calls |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | `wrangler secret put` (Workers Secrets store, encrypted) + gitignored `.dev.vars` for local dev | Phase B purge job, Phase C access log — elevated-privilege server-side writes |
| Cloudflare API token (scoped: Workers edit, this project only) | **Secret** | Entered inside Cloudflare Builds' own dashboard when connecting the repo (manual gate 4) — never stored in this repo | Cloudflare Builds CI, for `auto-deploy-on-merge` |
| `SUPABASE_URL` (GitHub Actions copy) | Config value | **GitHub repo secrets** (Settings → Secrets and variables → Actions) — a separate store from the two above, consumed by `.github/workflows/ci.yml`'s `ci` and `smoke` jobs | Lint/build/smoke-test only — this copy never deploys anything (see CI/CD ownership constraint above) |
| `SUPABASE_KEY` (GitHub Actions copy) | Config value | Same GitHub repo secrets store | Same as above |

**Three separate secret stores exist for this project — do not conflate them**: (1) Cloudflare Workers Secrets (`wrangler secret put`, runtime), (2) `wrangler.jsonc` `vars` (build-time, plain), (3) GitHub Actions repo secrets (CI-only, per the constraint above never used to deploy). A value changed in one does not propagate to the others.

**Discrepancy resolved (2026-09-17)**: the repo's `astro.config.mjs` declares both `SUPABASE_URL` and `SUPABASE_KEY` via `astro:env` as `server-secret`, conflicting with `infrastructure.md`'s Operational Story claim that the URL and anon key "can ship client-side." **Resolved in favor of the code's own declaration** — both set via `wrangler secret put`, not `wrangler.jsonc` `vars`. This was discovered the hard way: the first deploy succeeded but the live site showed "Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone" (Supabase not configured, auth disabled), because `.env`/`.dev.vars` only affect local dev/build — the deployed Worker had neither `vars` nor secrets for these two names. Setting both via `wrangler secret put` (no redeploy needed — secrets apply to the running Worker immediately) fixed it; verified by the warning banner disappearing from the live page.

## 3. Phase A — Deploy pipeline mechanics

Run after manual gates 1–4 above are complete (so real credentials exist to work with).

- [x] Rename `wrangler.jsonc`'s `name` field from `"10x-astro-starter"` to `"stopper-for-timecards"` to match `project_name` in `tech-stack.md`. Done 2026-09-17.
- [x] Fix `.github/workflows/ci.yml`'s trigger from `branches: [master]` to `branches: [main]` (both `push` and `pull_request` triggers). Done 2026-09-17.
- [ ] Add `SUPABASE_URL` / `SUPABASE_KEY` as GitHub repo secrets (Settings → Secrets and variables → Actions) so `ci.yml`'s `ci` and `smoke` jobs can build/test successfully — separate from the Cloudflare-side secrets in section 2. **Still outstanding** — this is a GitHub dashboard action, not done yet.
- [x] Populate a local `.env` (gitignored) from `.env.example` with the real `SUPABASE_URL` / anon key. Done 2026-09-17 — also populated `.dev.vars` with the same plus `SUPABASE_SERVICE_ROLE_KEY` for local Worker dev parity.
- [x] Run `npm run build` and confirm it completes without error against the real Supabase project. Done 2026-09-17 — succeeded, picked up real secrets from `.dev.vars`.
- [x] Set server-only secrets on the Workers project: `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY`. Done 2026-09-17 — this also auto-created the Worker (see Prerequisites) since none existed yet. **Also set `SUPABASE_URL` and `SUPABASE_KEY` the same way** (see the resolved discrepancy in section 2) after the first deploy revealed they were missing from the live Worker.
- [x] First deploy: `npx wrangler deploy`. **First attempt (2026-09-17) failed at the final publish step** on the missing `workers.dev` subdomain gate (see Prerequisites) — user registered `senei-web.workers.dev` via the dashboard, then the deploy was re-run and succeeded. **Live at `https://stopper-for-timecards.senei-web.workers.dev`**, Version ID `bdff4928-2fc7-4408-b9ed-4e6c617824b9`.
- [x] Tail logs during a manual smoke test: confirmed via `curl` instead of an interactive browser session — home page (`/`) and `/auth/signin` both return HTTP 200; the "Supabase not configured" warning banner present on the first check disappeared once `SUPABASE_URL`/`SUPABASE_KEY` secrets were added, confirming they're wired correctly.
- [x] Confirm `npx wrangler rollback` is available and understood (list versions with `npx wrangler deployments list`) — not exercised destructively in this plan, just verified as a working escape hatch. Done 2026-09-17 — `deployments list`/`versions list` both show a real version history (each deploy and each secret change creates its own version) to roll back to if needed.

```bash
# One-time login (manual, interactive)
npx wrangler login

# Set secrets (manual gate — real values, not typed in chat)
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY

# Build and deploy
npm run build
npx wrangler deploy

# Verify
npx wrangler tail --format pretty
npx wrangler deployments list
```

## 4. Phase B — Purge job (FR-008)

Independent of the identity model — operates on entry timestamps only, so it can be built and deployed as part of this same integration.

**Researched pattern (2026-09-17, via web search — confirm against the exact installed `@astrojs/cloudflare` 14.3.1 source before committing code, since this wasn't found in Astro's own official docs page, only community sources + the 14.3.0 changelog's custom-entrypoint support):**

`@astrojs/cloudflare`'s default entrypoint only exports `fetch`. To add a `scheduled()` handler, create a custom worker entry file that imports the adapter's request handler and combines it with your own `scheduled` export, then point `wrangler.jsonc`'s `main` at that file instead of the adapter's default entry:

```js
// e.g. src/worker.ts — custom entry combining SSR fetch + the purge cron
import { handle } from "@astrojs/cloudflare/handler";

export default {
  async fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    // purge job logic — see steps below
  },
};
```

Place the Cloudflare handler's `fetch` call first so bindings/locals stay available to the rest of the pipeline; don't keep the adapter's default entry alongside this custom one. **Verify the exact export name (`handle`) against `node_modules/@astrojs/cloudflare/handler` in this repo before writing code** — the community pattern is consistent across sources found, but wasn't confirmed against Astro's own official docs page for this specific version.

- [ ] Confirm the `handle` export exists at `@astrojs/cloudflare/handler` in the installed `node_modules` (or its type definitions) before writing the custom entry.
- [ ] Write a Supabase migration creating a `job_runs` table (columns: `id`, `job_name`, `started_at`, `finished_at`, `status`, `rows_affected`, `error_message`) — this doubles as the purge job's own outcome log per the risk register mitigation.
  - **Edge case**: run migrations (`supabase db push` or equivalent) against the **direct** database connection string (port `5432`), not the transaction pooler (port `6543`) — Supavisor's transaction-pooling mode doesn't support the multi-statement transactions migrations need. This only affects the local CLI migration workflow, not the deployed Worker's runtime queries (those go through `@supabase/supabase-js`'s REST API over `SUPABASE_URL`, which isn't pooler-sensitive).
- [ ] Create the custom worker entry (`src/worker.ts` or similar) combining `fetch` (via `@astrojs/cloudflare/handler`'s `handle`) and `scheduled`.
- [ ] Implement the scheduled handler body: query and delete `time_entries` rows older than 3 months, write one row to `job_runs` per invocation (success or failure), using the Supabase service-role key (server-only secret from Phase A).
- [ ] Point `wrangler.jsonc`'s `main` field at the new custom entry file.
- [ ] Add the Cron Trigger to `wrangler.jsonc` (confirmed syntax, Cloudflare docs 2026-09-17): `{ "triggers": { "crons": ["0 3 * * *"] } }` for a daily 3am UTC run. Note: deploying replaces *all* previously-configured Cron Triggers with whatever is in this array — if a second scheduled job is ever added later, both must be listed together, not deployed as two separate single-cron updates.
- [ ] Deploy (`npx wrangler deploy`).
- [ ] Test locally before relying on production timing: `wrangler dev` exposes a `/cdn-cgi/local/scheduled` route for manually firing the handler — confirmed via Cloudflare's own docs. Example: `curl "http://localhost:8787/cdn-cgi/local/scheduled"` (add `?format=json` for structured output, or `?time=` to simulate a specific `scheduledTime`).
- [ ] Verify against the live deployment: a row appears in `job_runs` with `status: success` and a plausible `rows_affected` count after the cron fires (or after the local-testing route is hit against the deployed Worker).

## 5. Phase C — Access-log table (scaffolded now, wired later)

- [ ] Extend the same migration (or a follow-up one) with an `access_log` table (columns: `id`, `link_id`, `accessed_at`, `ip`, `user_agent`, `outcome`) per `infrastructure.md`'s Role-Rotation Check. Apply the same direct-connection-string edge case noted in Phase B.
- [ ] Write a small `logAccess()` helper in `src/lib/` that inserts a row into `access_log` — built now, but **not called from anywhere yet**, since the private-link lookup route it should hook into (FR-007) doesn't exist.
- [ ] Leave a `// TODO(FR-007): call logAccess() here` marker as a code comment at the point this plan describes — the actual call site is created when the private-link identity feature is implemented, tracked separately from this deploy plan.

## 6. Verification steps

- [x] `npm run build` completes with no errors against the real Supabase project. Verified 2026-09-17.
- [x] `npx wrangler deploy` exits 0 and prints a `*.workers.dev` URL. Verified 2026-09-17 — `https://stopper-for-timecards.senei-web.workers.dev`.
- [x] Opening the deployed URL renders the Astro app's home page (SSR working, not a blank/error page). Verified via `curl` — HTTP 200, full HTML body.
- [ ] `/auth/signup` → `/auth/signin` flow works end-to-end against the real Supabase project. **Partially verified**: `/auth/signin` returns HTTP 200 and the "Supabase not configured" warning is gone after adding the `SUPABASE_URL`/`SUPABASE_KEY` secrets, but an actual signup→signin round-trip hasn't been exercised (would need a real email address/browser session) — do this manually before relying on it.
- [x] Log visibility confirmed — not via `wrangler tail` (no live traffic to observe from this session), but indirectly via `wrangler deployments list`/`versions list` showing the deploy and both post-deploy secret changes as separate, timestamped versions.
- [x] `npx wrangler secret list` shows all three Supabase secrets present (name only): `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Verified 2026-09-17.
- [ ] Cloudflare Builds shows a successful build/deploy triggered by the git connection. **Not done** — gate 4 (connect repo to Cloudflare Builds) is still outstanding; this deploy was via manual `wrangler deploy`, not the git-connected path.
- [ ] A manually-triggered run of the Phase B scheduled handler produces a `job_runs` row with `status: success`. **Not done** — Phase B (purge job) hasn't been implemented yet, only planned.
- [ ] `job_runs` and `access_log` tables both exist in Supabase with the expected schema. **Not done** — same as above, Phase C also not yet implemented.

## 7. Follow-up work (not in this deploy)

- Implement the private-link identity layer (replaces default email/password auth) — see `prd-v3.md` FR-007. Once built, wire its lookup route to call the `logAccess()` helper from Phase C.
- Add basic rate limiting on private-link routes (per `infrastructure.md`'s risk register) before those routes carry real user links.
- Clean up leftover bootstrap scaffold artifacts (`.bootstrap-scaffold/`, `*.scaffold` files) once confirmed safe to remove.

## Research sources (2026-09-17)

Used to replace assumptions with confirmed current behavior before writing Phase B/C and the gate-4 edge cases above:

- [Cron Triggers · Cloudflare Workers docs](https://developers.cloudflare.com/workers/configuration/cron-triggers/) — `wrangler.jsonc` `triggers.crons` syntax, the `/cdn-cgi/local/scheduled` local testing route, and the "deploy replaces all previous triggers" behavior.
- [Scheduled Handler · Cloudflare Workers docs](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/) — the `scheduled(controller, env, ctx)` handler signature.
- [@astrojs/cloudflare 14.3.0 release notes](https://newreleases.io/project/github/withastro/astro/release/@astrojs/cloudflare@14.3.0) — confirms custom worker entrypoint support exists around this version; did not independently confirm the exact `handle` export name, hence the "verify before writing code" step in Phase B.
- [Add a scheduled handler to the worker entrypoint · Issue #41 · zsrobinson/hareware](https://github.com/zsrobinson/hareware/issues/41) and related community writeups — the `import { handle } from "@astrojs/cloudflare/handler"` pattern combining `fetch` + `scheduled` in one custom entry.
- [Troubleshooting builds · Cloudflare Workers docs](https://developers.cloudflare.com/workers/ci-cd/builds/troubleshoot/) — the Worker-name-must-match-`wrangler.jsonc` requirement, one-Cloudflare-account-per-repo rule, build token rotation failure mode, 20-minute build ceiling, and no-preview-for-fork-PRs limitation, all folded into gate 4's edge cases.
- [Supavisor FAQ · Supabase Docs](https://supabase.com/docs/guides/troubleshooting/supavisor-faq-YyP5tI) — direct-connection-vs-transaction-pooler requirement for running migrations, folded into Phase B/C.
