import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupSeeded, hasEnv, integrationTitle, seedPerson, seedProject } from "../test/integration-db";
import { fetchWeekEntries } from "./weekly-grid-query";

// UTC Monday 2026-09-21 .. Sunday 2026-09-27; the week's exclusive end is Monday 2026-09-28T00:00Z.
const WEEK_START = new Date("2026-09-21T00:00:00.000Z");

describe.skipIf(!hasEnv)(integrationTitle("fetchWeekEntries (real database)"), () => {
  /** `task` doubles as a label so assertions can say which seeded entry came back. */
  async function insertEntry(
    linkId: string,
    projectId: string,
    task: string,
    startedAt: string,
    endedAt: string | null,
  ) {
    const { error } = await admin().from("time_entries").insert({
      link_id: linkId,
      project_id: projectId,
      project_name: "Acme",
      task,
      started_at: startedAt,
      ended_at: endedAt,
    });
    if (error) throw new Error(`seed entry failed: ${error.message}`);
  }

  let linkA = "";

  beforeAll(async () => {
    linkA = (await seedPerson()).linkId;
    const projectA = await seedProject(linkA, "Acme");

    await insertEntry(linkA, projectA, "inside-week", "2026-09-22T09:00:00Z", "2026-09-22T10:00:00Z");
    await insertEntry(linkA, projectA, "from-prior-week", "2026-09-20T22:00:00Z", "2026-09-21T01:00:00Z");
    await insertEntry(linkA, projectA, "into-next-week", "2026-09-27T23:00:00Z", "2026-09-28T01:00:00Z");
    await insertEntry(linkA, projectA, "open-in-week", "2026-09-25T09:00:00Z", null);
    // Touch the week only at its boundaries: neither overlaps a single millisecond of it.
    await insertEntry(linkA, projectA, "ends-at-week-start", "2026-09-20T20:00:00Z", "2026-09-21T00:00:00Z");
    await insertEntry(linkA, projectA, "starts-at-week-end", "2026-09-28T00:00:00Z", "2026-09-28T01:00:00Z");

    // Another person's entry inside the same week must never appear for link A.
    const linkB = (await seedPerson()).linkId;
    const projectB = await seedProject(linkB, "Acme");
    await insertEntry(linkB, projectB, "other-person", "2026-09-23T09:00:00Z", "2026-09-23T10:00:00Z");
  });

  afterAll(cleanupSeeded);

  it("returns exactly the entries that overlap the UTC week, ordered by start time", async () => {
    const entries = await fetchWeekEntries(linkA, WEEK_START);

    // Ordered by started_at: Sun 22:00 (prior week), Tue 09:00, Thu 09:00 (open), Sun 23:00.
    expect(entries.map((entry) => entry.task)).toEqual([
      "from-prior-week",
      "inside-week",
      "open-in-week",
      "into-next-week",
    ]);
  });

  it("keeps the open entry's null end and maps the row shape buildWeeklyGrid consumes", async () => {
    const entries = await fetchWeekEntries(linkA, WEEK_START);
    const open = entries.find((entry) => entry.task === "open-in-week");

    expect(open).toMatchObject({ projectName: "Acme", endedAt: null });
    expect(new Date(open?.startedAt ?? "").toISOString()).toBe("2026-09-25T09:00:00.000Z");
  });

  it("never returns another person's entries", async () => {
    const entries = await fetchWeekEntries(linkA, WEEK_START);

    expect(entries.some((entry) => entry.task === "other-person")).toBe(false);
  });
});
