// Seed for the e2e layer. Protects test-plan risk #3: a real browser can complete open-link -> start -> stop
// through the actual UI (forms, navigation, cookies), which the HTTP smoke script cannot see because it sets
// `Origin` itself. Every generated test copies this pattern.
import { expect, test } from "@playwright/test";
import { cleanupSeeded, hasEnv, seedPerson } from "../../src/test/integration-db";

test.skip(!hasEnv, "needs SUPABASE_URL (a local stack) and SUPABASE_SERVICE_ROLE_KEY in .env");

const seededLinkIds: string[] = [];

test.beforeEach(() => {
  seededLinkIds.length = 0;
});

test.afterEach(async () => {
  await cleanupSeeded(seededLinkIds);
});

test("a private link opens a workspace where a timer starts and stops in a real browser", async ({ page }) => {
  // Setup: a direct insert, so the 10-person cap and the Turnstile check of link creation do not apply.
  const person = await seedPerson();
  seededLinkIds.push(person.linkId);
  const { token } = person;
  const project = `E2E project ${Date.now()}`;

  await page.goto(`/w/${token}`);
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();

  // Action: start tracking a new project. The form POST carries the browser's real Origin.
  await page.getByRole("textbox", { name: "New project name" }).fill(project);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByText("Currently tracking")).toBeVisible();
  await expect(page.getByText(project)).toBeVisible();

  // Assertion: the running timer survives a reload, then stopping returns to the idle workspace.
  await page.reload();
  await expect(page.getByText("Currently tracking")).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByText("Currently tracking")).toBeHidden();
  await expect(page.getByRole("button", { name: project })).toBeVisible();

  // Cleanup: afterEach removes the seeded link with its projects and time entries.
});
