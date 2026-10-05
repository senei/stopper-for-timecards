# Config as wrong, not off — Plan Brief

> Full plan: `context/changes/config-as-wrong-not-off/plan.md`
> Audit (frame and research): `context/audits/observability/2026-10-05_verify-landing-signup.md` (S5, S6, S10, F15) and `context/audits/observability/2026-10-05_landing-signup.md`

## What & Why

Wrong or missing configuration is read as "off" and degrades silently on the sign-up path: `LINK_CREATION_CLOSED=yes` leaves sign-up open, a missing `TURNSTILE_SITE_KEY` renders a widget that never challenges (every visitor sees "Verification failed"), and missing Supabase secrets show only after a visitor has solved the challenge. This change makes each of the three visible in the logs with one line, once per isolate, and changes nothing a visitor sees. It implements S5, S6, S10 and the logging half of F15.

## Starting Point

`isCreationClosed` accepts only `1` and `true`; `index.astro` renders the widget whatever the site key is; every secret is `optional: true`; `GET /` without a cookie never touches the database. The Turnstile secret already has an error line (`turnstile_secret_missing`); the site key and the Supabase secrets do not.

## Desired End State

On the first page view of a misconfigured deploy the logs show `creation_closed_unrecognised` (warn), `turnstile_site_key_missing` (error) or `supabase_secrets_missing` (error, naming the variables, never values), each at most once per isolate. A healthy deploy writes nothing. Every response, redirect, cookie and accepted value is exactly what it is today.

## Key Decisions Made

| Decision                                     | Choice                                                                                                                  | Why (1 sentence)                                                                                                            | Source                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Accepted closed values                       | Unchanged (`1`, `true`); `yes`, `on`, `closed` stay open and are reported                                               | Widening the set would change visitor-facing behaviour; the audit offers "warn, or accept more".                            | Plan (user confirmed)       |
| Recognised open values                       | Unset, empty, `0`, `false`, `no`, `off` are quiet; any other non-empty value warns                                      | A deliberate "off" must not raise a false alarm.                                                                            | Plan (default, unconfirmed) |
| Missing site key                             | Log an error only; the form still renders                                                                               | Hiding or replacing the form is a visitor-facing change and a product call.                                                 | Plan (user confirmed)       |
| Site key checked only when the form is shown | `formShown = !unavailable && !full && !closed`                                                                          | A closed or full page does not need the key.                                                                                | Plan (default, unconfirmed) |
| Once per instance                            | Module-level `Set` of event names in the helper, not in `log.ts`                                                        | The logger has no dedupe; on Workers the flag lives for one isolate, so expect a few lines per isolate, not one per deploy. | Plan (default, unconfirmed) |
| Where it runs                                | One helper `checkSignupConfig`, called from the `GET /` render only, after `closed`, `full` and `unavailable` are known | The values are in hand there, it fires before any challenge, and the POST route stays untouched.                            | Plan (default, unconfirmed) |
| Event names and levels                       | `creation_closed_unrecognised` warn; `turnstile_site_key_missing` and `supabase_secrets_missing` error                  | Sign-up stays up with a bad kill switch (warn); the other two break sign-up (error), like `turnstile_secret_missing`.       | Plan (default, unconfirmed) |
| Values in lines                              | Names only, never a configuration value                                                                                 | Secrets must not reach logs; `LogContext` has no value field.                                                               | Plan (default, unconfirmed) |
| Supabase scope                               | Check `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only                                                               | They are what `createAdminClient` reads; `SUPABASE_KEY` is unused in `src`.                                                 | Plan (default, unconfirmed) |
| Schema                                       | `optional: true` stays in `astro.config.mjs`                                                                            | Required secrets would break builds and previews without them; only the logging half of F15 is done.                        | Plan (default, unconfirmed) |
| access_log silent return (F10)               | Out of scope                                                                                                            | It is a separate open finding; the render check already reveals missing secrets.                                            | Plan (default, unconfirmed) |

## Scope

**In scope:** a three-state `classifyKillSwitch`, `src/lib/config-check.ts`, the call in `index.astro`, unit tests.

**Out of scope:** changing accepted values, hiding the form, required secrets, F10, the POST route, the Turnstile secret at render time, S8, S11, N1, the purge worker.

## Architecture / Approach

Pure pieces first with unit tests and no callers (phase 1): the classifier next to `isCreationClosed`, and a helper that takes its inputs as arguments (like `verifyTurnstile`), keeps a per-isolate set of events already written and never throws. Then one call from `index.astro` (phase 2), plus full lint, `astro check` and a manual run with each variable broken in turn.

## Phases at a Glance

| Phase                                 | What it delivers                                                                                | Key risk                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1. Classifier and configuration check | `classifyKillSwitch`, `checkSignupConfig`, unit tests incl. once-per-isolate and no-value rules | Tests must load the helper fresh per case or the flag hides failures |
| 2. Check on render                    | The call in `index.astro`, lint, `astro check`, manual check with the dev server                | The page has no unit test, so the manual rows are the proof          |

**Prerequisites:** none beyond the repo; the phase 2 manual rows need the dev server and a `.dev.vars` to edit.
**Estimated effort:** about 1 session across 2 phases.

## Open Risks & Assumptions

- Per-isolate means each new isolate logs again; a few repeated lines per day are expected and are not a rate.
- A broken deploy shows the line only after someone loads `/`; Workers has no startup hook to log earlier.
- `LINK_CREATION_CLOSED=yes` still leaves sign-up open: the owner learns it from the warn, not from a changed behaviour (pending the user's answer on widening).
- The kill-switch value is not in the line, so the operator must read the dashboard to see what was set.

## Success Criteria (Summary)

- Each of the three misconfigurations writes one clear line on the first page view, and a healthy deploy writes none.
- No visitor-facing response, redirect, cookie or accepted value changes.
- No line contains a configuration value.
