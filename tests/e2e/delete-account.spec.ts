// risk: test-plan.md #6 - delete-all removes exactly (all and only) the requesting person's data, and cannot fire
// without the confirmation step succeeding. Facet covered here: the real-browser confirmation UX (typed-phrase gate,
// the confirm form posting under the browser's real Origin, the banner on the home page afterwards).
// The scoping rule itself is covered by src/__tests__/delete-account.integration.test.ts.
// seed: tests/e2e/seed.spec.ts
import { expect, test } from "@playwright/test";
import { admin, cleanupSeeded, hasEnv, seedPerson, seedProject } from "../../src/test/integration-db";

test.skip(!hasEnv, "needs SUPABASE_URL (a local stack) and SUPABASE_SERVICE_ROLE_KEY in .env");

// Visiting the deleted link logs a null-link access_log row that cleanupSeeded never removes. A user agent unique to
// this run makes those rows findable, so afterEach can delete them and fail the run if it cannot.
const userAgent = `e2e-delete-account-${Date.now()}`;
test.use({ userAgent });

test.afterEach(async () => {
  const { error } = await admin().from("access_log").delete().eq("user_agent", userAgent);
  expect(error).toBeNull();
  await cleanupSeeded();
});

test.describe("delete-all", () => {
  test("is blocked until DELETE is typed, then removes only the confirming person's data", async ({ page }) => {
    // Setup: two people, each with a project, so a delete-everything bug cannot pass as "all my data is gone".
    const suffix = Date.now();
    const person = await seedPerson();
    const bystander = await seedPerson();
    const ownProject = `Own project ${suffix}`;
    const otherProject = `Other project ${suffix}`;
    await seedProject(person.linkId, ownProject);
    const bystanderProjectId = await seedProject(bystander.linkId, otherProject);

    // Step: open the private link, go to the delete page.
    await page.goto(`/w/${person.token}`);
    await expect(page.getByRole("button", { name: ownProject })).toBeVisible();
    await page.getByRole("link", { name: "Delete all my data" }).click();
    await expect(page.getByRole("heading", { name: "Delete all my data" })).toBeVisible();

    // Step: the confirm button stays disabled until the exact phrase is typed.
    const confirm = page.getByRole("textbox", { name: "Type DELETE to confirm" });
    const submit = page.getByRole("button", { name: "Delete everything" });
    await expect(submit).toBeDisabled();
    await confirm.fill("delete");
    await expect(submit).toBeDisabled();
    await confirm.fill("DELETE");
    await expect(submit).toBeEnabled();

    // Step: confirm. The form posts with the browser's real Origin, which Astro's origin check must accept.
    await submit.click();
    await page.waitForURL((url) => url.pathname === "/");
    await expect(page.getByRole("status")).toHaveText("Your data and link were permanently deleted.");
    await expect(page.getByRole("button", { name: "Create my private link" })).toBeVisible();

    // Assertion: the deleted link is dead in the browser, and nothing of the bystander's was touched.
    const gone = await page.goto(`/w/${person.token}`);
    expect(gone?.status()).toBe(404);

    const { data: links, error: linksError } = await admin()
      .from("links")
      .select("id")
      .in("id", [person.linkId, bystander.linkId]);
    expect(linksError).toBeNull();
    expect(links?.map((row: { id: string }) => row.id)).toEqual([bystander.linkId]);
    const { data: projects, error: projectsError } = await admin()
      .from("projects")
      .select("id, name")
      .eq("link_id", bystander.linkId);
    expect(projectsError).toBeNull();
    expect(projects).toEqual([{ id: bystanderProjectId, name: otherProject }]);

    // Cleanup: afterEach removes the bystander (and any leftover of the deleted person); a failed delete turns the run red.
  });
});
