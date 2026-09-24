# Stopper for Timecards

A small hosted web app for tracking time across projects during the day and turning it into the weekly timesheet grid (Project / Task / Type / Work Type × Mon–Sun) that has to be submitted at week's end.

Each person uses their own private link as their identity: no accounts, no passwords, at most 10 people. Time is tracked at 15-minute precision, and entries older than 3 months are purged automatically.

Product and planning documents live in `context/`:

- `context/foundation/prd.md` - product requirements
- `context/foundation/roadmap.md` - milestones and slices (M-01: core timecard flow)
- `context/foundation/tech-stack.md`, `context/foundation/infrastructure.md` - stack and hosting decisions
- `context/deployment/deploy-plan.md` - how the first production deployment was done
- `context/changes/<change-id>/` - one folder per change in progress (plan, brief, reviews)

## Tech Stack

- [Astro](https://astro.build/) v7 (server-rendered) with [React](https://react.dev/) v19 and [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/) v4
- [Supabase](https://supabase.com/) (Postgres) for data
- [Cloudflare Workers](https://workers.cloudflare.com/) for hosting, plus a scheduled worker for the purge job (`workers/purge-job`)

## Prerequisites

- Node.js as pinned in `.nvmrc`
- npm
- Docker, for the local Supabase stack

## Getting Started

1. Install dependencies: `npm install`
2. Start the local Supabase stack: `npx supabase start`
3. Create `.env` and `.dev.vars` from `.env.example` and fill in the values printed by `npx supabase status -o env`. The server-only secrets are never exposed to the browser.
4. Run the dev server: `npm run dev`

## Scripts

- `npm run dev` - development server (Cloudflare workerd runtime)
- `npm run build` - production build
- `npm run preview` - preview the production build
- `npm run lint` / `npm run lint:fix` - ESLint
- `npm run format` - Prettier
- `npm test` - unit tests (Vitest)
- `npx supabase test db` - database (pgTAP) tests against local Supabase. Run `npx supabase db reset` first: the suite only passes on a fresh database, and `private_links.test.sql` fails once local links or timers exist.
- `npm run smoke` - smoke test against a running local server (`BASE_URL`, default `http://localhost:4321`). Local only: it creates data.
- `npm run smoke:local` - one command for the above: resets the local Supabase DB, starts the dev server with dummy Turnstile keys, runs the smoke test, then restores `.env` / `.dev.vars`. `-- --serve` keeps the server up for manual testing; `-- --dry-run` only prints the plan.

## Database

Migrations live in `supabase/migrations/`. Apply them locally with `npx supabase db reset` and to the linked remote project with `npx supabase db push`.

## Deployment

The app deploys to Cloudflare Workers, built and deployed by Cloudflare Builds on every merge to `main`. GitHub Actions only runs lint, type-check, build and the smoke test; it must not deploy. Runtime secrets are set with `npx wrangler secret put`. See `context/deployment/deploy-plan.md` for details.

## License

MIT
