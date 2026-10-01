import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Local secrets (app env, the service-role key the specs use to seed data) come from the gitignored .env.
// In CI the file is absent and the variables come from the job.
if (existsSync(".env")) process.loadEnvFile(".env");

// 4321 is the `astro preview` default (no port is set in astro.config.mjs).
// E2E_PORT overrides it when that port is taken on this machine.
const PORT = Number(process.env.E2E_PORT ?? 4321);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  // No auth setup project: the app has no accounts. A private link in the URL is the identity,
  // so each spec seeds its own link in the local database.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Production-like build + preview, on the port above.
    command: `npm run build && npm run preview -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Astro 7 moves `astro preview` into a background daemon when it detects an agent.
    env: { ASTRO_PREVIEW_BACKGROUND: "1" },
  },
});
