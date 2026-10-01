# Test stack

## E2E

<!-- Written by /10x-e2e-setup. Re-run it to change this section; other skills only read it. -->

- runner: Playwright Test, @playwright/test 1.63.0
- config: playwright.config.ts
- single-spec command: npx playwright test tests/e2e/<name>.spec.ts
- full-suite command: npx playwright test
- base URL: http://localhost:4321
- port: 4321 (detected from the `astro preview` default; no port in astro.config.mjs; detected default 4321, override with E2E_PORT)
- web server command: npm run build && npm run preview -- --port 4321; reuseExistingServer outside CI
- auth setup project: none (the app has no accounts; a private link token in the URL is the identity, so each spec seeds its own link with seedPerson() from src/test/integration-db.ts, using SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env, local stack only)
- storageState: none
- seed: tests/e2e/seed.spec.ts — protects risk #3: a real browser completes open-link -> start -> stop through the actual UI, which the HTTP smoke script cannot see because it sets Origin itself
- browser CLI: playwright-cli, command skill at .claude/skills/playwright-cli/SKILL.md
- updated: 2026-10-01
