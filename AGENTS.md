# Repository Guidelines

A modern Astro v7 + React starter with server-first rendering, deployed to Cloudflare Workers. TypeScript strict mode and ESLint type checking are enforced in CI.

## Build, Test, and Development Commands

See `@CLAUDE.md` for all build, test, lint, and format commands.

## Project Structure

```
src/
├── pages/          # Astro page routes; api/ contains serverless endpoint handlers
├── components/     # React (.tsx) and Astro (.astro) components
├── layouts/        # Astro layouts
├── lib/            # Utility functions and libraries
├── __tests__/      # Unit tests
└── styles/         # Global Tailwind CSS
```

TypeScript paths: `@/*` resolves to `./src/*`.

## Coding Standards & Tooling

- **TypeScript strict mode** enforced by `@typescript-eslint/strict-type-checked` rules.
- **ESLint rules**: Unused variables not allowed (prefix with `_` to exempt). Avoid `any` and ensure type-safe expressions.
- Config references: `@.prettierrc.json` (Prettier), `@eslint.config.js` (ESLint flat config).
- **Lint-staged + husky** run ESLint on staged `.ts` / `.tsx` / `.astro` files before commit.

## Testing

Tests live in `src/__tests__/` and run with `npm run test`. Vitest is the test runner (uses happy-dom for DOM simulation). Run a single test file with `npm run test -- <path-to-file>`.

## Deployment & Secrets

- Deployment target: Cloudflare Workers via `@astrojs/cloudflare` adapter.
- Environment variables are server-only (declared in `astro.config.mjs` via `astro:env` schema, never exposed to the client).
- `.env` file required for local dev; copy from `.env.example` and add Supabase credentials.
- Smoke tests (`npm run smoke`) verify the auth flow; set `BASE_URL` to test against a running server.

## CI Gate

GitHub Actions on push/PR to master:
1. `npm run lint` — Must pass.
2. `astro check` — TypeScript validation.
3. `npm run build` — Production build must succeed.
4. Smoke test job runs the auth flow against a local Supabase instance.

## API Endpoints

Serverless handlers live in `src/pages/api/`. Follow Astro's route conventions: `/api/auth/signin.ts` becomes a POST endpoint at `/api/auth/signin`. Each handler receives `context` with request, cookies, and environment variables.
