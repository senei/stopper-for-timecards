# Regenerate own private link (S-07) Implementation Plan

## Overview

A person holding a valid private link can regenerate it from their own workspace page. The old
token stops resolving immediately (404 through `findLinkByToken`); a new token takes over the same
`links` row, so all of that person's projects and time entries stay intact; no other person's link
is touched. The swap is atomic, implemented as a security-definer SQL function that follows the
`create_link` / `start_timer` pattern already in the codebase.

## Current State Analysis

- `links` (migration `20260921120000_private_links.sql`) is one row per person: `id` (stable,
  referenced by `time_entries.link_id` / `access_log.link_id`) and `token_hash` (SHA-256 hex of the
  token; only the hash is stored). `create_link(p_token_hash)` is the only writer today — a
  `security definer` function, advisory-locked on a fixed key, `revoke`d from `public`/`anon`/
  `authenticated`, `grant`ed to `service_role` only.
- `start_timer(p_link_id, p_project_name)` (migration `20260922150000_projects_and_timer.sql`) is
  the second precedent for this pattern: advisory lock scoped per `link_id` (`hashtext('public.start_timer:' || p_link_id::text)`), same revoke/grant shape.
- `src/lib/links.ts` wraps `create_link` (`createLink()`) and reads by token (`findLinkByToken()`,
  used everywhere a token needs to resolve to a link). There is no regenerate path yet.
- `src/lib/link-token.ts` has `generateToken()` (32 random bytes, base64url, 43 chars) and
  `hashToken()` (SHA-256 hex) — reused as-is for the new token.
- `src/pages/w/[token].astro` (the hot file) re-derives the link from the URL token, logs every
  access via `logAccess(linkId, request, outcome)` (`AccessOutcome` = `"success" | "not_found" |
"error"`, matching the `access_log.outcome` check constraint), and renders `WorkspaceCard` with a
  `workspaceUrl` prop that is already shown, always visible, with a Copy button in a "Your private
  link" section.
- `src/pages/w/[token]/projects/[projectId]/delete.astro` +
  `src/pages/api/w/[token]/projects/[projectId]/delete.ts` is the precedent for a destructive,
  confirmed action: a GET confirmation page (re-derives the link, shows a "Confirm" / "Cancel"
  choice) posting to a sibling `/api/w/...` route that re-derives the link _again_ from the URL
  token (never trusts a cookie) and performs the real mutation.
- `src/lib/link-cookie.ts`'s `stopper_link` cookie is a convenience only — `/w/[token].astro` sets
  it "only for a browser that has none," and every mutating route re-derives authorization from the
  URL token, never the cookie.
- `src/lib/status-messages.ts` holds the `?status=` / `?error=` query-param vocabulary rendered as
  banners on the workspace page (`STATUS_PROJECT_DELETED`, `ERROR_PROJECT_IN_USE`, etc.).
- `scripts/smoke.mjs` is the end-to-end HTTP smoke suite (LOCAL ONLY, hits a real dev server + local
  Supabase); `supabase/tests/database/*.test.sql` is the pgTAP suite (`npx supabase test db`), one
  file per migration slice (`private_links.test.sql` is the direct precedent for a link-table
  function: cap/uniqueness, `throws_ok`, and `has_function_privilege` checks for anon/authenticated/
  service_role).

### Key Discoveries:

- The atomic swap only ever needs to touch `links.token_hash` — `time_entries`, `access_log`, and
  `projects` all key off `links.id`, which never changes. No FK cascades or data copies are needed.
- `AccessOutcome`'s three values (`success` / `not_found` / `error`) already fit a regenerate
  attempt exactly; no schema change to `access_log` is needed to log it.
- The workspace page's `statusMessage()` / `errorMessage()` dispatch on a query-param code that
  `[token].astro` already parses and passes to `WorkspaceCard` as `bannerStatus` /
  `bannerError` — adding a new status code needs **zero changes to `[token].astro` itself**, only a
  new constant in `status-messages.ts` and a redirect target that uses it.

## Desired End State

From the workspace page, a person can regenerate their own link. They see a confirmation step, then
land back on their workspace — now at the new link's URL — with the same projects, timer state, and
history, and a one-time confirmation banner ("Your new link is ready — save it now"). The URL bar
now holds the only place the new link is displayed (same as the existing "Your private link" Copy
box, which already always shows and lets the person copy `workspaceUrl`); nothing new needs to
persist the token beyond that page. The old URL 404s on the very next request. No other row in
`links` is touched.

**Verification**: `npm run lint`, `npx astro check`, `npm run build`, `npx supabase test db`
(pgTAP), and `npm run smoke:local` all pass.

## What We're NOT Doing

- Not changing the 10-person cap logic, the create-link flow, or `findLinkByToken`'s signature.
- Not adding a new `access_log.outcome` value — the existing three cover a regenerate attempt.
- Not building a "reveal once, then hide forever" modal or a copy-to-clipboard-and-forget flow —
  the new link is shown in the URL bar and in the existing always-visible "Your private link" box,
  exactly like a freshly created link is today. See "Open, resolved UX decision" below.
- Not touching `src/pages/w/[token].astro` — every change needed is additive elsewhere (see Key
  Discoveries); this keeps that hot, multi-lane file untouched.
- Not adding a rate limit / throttle on regeneration — out of scope for this slice; the existing
  create-link throttle is a different code path and this doesn't create new `links` rows.

## Open, resolved UX decision

The brief flagged one open, non-blocking question: what the confirm step looks like, and whether
the new link is shown once or stays visible. Resolved with the cheapest option consistent with
existing app conventions, flagged here rather than left open:

- **Confirmation**: a dedicated GET confirmation page at `/w/[token]/regenerate`, identical in
  shape to the existing delete-project confirmation page — states the consequence ("your current
  link will stop working immediately"), offers "Confirm regenerate" (POST) and "Cancel" (back to
  the workspace). No JS `confirm()` dialog; the app has no precedent for one and a full page keeps
  parity with delete-project.
- **New-link visibility**: no special one-time reveal UI. The redirect lands the browser on
  `/w/<new-token>`, which — like any workspace page — already shows the link, in full, in the
  always-visible "Your private link" input + Copy button. A status banner reminds the person to
  save it now. This matches how a freshly created link is already presented; adding a second,
  different "reveal" affordance for regeneration would be inconsistent and is not required by the
  PRD (US-02's acceptance criteria only require the old link to stop working and no one else's link
  to change).

## Implementation Approach

Three phases, database → application → coverage, so each layer is independently verifiable before
the next depends on it:

1. **Database**: a `regenerate_link(p_old_token_hash, p_new_token_hash)` security-definer function,
   advisory-locked per link id (found by the old hash), that does the atomic swap and returns the
   link id (or `null` if the old token doesn't resolve — mirroring `create_link`'s `null`-for-
   failure convention). Covered by pgTAP.
2. **Application**: `regenerateLink()` in `src/lib/links.ts`, a confirmation page, and an API route
   that re-derives the link from the URL token (never the cookie), calls the DB function, updates
   the `stopper_link` cookie to the new token, and logs the attempt via `logAccess()`. A small,
   additive "Regenerate link" affordance in `WorkspaceCard.astro`.
3. **Coverage**: extend `scripts/smoke.mjs` with an end-to-end regenerate flow against the real
   local stack, run after the existing checks so it doesn't disturb their cookie/link-state
   assumptions.

## Phase 1: Database — atomic token swap

### Overview

Add the `regenerate_link` SQL function following the `create_link` / `start_timer` precedent
exactly (security definer, advisory lock, revoke-then-grant-to-service_role), plus its pgTAP
coverage.

### Changes Required:

#### 1. Migration: atomic regenerate function

**File**: `supabase/migrations/20260926120000_regenerate_link.sql` (new; `20260926…` is this lane's
assigned prefix per `context/foundation/parallel-goals.md`)

**Intent**: Atomically swap a link's `token_hash` from an old value to a new one, keyed by looking
the row up by its _old_ hash first. Returns the link's stable `id` on success so the caller can log
against it; returns `null` when the old hash doesn't resolve to any row (already regenerated,
mistyped, or never existed) — same "null means the caller's precondition failed" convention as
`create_link`'s cap-reached `null`.

**Contract**: `regenerate_link(p_old_token_hash text, p_new_token_hash text) returns uuid`,
`language plpgsql security definer set search_path = public`. `revoke ... from public, anon,
authenticated; grant execute ... to service_role;` — identical shape to `create_link` /
`start_timer`.

Concurrency: the advisory lock must be scoped by the _link id_, not the old hash, so it serializes
with the same key space `start_timer` already uses for that link
(`hashtext('public.regenerate_link:' || v_id::text)`) — not strictly required for correctness here
(a second concurrent regenerate naturally loses because its `where token_hash = p_old_token_hash`
no longer matches after the first commits), but the lock is cheap, keeps the pattern consistent
with the other two functions, and closes the narrow window between the initial lookup and the
update:

```sql
create or replace function regenerate_link(p_old_token_hash text, p_new_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.links where token_hash = p_old_token_hash;
  if v_id is null then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtext('public.regenerate_link:' || v_id::text));

  update public.links
     set token_hash = p_new_token_hash
   where id = v_id and token_hash = p_old_token_hash
   returning id into v_id;

  return v_id; -- null if a concurrent regenerate already won between the lookup and the lock
end;
$$;

revoke execute on function regenerate_link(text, text) from public, anon, authenticated;
grant execute on function regenerate_link(text, text) to service_role;
```

A `p_new_token_hash` collision with an existing row's `token_hash` (astronomically unlikely — 43
base64url chars of 256-bit randomness) surfaces as the `token_hash` unique-constraint violation and
propagates as a thrown error, same as an equivalent collision would in `create_link`; neither
function retries, by design (see the same reasoning in `create_link`'s existing code).

#### 2. pgTAP coverage

**File**: `supabase/tests/database/regenerate_link.test.sql` (new)

**Intent**: Cover the swap's atomicity and scope, following `private_links.test.sql`'s structure
(plan count, direct `select`s against the function, `has_function_privilege` grant checks).

**Contract**: One `plan(N)` pgTAP file, transactional (`begin` / `rollback`), asserting:

- regenerating a valid token returns the link's `id` and updates `token_hash` to the new value;
- the **old** `token_hash` no longer matches any row after regeneration (the precondition
  `findLinkByToken` relies on for its 404);
- a second `links` row (a different person) is untouched — same `id` and `token_hash` before/after;
- that person's `projects` and `time_entries` rows (keyed by `link_id`, unaffected by the swap) are
  still readable and unchanged in count;
- regenerating an unknown/already-superseded old hash returns `null` and changes no row;
- `has_function_privilege` is `false` for `anon` and `authenticated`, `true` for `service_role`, on
  `public.regenerate_link(text, text)` — mirroring `private_links.test.sql`'s three privilege
  assertions for `create_link`.

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` applies the new migration cleanly
- `npx supabase test db` passes, including the new `regenerate_link.test.sql`

---

## Phase 2: Application — confirm, swap, cookie, UI

### Overview

Wire the confirm → swap → redirect flow through the existing patterns: a lib wrapper, a GET
confirmation page, a POST API route, a cookie update, an access-log call, and a small additive UI
affordance.

### Changes Required:

#### 1. Lib wrapper

**File**: `src/lib/links.ts`

**Intent**: Add `regenerateLink(oldToken)`, generating the new token/hash and calling the new RPC,
mirroring `createLink()`'s shape (generate token client-side, hash it, call the RPC, interpret
`null` as a named failure state rather than throwing).

**Contract**:

```ts
export type RegenerateLinkResult = { status: "regenerated"; id: string; token: string } | { status: "not_found" };

export async function regenerateLink(oldToken: string): Promise<RegenerateLinkResult>;
```

Calls `admin.rpc("regenerate_link", { p_old_token_hash: await hashToken(oldToken), p_new_token_hash: await hashToken(newToken) })` where `newToken = generateToken()`; `data === null` →
`{ status: "not_found" }`; otherwise `{ status: "regenerated", id: data, token: newToken }`. Same
error-shape handling as `createLink()` (throw on `response.error` or an unexpected `data` type).

#### 2. Status message

**File**: `src/lib/status-messages.ts`

**Intent**: Add the banner text shown after a successful regeneration, reminding the person to save
the new link, following the existing `STATUS_PROJECT_DELETED` pattern.

**Contract**: `export const STATUS_LINK_REGENERATED = "link-regenerated";` added to the `messages`
map in `statusMessage()` with text along the lines of "Your link was regenerated — save the new one
now.". No changes to `errorMessage()`; a failed regeneration reuses `ERROR_GENERIC`.

#### 3. Confirmation page

**File**: `src/pages/w/[token]/regenerate.astro` (new)

**Intent**: GET confirmation step, structurally identical to
`src/pages/w/[token]/projects/[projectId]/delete.astro`: re-derive the link from the URL token
(malformed → `Astro.rewrite("/404")`, lookup failure → 503 unavailable state, no link → 404), then
show a "Confirm regenerate" / "Cancel" choice. States the consequence plainly: the current link
will stop working immediately once confirmed.

**Contract**: Same headers as `delete.astro` (`Referrer-Policy: strict-origin`,
`Cache-Control: no-store`, `X-Robots-Tag: noindex`) — the token must stay out of caches/referrers
here too. `confirmAction = /api/w/${token}/regenerate`; `cancelUrl = /w/${token}`.

#### 4. API route

**File**: `src/pages/api/w/[token]/regenerate.ts` (new)

**Intent**: The only way a link is actually regenerated. Re-derive the link from the URL token
exactly as `timer/start.ts` / `projects/[projectId]/delete.ts` do — the `stopper_link` cookie is
never trusted for authorization, only updated as a side effect of success.

**Contract**: `POST` only (`ALL` → 405, `Allow: POST`, same as the other API routes).

1. Malformed token → `rewrite("/404")`.
2. `findLinkByToken` lookup failure → `503`.
3. No link → `rewrite("/404")`.
4. Call `regenerateLink(token)`.
   - Throws → `logAccess(link.id, request, "error")`, redirect to `/w/${token}?error=${ERROR_GENERIC}`, 303.
   - `{ status: "not_found" }` (the old token was superseded between the lookup and the swap —
     a race backstop, not a primary path) → `logAccess(link.id, request, "not_found")`,
     `rewrite("/404")`.
   - `{ status: "regenerated", token: newToken }` → `logAccess(link.id, request, "success")`,
     `setLinkCookie(cookies, newToken)` (unconditionally — unlike the passive "only if the browser
     has none" rule in `[token].astro`, this is the person's own explicit action on their own
     session, so the cookie should follow immediately), redirect to
     `/w/${newToken}?status=${STATUS_LINK_REGENERATED}`, 303.

#### 5. Workspace UI affordance

**File**: `src/components/WorkspaceCard.astro`

**Intent**: Add a "Regenerate link" action next to the existing "Your private link" Copy control,
linking to the new confirmation page — additive to the existing "Your private link" block, no
change to any existing prop or behavior.

**Contract**: A new `<a href={`/w/${token}/regenerate`}>` styled with the same `buttonVariants({
variant: "secondary" })` treatment already used for the project "Delete" link, placed under the
link input row (e.g. as a second row of actions in that block). `token` is already a prop on
`WorkspaceCard`; no new props needed. `src/pages/w/[token].astro` itself needs **no changes** — it
already passes `token`, and the new `status=link-regenerated` banner is rendered through the
existing `statusMessage()` plumbing it already calls.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npx astro check` passes
- `npm run build` passes

#### Manual Verification:

- Open a workspace, click "Regenerate link", see the confirmation page, confirm, land back on a
  new `/w/<token>` URL with a "your link was regenerated" banner and the same projects/timer state
- The old URL returns a 404 on the next request
- A second, unrelated workspace's link is unaffected throughout

---

## Phase 3: Coverage — smoke check

### Overview

Extend the existing local smoke suite with an end-to-end regenerate flow, placed after all existing
checks so it doesn't disturb their `stopper_link` cookie / link-state assumptions (regenerating
changes the cookie and invalidates the token those checks close over).

### Changes Required:

#### 1. Smoke steps

**File**: `scripts/smoke.mjs`

**Intent**: Prove, over real HTTP against a freshly reset local database, that: the confirmation
page opens; regenerating redirects to a new workspace URL; the old token 404s immediately
afterward (including on a second regenerate attempt); the swap does not create a new `links` row;
the person's `projects` and `time_entries` row counts are unchanged; and another person's link
(`otherToken`, already created earlier in the file) is unaffected.

**Contract**: Appended inside the existing `hasServiceAccess` block, after its last check (the
`SMOKE_ANON_KEY` RLS check), using the same `request()` / `rest()` / `check()` helpers already
defined in the file. No new helpers needed.

### Success Criteria:

#### Automated Verification:

- `npm run smoke:local` passes (includes the new regenerate steps)

---

## Testing Strategy

### Unit Tests:

- None beyond what's covered by pgTAP + smoke — this codebase's convention (see `private_links.test.sql`, `switch_timer.test.sql`) puts database-function correctness in pgTAP, not Vitest; `link-token.test.ts` already covers `generateToken`/`hashToken`/`isWellFormedToken` and needs no changes since neither is modified.

### Integration Tests (pgTAP):

- Atomic swap correctness, old-hash invalidation, cross-person isolation, `null`-on-unknown-hash, and grant checks — see Phase 1.

### Manual Testing Steps:

1. Create a link, start a timer, add a couple of projects.
2. Click "Regenerate link" → confirm.
3. Verify the new workspace URL shows the same projects/timer and a "regenerated" banner.
4. Revisit the old URL → 404.
5. Open a second, unrelated link → confirm it still works normally.

## Performance Considerations

None — single-row update under an advisory lock, same cost profile as `create_link`/`start_timer`.

## Migration Notes

No backfill needed; this is a new function, not a schema change. No changes to `links`' column
shapes.

## References

- Precedent pattern: `supabase/migrations/20260921120000_private_links.sql` (`create_link`)
- Precedent pattern: `supabase/migrations/20260922150000_projects_and_timer.sql` (`start_timer`)
- Precedent pgTAP: `supabase/tests/database/private_links.test.sql`
- Precedent confirm-then-mutate flow: `src/pages/w/[token]/projects/[projectId]/delete.astro` +
  `src/pages/api/w/[token]/projects/[projectId]/delete.ts`
- `src/lib/links.ts`, `src/lib/link-token.ts`, `src/lib/link-cookie.ts`, `src/lib/access-log.ts`
- `context/foundation/prd.md` FR-007, US-02
- `context/foundation/roadmap.md` S-07

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Database — atomic token swap

#### Automated

- [x] 1.1 `npx supabase db reset` applies the new migration cleanly — 3d4d9d0
- [x] 1.2 `npx supabase test db` passes, including the new `regenerate_link.test.sql` — 3d4d9d0

### Phase 2: Application — confirm, swap, cookie, UI

#### Automated

- [x] 2.1 `npm run lint` passes — b0c9625
- [x] 2.2 `npx astro check` passes — b0c9625
- [x] 2.3 `npm run build` passes — b0c9625

#### Manual

- [x] 2.4 Regenerate from the UI lands on a new URL with a banner and the same projects/timer state — f402976
- [x] 2.5 The old URL 404s on the next request — f402976
- [x] 2.6 A second, unrelated workspace's link is unaffected throughout — f402976

### Phase 3: Coverage — smoke check

#### Automated

- [x] 3.1 `npm run smoke:local` passes (includes the new regenerate steps) — 19cfd5f
