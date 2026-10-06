import { expect, test } from "@playwright/test";
import { cleanupSeeded, hasEnv, seedPerson, seedProject, seedTimeEntry } from "../../src/test/integration-db";

test.skip(!hasEnv, "needs SUPABASE_URL (a local stack) and SUPABASE_SERVICE_ROLE_KEY in .env");

const seededLinkIds: string[] = [];

test.beforeEach(() => {
  seededLinkIds.length = 0;
});

test.afterEach(async () => {
  await cleanupSeeded(seededLinkIds);
});

function correctionTimes() {
  const anchor = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 60_000);
  const firstStartedAt = new Date(anchor.getTime() - 120 * 60_000);
  const firstEndedAt = new Date(anchor.getTime() - 90 * 60_000);
  const secondStartedAt = new Date(anchor.getTime() - 60 * 60_000);
  const secondEndedAt = new Date(anchor.getTime() - 30 * 60_000);

  return {
    firstStartedAt,
    firstEndedAt,
    correctedEnd: new Date(firstEndedAt.getTime() + 15 * 60_000),
    overlapEnd: new Date(secondStartedAt.getTime() + 15 * 60_000),
    secondStartedAt,
    secondEndedAt,
    runningStartedAt: anchor,
  };
}

function inputValue(value: Date): string {
  return value.toISOString().slice(0, 16);
}

function clockValue(value: Date): string {
  return value.toISOString().slice(11, 16);
}

async function seedScenario() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const person = await seedPerson();
  seededLinkIds.push(person.linkId);
  const bystander = await seedPerson();
  seededLinkIds.push(bystander.linkId);
  const firstProjectName = `Correction first ${suffix}`;
  const secondProjectName = `Correction second ${suffix}`;
  const runningProjectName = `Correction running ${suffix}`;
  const bystanderProjectName = `Bystander correction ${suffix}`;
  const firstProjectId = await seedProject(person.linkId, firstProjectName);
  const secondProjectId = await seedProject(person.linkId, secondProjectName);
  const runningProjectId = await seedProject(person.linkId, runningProjectName);
  const bystanderProjectId = await seedProject(bystander.linkId, bystanderProjectName);
  const times = correctionTimes();
  const firstEntryId = await seedTimeEntry(
    person.linkId,
    firstProjectId,
    firstProjectName,
    times.firstStartedAt,
    times.firstEndedAt,
  );
  await seedTimeEntry(person.linkId, secondProjectId, secondProjectName, times.secondStartedAt, times.secondEndedAt);
  await seedTimeEntry(person.linkId, runningProjectId, runningProjectName, times.runningStartedAt, null);
  const bystanderEntryId = await seedTimeEntry(
    bystander.linkId,
    bystanderProjectId,
    bystanderProjectName,
    times.firstStartedAt,
    times.firstEndedAt,
  );

  return {
    person,
    bystander,
    firstProjectName,
    secondProjectName,
    runningProjectName,
    bystanderProjectName,
    firstEntryId,
    bystanderEntryId,
    times,
  };
}

test("lists only the person's entries and keeps the running entry read-only", async ({ page }) => {
  const scenario = await seedScenario();

  await page.goto(`/w/${scenario.person.token}/corrections`);

  await expect(page.getByRole("heading", { name: "Corrections" })).toBeVisible();
  await expect(page.getByText(scenario.firstProjectName)).toBeVisible();
  await expect(page.getByText(scenario.secondProjectName)).toBeVisible();
  await expect(page.getByText(scenario.bystanderProjectName)).toHaveCount(0);
  await expect(page.getByText(scenario.runningProjectName)).toBeVisible();
  await expect(
    page.getByText(
      `Running since ${clockValue(scenario.times.runningStartedAt)} UTC — stop the timer first to correct it`,
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Start (UTC)")).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Delete" })).toHaveCount(2);

  const foreignEntryResponse = await page.goto(
    `/w/${scenario.person.token}/corrections/${scenario.bystanderEntryId}/delete`,
  );
  expect(foreignEntryResponse?.status()).toBe(404);
});

test("corrects an entry through a real browser form and preserves the new time after reload", async ({ page }) => {
  const scenario = await seedScenario();
  const firstEntry = page.getByRole("listitem").filter({ hasText: scenario.firstProjectName });

  await page.goto(`/w/${scenario.person.token}/corrections`);
  await firstEntry.getByLabel("End (UTC)").fill(inputValue(scenario.times.correctedEnd));
  await firstEntry.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL(/status=entry-corrected/);
  await expect(page.getByRole("status")).toHaveText("Entry corrected.");
  await page.reload();
  await expect(
    page.getByRole("listitem").filter({ hasText: scenario.firstProjectName }).getByLabel("End (UTC)"),
  ).toHaveValue(inputValue(scenario.times.correctedEnd));
});

test("refuses overlapping, future, and non-positive times without changing the entry", async ({ page }) => {
  const scenario = await seedScenario();
  const firstEntry = page.getByRole("listitem").filter({ hasText: scenario.firstProjectName });

  await page.goto(`/w/${scenario.person.token}/corrections`);
  await firstEntry.getByLabel("End (UTC)").fill(inputValue(scenario.times.overlapEnd));
  await firstEntry.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "That time overlaps another entry or the running timer. Shorten the other one first.",
  );
  await expect(
    page.getByRole("listitem").filter({ hasText: scenario.firstProjectName }).getByLabel("End (UTC)"),
  ).toHaveValue(inputValue(scenario.times.firstEndedAt));

  const futureEnd = new Date(Date.now() + 30 * 60_000);
  const firstEntryAfterOverlap = page.getByRole("listitem").filter({ hasText: scenario.firstProjectName });
  await firstEntryAfterOverlap.getByLabel("End (UTC)").fill(inputValue(futureEnd));
  await firstEntryAfterOverlap.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toHaveText("The end can't be in the future.");

  const firstEntryAfterFutureRefusal = page.getByRole("listitem").filter({ hasText: scenario.firstProjectName });
  await firstEntryAfterFutureRefusal.getByLabel("End (UTC)").fill(inputValue(scenario.times.firstStartedAt));
  await firstEntryAfterFutureRefusal.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toHaveText("The end must be after the start.");
  await expect(
    page.getByRole("listitem").filter({ hasText: scenario.firstProjectName }).getByLabel("End (UTC)"),
  ).toHaveValue(inputValue(scenario.times.firstEndedAt));
});

test("confirms deletion, removes only the selected entry, and preserves a bystander's entry", async ({ page }) => {
  const scenario = await seedScenario();

  await page.goto(`/w/${scenario.person.token}/corrections`);
  await page
    .getByRole("listitem")
    .filter({ hasText: scenario.firstProjectName })
    .getByRole("link", { name: "Delete" })
    .click();
  await expect(page.getByRole("heading", { name: "Delete this entry?" })).toBeVisible();
  await expect(page.getByText("This can't be undone.")).toBeVisible();
  await page.getByRole("button", { name: "Confirm delete" }).click();

  await expect(page).toHaveURL(/status=entry-deleted/);
  await expect(page.getByRole("status")).toHaveText("Entry deleted.");
  await expect(page.getByText(scenario.firstProjectName)).toHaveCount(0);
  await page.goto(`/w/${scenario.bystander.token}/corrections`);
  await expect(page.getByText(scenario.bystanderProjectName)).toBeVisible();
});

test("canceling the delete confirmation leaves the entry intact", async ({ page }) => {
  const scenario = await seedScenario();

  await page.goto(`/w/${scenario.person.token}/corrections`);
  await page
    .getByRole("listitem")
    .filter({ hasText: scenario.firstProjectName })
    .getByRole("link", { name: "Delete" })
    .click();
  await page.getByRole("link", { name: "Cancel" }).click();

  await expect(page).toHaveURL(new RegExp(`/w/${scenario.person.token}/corrections$`));
  await expect(page.getByText(scenario.firstProjectName)).toBeVisible();
  await page.reload();
  await expect(page.getByText(scenario.firstProjectName)).toBeVisible();
});
