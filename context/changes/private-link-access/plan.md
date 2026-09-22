# Private Link Access Implementation Plan

## Overview

Replace the starter's email/password identity with the PRD's private-link identity (FR-007, US-02). A first-time visitor creates their own unguessable link (`/w/<token>`), lands in an empty workspace, and the app is capped at 10 people total, showing a clear "full" message after that. Every lookup is written to the existing `access_log`. The starter's email/password auth is removed as part of the same change. Roadmap item S-01 of milestone M-01, GitHub issue #1.

## Current State Analysis

- Identity today is Supabase Auth (email/password): `src/middleware.ts:6-24` calls `supabase.auth.getUser()` on every request; `src/pages/api/auth/*`, `src/pages/auth/*`, `src/components/auth/*`, `Topbar.astro`, `Welcome.astro` and `dashboard.astro` all assume accounts; `src/env.d.ts` types `Locals.user`.
- `scripts/smoke.mjs` and `.github/workflows/ci.yml` (`smoke` job) verify the app through that email/password flow, and CI passes only the anon key. CI on `main` has been red since 2026-09-18: the `ci` job fails at `npm run lint` (prettier errors in `src/__tests__/example.test.ts` and `src/lib/access-log.ts`; `no-undef process` and typed-lint errors in `scripts/smoke.mjs`), and the `smoke` job's signup step fails with "Error sending confirmation email" because `supabase/config.toml` enables Resend SMTP with an unset `RESEND_SMTP_PASS`.
- No table represents a person. `time_entries.link_id` and `access_log.link_id` (`supabase/migrations/20260918082739_phase_b_c_purge_and_access_log.sql`) already assume a stable per-person link id, but nothing creates one.
- `logAccess()` exists (`src/lib/access-log.ts`) but is never called, requires a non-null link id, and does not swallow insert failures. `access_log.link_id` is `NOT NULL`.
- The migration's tables have row-level security (RLS) off, so the anon key can read them over Supabase's REST endpoint.
- `SUPABASE_SERVICE_ROLE_KEY` is already declared in `astro.config.mjs` and set as a Worker secret. Migrations reach production via `npx supabase db push` (`context/deployment/deploy-plan.md`).

## Desired End State

- `/` offers "create my private link". Creating one redirects to `/w/<token>`, which shows an empty workspace and the user's own link. Opening that URL from any browser lands in the same workspace with no login.
- The 11th person to try sees "full" and no link is created; concurrent creation cannot exceed 10.
- A browser that already holds a valid link is sent to its workspace instead of creating another.
- Creating a new link requires passing a Cloudflare Turnstile check, and at most 3 links can be created in any 10 minutes, so a script cannot use up the slots in a burst.
- The owner can stop all new link creation at any time by setting one secret (`LINK_CREATION_CLOSED`); existing links keep working. Once the coworkers are onboarded, this removes the slot-exhaustion risk entirely.
- Unknown or malformed tokens get an identical 404. Successful lookups and well-formed misses are logged to `access_log`; malformed tokens are not.
- `links`, `access_log`, `time_entries` and `job_runs` are unreadable with the anon key.
- No email/password pages, routes, or Supabase-auth middleware remain. CI smoke passes on the link flow.

### Key Discoveries:

- `src/lib/access-log.ts:20-35`: `logAccess` builds a service-role client per call and ignores insert errors; both need changing (nullable link, never throw).
- `astro.config.mjs` already declares `SUPABASE_SERVICE_ROLE_KEY` (`server`/`secret`/`optional`), so no new secret plumbing is needed.
- The identity model's stable id is `links.id`; regeneration (S-07) will replace only `token_hash`, so `time_entries.link_id` stays valid. The token itself is stored only as a SHA-256 hash.
- `scripts/smoke.mjs` sends an `Origin` header on POSTs, which Astro's default same-origin check requires.
- WAF rate-limit rules are documented per zone and the `workers.dev` address is not a zone you own; the Workers Rate Limiting binding has undocumented Free-plan and `workers.dev` support and is only approximate. Creation is therefore protected by two layers that depend on neither: a Turnstile bot check (independent of Cloudflare's proxy; tokens are single-use and expire after 5 minutes; documented always-pass test keys make CI possible) and a database-backed creation throttle. Whether Turnstile accepts the `workers.dev` hostname is confirmed in Phase 4.

## What We're NOT Doing

- No link regeneration (S-07), projects, timers or time entries (S-02+), and no change to the purge worker (S-08).
- No per-person UI beyond the empty workspace and the link display.
- No shared invite code (declined): creation stays open, protected by the cookie, Turnstile, the creation throttle and the cap.
- No session cookie holding identity (declined). The path token is authoritative and checked against the database on every request. The only cookie is a convenience one that remembers a browser's link.
- Malformed tokens are not logged (declined "log every request").
- Disabling Supabase Auth signups on the remote project (`enable_signup = false` via `supabase config push`) is a recommended follow-up, not part of this change, because it alters remote configuration.
- No per-IP rate limiting and no `ratelimits` binding (replaced by Turnstile plus a global throttle); a slow drip of one link every few minutes can still get through while creation is open; the answer to that is closing creation with `LINK_CREATION_CLOSED` once everyone is onboarded, or deleting rows in SQL. A per-IP creation limit and reclaiming idle slots were considered and declined for this change.
- No admin tooling to free a slot: the cap counts `links` rows and nothing ever deletes them (PRD-accepted, FR-007).

## Implementation Approach

Bottom-up by risk: first the database contract and token helpers (the parts that cannot be undone cheaply), then the user-visible create/open flow on top of the still-working starter auth, then removal of the starter auth once the new flow is proven, then production rollout. All database access goes through the server with the service-role key; RLS with no policies keeps everything else out.

Behaviour decisions recorded here as tests, not left implicit:

- **Cap boundary:** the 10th link is created, the 11th returns "full". A person is one `links` row; regeneration (S-07) does not consume a slot.
- **Concurrent creation:** creation and the count check run atomically in one database function.
- **Returning visitor:** a valid cookie on `POST /api/links` redirects to the existing workspace without creating a link (and without spending a Turnstile check); a cookie whose token no longer resolves is cleared and creation proceeds.
- **Creation gating order:** cookie, then the close switch, then Turnstile, then the throttle, then `create_link`, cheapest first. Missing Turnstile configuration fails closed (no link can be created) rather than open.
- **Throttle:** at most 3 links created in the last 10 minutes across all visitors. The check is a count over `links.created_at`, not atomic with creation, so a race can overshoot by a link or two; that is accepted because the hard cap of 10 is atomic.

## Phase 1: Link data and core

### Overview

Database contract (links table, atomic capped creation, RLS, nullable access-log link) plus the pure token helpers, a hardened `logAccess`, and a repair of the lint baseline that has kept CI red since 2026-09-18. No user-visible change yet.

**Preconditions:** Docker is running and the local stack is up (`npx supabase start`); `supabase db reset` and `supabase test db` need it.

### Changes Required:

#### 1. Migration for links, cap, RLS and nullable log link

**File**: `supabase/migrations/<timestamp>_private_links.sql` (new)

**Intent**: Introduce the person/link table, enforce the 10-person cap atomically, close anon access to all four tables, and let a miss be logged without a link id.

**Contract**:
- `links(id uuid pk default gen_random_uuid(), token_hash text not null unique, created_at timestamptz not null default now())`. `id` is the stable person id used by `time_entries.link_id` and `access_log.link_id`; only `token_hash` changes on regeneration.
- `create_link(p_token_hash text) returns uuid`: `security definer`, fixed `search_path`; takes a transaction-level advisory lock, returns `null` when `count(*) >= 10`, otherwise inserts and returns the new `id`. Execute revoked from `public`, `anon`, `authenticated`; granted to `service_role` only.
- `alter table access_log alter column link_id drop not null`.
- `enable row level security` on `links`, `access_log`, `time_entries`, `job_runs` with no policies.

#### 2. Database tests

**File**: `supabase/tests/database/private_links.test.sql` (new; pgTAP, run by `npx supabase test db`)

**Intent**: Prove the cap boundary, race-safety intent and RLS at the database level.

**Contract**: the file first enables pgTAP itself (`create extension if not exists pgtap with schema extensions`). Named tests — "10th link is created", "11th create_link returns null", "duplicate token_hash is rejected", "anon and authenticated cannot execute create_link", "anon sees zero rows from links, access_log, time_entries, job_runs even when rows exist", "access_log accepts a null link_id".

#### 3. Token helpers

**File**: `src/lib/link-token.ts` (new), `src/lib/link-token.test.ts` (new)

**Intent**: Generate, hash and shape-check tokens using only Web Crypto so the same code runs in Workers and in vitest.

**Contract**: `generateToken(): string` (32 random bytes, base64url, 43 characters); `hashToken(token): Promise<string>` (SHA-256, lowercase hex, 64 characters, deterministic); `isWellFormedToken(value: unknown): boolean` (exactly `^[A-Za-z0-9_-]{43}$`). Tests cover length and charset, uniqueness across many calls, hash determinism and shape, and rejecting empty, short, long, padded and non-string input.

#### 4. Admin client and hardened access log

**File**: `src/lib/supabase-admin.ts` (new), `src/lib/access-log.ts`

**Intent**: One place that builds the service-role client, and an access log that can record a miss and can never break a request.

**Contract**: `createAdminClient()` returns a Supabase client (no session persistence) or `null` when `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are unset. `logAccess(linkId: string | null, request: Request, outcome: AccessOutcome): Promise<void>` swallows and console-logs any failure; the `TODO(FR-007)` marker is removed.

#### 5. Lint baseline repair

**File**: `src/__tests__/example.test.ts`, `src/lib/access-log.ts`, `eslint.config.js`

**Intent**: `npm run lint` fails on `main` today (CI `ci` job, every push since 2026-09-18), so no later lint criterion could pass. Make the baseline green before adding code.

**Contract**: apply the project's prettier formatting to the two flagged files (the `access-log.ts` fix is folded into change 4), and add an ESLint override for `scripts/**/*.mjs` that provides Node globals (`process`) and relaxes the typed-lint rules that flag untyped script code. `npm run lint` must pass on the whole repository, not only on new files.

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly to a fresh local database: `npx supabase db reset`
- Database tests pass (cap boundary, RLS, execute privileges, null log link): `npx supabase test db`
- Token unit tests pass: `npm test -- --run`
- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Create and open a link

### Overview

The user-visible flow: create a link, land in the workspace, remembered per browser, with logging and the "full" message. The starter auth still exists and keeps working alongside.

### Changes Required:

#### 1. Data access for links

**File**: `src/lib/links.ts` (new)

**Intent**: Thin server-side functions over the database contract, so routes and pages share one code path.

**Contract**: `createLink(): Promise<{ status: "created"; id: string; token: string } | { status: "full" }>` (generates a token, hashes it, calls `create_link`, throws on database errors); `findLinkByToken(token): Promise<{ id: string } | null>` (hashes and looks up; does not check shape — callers do). `countRecentLinks(windowMinutes: number): Promise<number>` counts `links` rows with `created_at` in that window. All three use `createAdminClient()` and throw a clear error when Supabase is not configured.

#### 2. Create-link route

**File**: `src/pages/api/links.ts` (new), `src/lib/creation-closed.ts` (new), `src/lib/creation-closed.test.ts` (new), `astro.config.mjs`, `.env.example`

**Intent**: The only way to get a link. POST-only. Also home of the owner's close-registration switch.

**Contract**: `POST /api/links`, in this order: (1) if the `stopper_link` cookie holds a token that resolves, 303 to its `/w/<token>` without creating (no Turnstile check spent); if it does not resolve, clear the cookie; (2) if creation is closed, 303 to `/?closed=1`; (3) read the `cf-turnstile-response` form field and verify it through `verifyTurnstile`; absent or failing gives 303 to `/?error=verify`; (4) `countRecentLinks(10) >= 3` gives 303 to `/?error=busy`; (5) `createLink()`: `created` sets the cookie and 303s to `/w/<token>`; `full` gives 303 to `/?full=1`; any thrown error gives 303 to `/?error=1` with a generic message. The window (10 minutes) and maximum (3) are named constants. Cookie `stopper_link`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production, one-year max age. Non-POST methods return 405. Creation is closed when the `LINK_CREATION_CLOSED` secret is set to `1` or `true` (case-insensitive, surrounding whitespace ignored); unset, empty or any other value means open. `isCreationClosed(value: string | undefined): boolean` in `src/lib/creation-closed.ts` is that pure parse, with unit tests for unset, empty, `0`, `false`, `1`, `true`, `TRUE` and ` true `. `astro.config.mjs` declares `LINK_CREATION_CLOSED` as a `server`/`secret`/`optional` env entry and `.env.example` documents it. Closing does not affect existing links or the workspace page.

#### 3. Turnstile verification

**File**: `src/lib/turnstile.ts` (new), `src/lib/turnstile.test.ts` (new), `astro.config.mjs`, `.env.example`

**Intent**: Stop scripted slot exhaustion with a bot check that works on the `workers.dev` address without needing a domain or a rate-limit feature.

**Contract**: `verifyTurnstile(token: string | null, ip: string | null): Promise<boolean>` posts `secret`, `response` and `remoteip` to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with a short timeout and returns the response's `success`; it returns `false` without any network call when the token is empty or the secret is unset, and `false` on any network or parse error (fails closed). `astro.config.mjs` gains `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` as `server`/`secret`/`optional` env entries, declared the same way as the Supabase values. `.env.example` documents both with Cloudflare's dummy test keys for local and CI use (site key `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`, which accept the dummy token `XXXX.DUMMY.TOKEN.XXXX`); production secrets reject dummy tokens. Unit tests mock `fetch`: success true gives `true`; success false gives `false`; network error gives `false`; empty token or missing secret gives `false` with no `fetch` call.

#### 4. Landing page

**File**: `src/pages/index.astro`, `src/layouts/Layout.astro`

**Intent**: Replace the starter marketing page with the entry point; the layout title stops saying "10x Astro Starter".

**Contract**: `/` — if the `stopper_link` cookie resolves, redirect to its workspace (clearing a stale cookie); otherwise show a one-paragraph explanation and a form posting to `/api/links`. `?full=1` replaces the form with "All 10 spots are taken; no new links can be created." The form includes the Turnstile widget (Cloudflare's script and a `cf-turnstile` element using `TURNSTILE_SITE_KEY`), which adds the `cf-turnstile-response` field on submit. When creation is closed (secret set, or `?closed=1`), the form and widget are replaced with "New links are closed. If you already have a link, open it directly." `?error=1`, `?error=busy` ("Too many links were created just now; please try again in a few minutes") and `?error=verify` ("Verification failed; please try again") show short generic messages. If the cookie lookup throws, `/` renders the create form as if there were no cookie, without redirecting and without clearing the cookie. Copy is English.

#### 5. Workspace page

**File**: `src/pages/w/[token].astro` (new), `src/pages/404.astro` (new), `public/robots.txt` (new)

**Intent**: Land the link holder in their empty workspace and keep the token out of caches, referrers and indexes.

**Contract**: For `/w/<token>`: not well-formed → `Astro.rewrite("/404")` with no database call and no log; well-formed → `findLinkByToken`; hit → `await logAccess(id, request, "success")`, refresh the `stopper_link` cookie, render "Your workspace" with a "No projects yet" placeholder and the user's own link (read-only field with a copy button and a warning that the link cannot be recovered and anyone holding it can see and log this person's time); miss → `await logAccess(null, request, "not_found")` and the same 404; database error → `await logAccess(null, request, "error")` and a plain 503 "temporarily unavailable". `logAccess` is awaited before the response is returned, because a promise left running after the response can be cancelled on Workers and would silently drop audit rows. Responses carry `Referrer-Policy: no-referrer`, `Cache-Control: no-store` and `X-Robots-Tag: noindex`. `robots.txt` disallows `/w/`. The 404 body is identical for malformed and unknown tokens.

#### 6. Smoke test: replace the auth steps with the link flow

**File**: `scripts/smoke.mjs`

**Intent**: Prove the flow, the Turnstile gate, the throttle and the cap end to end in CI. The old signup/signin/dashboard/signout steps are removed here, not in Phase 3: they already fail in CI because `supabase/config.toml` enables Resend SMTP with an unset `RESEND_SMTP_PASS` ("Error sending confirmation email"), and they are deleted with the auth code in Phase 3 anyway.

**Contract**: refuse to run unless `BASE_URL` is `localhost`/`127.0.0.1` (running it against production would use up permanent slots). The run uses Cloudflare's dummy Turnstile keys and sends the dummy token `XXXX.DUMMY.TOKEN.XXXX` as `cf-turnstile-response`. Steps, in order: (1) `POST /api/links` without a token gives 303 to `/?error=verify` and no link is created; (2) `POST /api/links` with the dummy token gives 303 to `/w/` plus a 43-char token; (3) that workspace returns 200; (4) the same POST repeated with the cookie gives 303 to the same workspace, no new link; (5) a well-formed unknown token returns 404; (6) a malformed token returns 404. When `SMOKE_SUPABASE_URL` and `SMOKE_SERVICE_ROLE_KEY` are provided (from `npx supabase status -o env`), also: (7) create links through the `create_link` database function (REST rpc, service-role key) until 9 exist; (8) a cookie-less `POST /api/links` with the dummy token gives 303 to `/?error=busy` (the throttle, since nine links were just created); (9) backdate every link's `created_at` by an hour through the service-role REST API; (10) a cookie-less POST creates the 10th link (303 to a workspace); (11) a further cookie-less POST gives 303 to `/?full=1`; (12) assert `access_log` holds a `success` row and a `not_found` row with null `link_id`; (13) assert the anon key reads zero rows from `links`. Steps 7-13 are skipped with a printed notice when the credentials are absent; CI always provides them. CI needs outbound access to `challenges.cloudflare.com` from step 2 onward.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`
- Unit tests pass: `npm test -- --run`
- Production build succeeds: `npm run build`
- Smoke steps (Turnstile gate, link flow, throttle, cap, access-log and RLS assertions) pass against a local preview with local Supabase: `npm run smoke`

#### Manual Verification:

- In a browser, "create my private link" lands on `/w/<token>` showing an empty workspace and the copyable link
- Opening that URL in a private window or another browser shows the same workspace with no login
- Changing one character of the token shows the 404 page, identical to a malformed token
- Returning to `/` in the browser that created the link redirects straight to the workspace
- With 10 links present (fill the first 9 with SQL and backdate their `created_at`, so the throttle does not apply), the next attempt in the browser shows the "full" message and creates nothing (check the `links` row count locally)
- `access_log` contains a `success` row for each open and a `not_found` row with a null link id for the altered token
- The landing page shows the Turnstile widget (test keys locally), and creating a link works only after it passes
- With `LINK_CREATION_CLOSED=1` in `.dev.vars`, the landing page shows the closed message, a direct `POST /api/links` redirects to it, and an existing link still opens its workspace

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: Retire the starter auth

### Overview

Remove everything that assumed Supabase email/password accounts, leave CI verifying only the link flow, and give CI the service-role key it now needs.

### Changes Required:

#### 1. Remove starter auth code

**File**: `src/pages/auth/*`, `src/pages/api/auth/*`, `src/components/auth/*`, `src/components/Topbar.astro`, `src/components/Welcome.astro`, `src/pages/dashboard.astro`, `src/middleware.ts`, `src/lib/supabase.ts`

**Intent**: Delete the account-based flow, including the public signup endpoint.

**Contract**: after removal, `/auth/*`, `/api/auth/*` and `/dashboard` are 404. Any component only they used (check with a search, e.g. `LibBadge.astro`) is removed; generic UI primitives such as `ui/button.tsx` stay.

#### 2. Types, config and dependencies

**File**: `src/env.d.ts`, `src/lib/config-status.ts`, `package.json`, `package-lock.json`

**Intent**: Stop describing a login the app no longer has.

**Contract**: `App.Locals` drops `user`; `configStatuses` reports Supabase as configured only when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set, with an English message that no longer mentions authentication; `@supabase/ssr` is removed from dependencies. `SUPABASE_KEY` stays declared in `astro.config.mjs` (unused but harmless; removing a deployed secret's declaration is a separate cleanup).

#### 3. Smoke test and CI

**File**: `scripts/smoke.mjs`, `.github/workflows/ci.yml`

**Intent**: CI proves the new identity flow and database contract, not the deleted one.

**Contract**: the auth steps were already removed in Phase 2; add the step "`/auth/signin` and `/dashboard` return 404". In the `smoke` job, export `SERVICE_ROLE_KEY` from `supabase status -o env` into `.env`/`.dev.vars` as `SUPABASE_SERVICE_ROLE_KEY`, pass `SMOKE_SUPABASE_URL`/`SMOKE_SERVICE_ROLE_KEY` to the smoke run, also write Cloudflare's dummy Turnstile keys (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`) into the same files, and add a `npx supabase test db` step after `supabase start`. The Cloudflare Builds deploy path is untouched (no deploy step in GitHub Actions).

### Success Criteria:

#### Automated Verification:

- No references to removed modules remain: a search for `auth/signin`, `api/auth`, `@supabase/ssr`, `locals.user` and `lib/supabase"` in `src/` and `scripts/` returns nothing
- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`
- Unit tests pass: `npm test -- --run`
- Production build succeeds: `npm run build`
- Smoke test (link flow plus 404s for removed routes) passes locally: `npm run smoke`

#### Manual Verification:

- The landing page shows no Sign in / Sign up links
- Visiting `/auth/signin`, `/auth/signup` and `/dashboard` shows the 404 page
- After pushing the branch, both GitHub Actions jobs (`ci` and `smoke`) are green, including the new database-test step

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 4: Ship and verify in production

### Overview

Apply the migration to the real Supabase project, deploy through Cloudflare Builds, and confirm Turnstile accepts the live `workers.dev` hostname.

### Changes Required:

#### 1. Production rollout

**File**: no repo files (operational steps)

**Intent**: Put the migration and code live in the right order: schema first, then code.

**Contract**: `npx supabase db push` (verify with `npx supabase migration list` showing the new version both locally and remotely) before merging to `main`; merging triggers the Cloudflare Builds auto-deploy. Before merging, create a Turnstile widget in the Cloudflare dashboard for the hostname `stopper-for-timecards.senei-web.workers.dev` and store its keys with `npx wrangler secret put TURNSTILE_SITE_KEY` and `npx wrangler secret put TURNSTILE_SECRET_KEY`; without them creation fails closed. Confirm the five Worker secrets are present with `npx wrangler secret list`. Once your coworkers have their links, close registration with `npx wrangler secret put LINK_CREATION_CLOSED` (value `1`); `npx wrangler secret delete LINK_CREATION_CLOSED` reopens it. Secrets apply to the running Worker immediately, without a redeploy. The first link created in production should be the owner's real link; any test links consume slots permanently and must be deleted by SQL by the owner.

#### 2. Turnstile hostname check

**File**: none (only if the dashboard rejects the hostname)

**Intent**: Learn whether Turnstile accepts the `workers.dev` hostname without burning production slots.

**Contract**: the widget is created for the live hostname; the landing page must render it and a real creation must succeed. If the dashboard refuses the `workers.dev` hostname, record that in Migration Notes and fall back to the cookie, the throttle and the cap until a custom domain exists; do not leave Turnstile configured in a state that blocks every creation.

### Success Criteria:

#### Automated Verification:

- The migration is applied both locally and remotely: `npx supabase migration list`
- Worker secrets `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are present: `npx wrangler secret list`

#### Manual Verification:

- The Cloudflare Builds deploy for the merge succeeds and the live site serves the new landing page
- On the live site, creating the owner's link lands on `/w/<token>`; the same URL opens in a private window
- A malformed and an altered token both show the 404 page on the live site
- The live `access_log` table holds the `success` and `not_found` rows from those checks
- Reading `links` from the live REST endpoint with the anon key returns no rows
- The Turnstile widget renders on the live landing page and a real creation succeeds, or the hostname is rejected and the outcome is written into Migration Notes
- Setting `LINK_CREATION_CLOSED` to `1` on the live Worker makes the landing page show the closed message while an existing link still opens; the secret is then deleted or left in place as you decide

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- Token generation shape, uniqueness, hash determinism, and `isWellFormedToken` accept/reject cases
- `verifyTurnstile` with a mocked `fetch`: success, failure, network error, empty token, missing secret
- `isCreationClosed` parsing: unset, empty, `0`, `false`, `1`, `true`, `TRUE`, ` true `
- Named cap tests live in the database suite (10th created, 11th `null`)

### Integration Tests:

- pgTAP suite: cap boundary, duplicate hash, execute privileges, RLS deny for anon on all four tables, null `access_log.link_id`
- Smoke: missing token gives the verify error; create → open → repeat-with-cookie → unknown token → malformed token; then, with service credentials, fill to 9 through the `create_link` function, expect the throttle's "busy", backdate, create the 10th over HTTP, expect "full" on the next; access-log and RLS assertions

### Manual Testing Steps:

1. Create a link in a browser, copy it, open it in a private window
2. Alter one character of the token and confirm the 404
3. Fill the cap locally and confirm the 11th attempt shows "full"
4. Confirm `access_log` rows for success and for the altered token

## Performance Considerations

Every workspace load makes one indexed database read (`token_hash` is unique-indexed) plus one awaited log insert (two sequential Supabase round trips, accepted so audit rows are never dropped at this scale); this is the stateless design `infrastructure.md` recommends over per-request KV writes. Creation takes an advisory lock, which serialises only link creation across at most 10 people.

## Migration Notes

- The migration is additive except two deliberate changes to existing tables: RLS enabled (server-side service-role access, including the purge worker, is unaffected) and `access_log.link_id` made nullable.
- Apply the migration to production before deploying the new code, because the new routes call `create_link`.
- Follow-up outside this change: set `enable_signup = false` for Supabase Auth on the remote project via `supabase config push`, since the project's auth endpoint stays reachable with the anon key even though the app no longer uses it.
- Turnstile hostname outcome: accepted. The widget was created for `stopper-for-timecards.senei-web.workers.dev` and confirmed rendering and passing on the live site 2026-09-22.
- The Turnstile keys are stored with `wrangler secret put`, matching how the Supabase values are stored (the site key is public, but it is declared like the other `astro:env` server values).

## References

- Roadmap item: `context/foundation/roadmap.md` (S-01, Change ID `private-link-access`), GitHub issue #1
- PRD: `context/foundation/prd.md` (FR-007, US-02, Access Control)
- Access-log rationale: `context/foundation/infrastructure.md` (Role-Rotation Check, risk register)
- Deploy and migration flow: `context/deployment/deploy-plan.md`
- Existing helper being changed: `src/lib/access-log.ts:20-35`
- Existing schema: `supabase/migrations/20260918082739_phase_b_c_purge_and_access_log.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Link data and core

#### Automated

- [x] 1.1 Migrations apply cleanly to a fresh local database: `npx supabase db reset` — e59845d
- [x] 1.2 Database tests pass (cap boundary, RLS, execute privileges, null log link): `npx supabase test db` — e59845d
- [x] 1.3 Token unit tests pass: `npm test -- --run` — e59845d
- [x] 1.4 Linting passes: `npm run lint` — e59845d
- [x] 1.5 Type checking passes: `npx astro check` — e59845d

### Phase 2: Create and open a link

#### Automated

- [x] 2.1 Linting passes: `npm run lint` — 96a7d5b
- [x] 2.2 Type checking passes: `npx astro check` — 96a7d5b
- [x] 2.3 Unit tests pass: `npm test -- --run` — 96a7d5b
- [x] 2.4 Production build succeeds: `npm run build` — 96a7d5b
- [x] 2.5 Smoke steps (Turnstile gate, link flow, throttle, cap, access-log and RLS assertions) pass against a local preview with local Supabase: `npm run smoke` — 96a7d5b

#### Manual

- [x] 2.6 In a browser, "create my private link" lands on `/w/<token>` showing an empty workspace and the copyable link — 96a7d5b
- [x] 2.7 Opening that URL in a private window or another browser shows the same workspace with no login — 96a7d5b
- [x] 2.8 Changing one character of the token shows the 404 page, identical to a malformed token — 96a7d5b
- [x] 2.9 Returning to `/` in the browser that created the link redirects straight to the workspace — 96a7d5b
- [x] 2.10 With 10 links present (fill the first 9 with SQL and backdate their `created_at`, so the throttle does not apply), the next attempt in the browser shows the "full" message and creates nothing (check the `links` row count locally) — 96a7d5b
- [x] 2.11 `access_log` contains a `success` row for each open and a `not_found` row with a null link id for the altered token — 96a7d5b
- [x] 2.12 The landing page shows the Turnstile widget (test keys locally), and creating a link works only after it passes — 96a7d5b
- [x] 2.13 With `LINK_CREATION_CLOSED=1` in `.dev.vars`, the landing page shows the closed message, a direct `POST /api/links` redirects to it, and an existing link still opens its workspace — 96a7d5b

### Phase 3: Retire the starter auth

#### Automated

- [x] 3.1 No references to removed modules remain: a search for `auth/signin`, `api/auth`, `@supabase/ssr`, `locals.user` and `lib/supabase"` in `src/` and `scripts/` returns nothing — d2e75d4
- [x] 3.2 Linting passes: `npm run lint` — d2e75d4
- [x] 3.3 Type checking passes: `npx astro check` — d2e75d4
- [x] 3.4 Unit tests pass: `npm test -- --run` — d2e75d4
- [x] 3.5 Production build succeeds: `npm run build` — d2e75d4
- [x] 3.6 Smoke test (link flow plus 404s for removed routes) passes locally: `npm run smoke` — d2e75d4

#### Manual

- [x] 3.7 The landing page shows no Sign in / Sign up links — d2e75d4
- [x] 3.8 Visiting `/auth/signin`, `/auth/signup` and `/dashboard` shows the 404 page — d2e75d4
- [x] 3.9 After pushing the branch, both GitHub Actions jobs (`ci` and `smoke`) are green, including the new database-test step — d2e75d4

### Phase 4: Ship and verify in production

#### Automated

- [x] 4.1 The migration is applied both locally and remotely: `npx supabase migration list`
- [x] 4.2 Worker secrets `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are present: `npx wrangler secret list`

#### Manual

- [x] 4.3 The Cloudflare Builds deploy for the merge succeeds and the live site serves the new landing page
- [x] 4.4 On the live site, creating the owner's link lands on `/w/<token>`; the same URL opens in a private window
- [x] 4.5 A malformed and an altered token both show the 404 page on the live site
- [x] 4.6 The live `access_log` table holds the `success` and `not_found` rows from those checks
- [x] 4.7 Reading `links` from the live REST endpoint with the anon key returns no rows
- [x] 4.8 The Turnstile widget renders on the live landing page and a real creation succeeds, or the hostname is rejected and the outcome is written into Migration Notes
- [x] 4.9 Setting `LINK_CREATION_CLOSED` to `1` on the live Worker makes the landing page show the closed message while an existing link still opens; the secret is then deleted or left in place as you decide
