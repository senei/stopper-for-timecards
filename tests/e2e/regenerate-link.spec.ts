// risk: test-plan.md #4 - holding a link is the only way to see someone's data, and regenerating a link invalidates the
// old one immediately. Facet covered here: the real-browser regenerate flow (confirm page, form POST under the
// browser's real Origin, redirect to the new URL with a banner, the same projects and running timer).
// Also closes the manual rows 2.4-2.6 of context/changes/link-regeneration/plan.md.
// seed: tests/e2e/seed.spec.ts
import { expect, test } from "@playwright/test";
import { admin, cleanupSeeded, hasEnv, seedPerson, seedProject } from "../../src/test/integration-db";

test.skip(!hasEnv, "needs SUPABASE_URL (a local stack) and SUPABASE_SERVICE_ROLE_KEY in .env");

// Visiting the old link after regenerating logs a null-link access_log row that cleanupSeeded never removes. A user
// agent unique to this run makes those rows findable, so afterEach can delete them and fail the run if it cannot.
const userAgent = `e2e-regenerate-link-${Date.now()}`;
test.use({ userAgent });

const seededLinkIds: string[] = [];

test.beforeEach(() => {
  seededLinkIds.length = 0;
});

test.afterEach(async () => {
  const { error } = await admin().from("access_log").delete().eq("user_agent", userAgent);
  expect(error).toBeNull();
  await cleanupSeeded(seededLinkIds);
});

test.describe("regenerate link", () => {
  test("moves the same workspace to a new URL, kills the old one and leaves other people alone", async ({
    page,
    browser,
  }) => {
    // Setup: two people with their own projects; the second must be unaffected throughout.
    const suffix = Date.now();
    const person = await seedPerson();
    seededLinkIds.push(person.linkId);
    const bystander = await seedPerson();
    seededLinkIds.push(bystander.linkId);
    const ownProject = `Own project ${suffix}`;
    const otherProject = `Other project ${suffix}`;
    await seedProject(person.linkId, ownProject);
    await seedProject(bystander.linkId, otherProject);

    // Step: open the private link and start a timer, so there is state that must survive the regeneration.
    await page.goto(`/w/${person.token}`);
    await page.getByRole("button", { name: ownProject }).click();
    await expect(page.getByText("Currently tracking")).toBeVisible();
    await expect(page.getByText(ownProject)).toBeVisible();

    // Step: go through the confirm page and regenerate. The form posts with the browser's real Origin.
    await page.getByRole("link", { name: "Regenerate" }).click();
    await expect(page.getByRole("heading", { name: "Regenerate your link" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm regenerate" }).click();

    // Assertion (2.4): a new URL, a banner, and the same project and running timer.
    await page.waitForURL((url) => url.pathname.startsWith("/w/") && !url.pathname.includes(person.token));
    await expect(page.getByRole("status").filter({ hasText: "Your link was regenerated" })).toBeVisible();
    await expect(page.getByText("Currently tracking")).toBeVisible();
    await expect(page.getByText(ownProject)).toBeVisible();

    // Assertion (2.5): the old URL is dead in a browser that holds no cookie for it.
    const baseURL = test.info().project.use.baseURL;
    const stranger = await browser.newContext({ baseURL, userAgent });
    const old = await (await stranger.newPage()).goto(`/w/${person.token}`);
    expect(old?.status()).toBe(404);
    await stranger.close();

    // Assertion (2.6): the other person's link still opens their own workspace.
    const other = await browser.newContext({ baseURL, userAgent });
    const otherPage = await other.newPage();
    await otherPage.goto(`/w/${bystander.token}`);
    await expect(otherPage.getByRole("button", { name: otherProject })).toBeVisible();
    await other.close();

    // Cleanup: afterEach removes both people (a regenerated link keeps its id) and the null-link log rows.
  });
});
