import { afterAll, describe, expect, it } from "vitest";
import {
  admin,
  cleanupSeeded,
  hasEnv,
  integrationTitle,
  seedPerson,
  seedProject,
  seedTimeEntry,
} from "../test/integration-db";
import { CorrectionRefusedError, correctEntry, deleteEntry, listCorrectableEntries } from "./time-entries";
import { fetchWeekEntries } from "./weekly-grid-query";
import { buildWeeklyGrid } from "./weekly-grid";

const MS_PER_DAY = 86_400_000;

/** The UTC Monday 00:00:00.000 of the week containing `d`, matching `fetchWeekEntries`'/`buildWeeklyGrid`'s week start. */
function mondayStartUtc(d: Date): Date {
  const utcMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  return new Date(utcMidnight - daysSinceMonday * MS_PER_DAY);
}

// Oracle: the plan's Phase 2 contract — the two RPC wrappers stay link-scoped end to end, the list query stays
// link- and window-scoped, and a correction's new span is what the weekly grid actually rounds from.
describe.skipIf(!hasEnv)(integrationTitle("time-entries wrappers (real database)"), () => {
  afterAll(cleanupSeeded);

  it("corrects a person's own closed entry, then deletes it", async () => {
    const { linkId } = await seedPerson();
    const projectId = await seedProject(linkId, "Acme");
    const startedAt = new Date(Date.now() - 2 * 60 * 60_000);
    const endedAt = new Date(Date.now() - 60 * 60_000);
    const entryId = await seedTimeEntry(linkId, projectId, "Acme", startedAt, endedAt);

    const newStartedAt = new Date(startedAt.getTime() - 10 * 60_000);
    const corrected = await correctEntry(linkId, entryId, newStartedAt, endedAt);
    expect(corrected.entryId).toBe(entryId);
    expect(new Date(corrected.startedAt).getTime()).toBe(newStartedAt.getTime());
    expect(new Date(corrected.endedAt).getTime()).toBe(endedAt.getTime());

    expect(await deleteEntry(linkId, entryId)).toBe(entryId);

    const { data, error } = await admin().from("time_entries").select("id").eq("id", entryId);
    if (error) throw new Error(error.message);
    expect(data).toEqual([]);
  });

  it("refuses the other person's link id with entry_not_found, and leaves the row unchanged", async () => {
    const owner = await seedPerson();
    const ownerProjectId = await seedProject(owner.linkId, "Acme");
    const stranger = await seedPerson();

    const startedAt = new Date(Date.now() - 2 * 60 * 60_000);
    const endedAt = new Date(Date.now() - 60 * 60_000);
    const entryId = await seedTimeEntry(owner.linkId, ownerProjectId, "Acme", startedAt, endedAt);

    await expect(correctEntry(stranger.linkId, entryId, startedAt, endedAt)).rejects.toThrow(CorrectionRefusedError);
    await expect(deleteEntry(stranger.linkId, entryId)).rejects.toThrow(CorrectionRefusedError);

    const { data, error } = await admin()
      .from("time_entries")
      .select("started_at, ended_at")
      .eq("id", entryId)
      .single();
    if (error) throw new Error(error.message);
    const row: unknown = data;
    if (
      typeof row !== "object" ||
      row === null ||
      !("started_at" in row) ||
      typeof row.started_at !== "string" ||
      !("ended_at" in row) ||
      typeof row.ended_at !== "string"
    ) {
      throw new Error("seeded row has unexpected shape");
    }
    expect(new Date(row.started_at).getTime()).toBe(startedAt.getTime());
    expect(new Date(row.ended_at).getTime()).toBe(endedAt.getTime());
  });

  it("refuses a correction that would overlap another of the person's own entries", async () => {
    const { linkId } = await seedPerson();
    const projectId = await seedProject(linkId, "Acme");

    const earlyStart = new Date(Date.now() - 4 * 60 * 60_000);
    const earlyEnd = new Date(Date.now() - 3 * 60 * 60_000);
    await seedTimeEntry(linkId, projectId, "Acme", earlyStart, earlyEnd);

    const lateStart = new Date(Date.now() - 2 * 60 * 60_000);
    const lateEnd = new Date(Date.now() - 60 * 60_000);
    const lateEntryId = await seedTimeEntry(linkId, projectId, "Acme", lateStart, lateEnd);

    await expect(correctEntry(linkId, lateEntryId, earlyStart, earlyEnd)).rejects.toThrow(CorrectionRefusedError);
  });

  it("lists only the person's own in-window entries, newest first", async () => {
    const owner = await seedPerson();
    const ownerProjectId = await seedProject(owner.linkId, "Acme");
    const other = await seedPerson();
    const otherProjectId = await seedProject(other.linkId, "Acme");

    const older = new Date(Date.now() - 3 * 60 * 60_000);
    const olderEnd = new Date(Date.now() - 2 * 60 * 60_000);
    const olderId = await seedTimeEntry(owner.linkId, ownerProjectId, "Acme", older, olderEnd);

    const newer = new Date(Date.now() - 60 * 60_000);
    const newerEnd = new Date(Date.now() - 30 * 60_000);
    const newerId = await seedTimeEntry(owner.linkId, ownerProjectId, "Acme", newer, newerEnd);

    // Outside the correction window (more than a day ago): must never appear.
    const tooOld = new Date(Date.now() - 2 * 24 * 60 * 60_000);
    const tooOldEnd = new Date(Date.now() - 2 * 24 * 60 * 60_000 + 60_000);
    await seedTimeEntry(owner.linkId, ownerProjectId, "Acme", tooOld, tooOldEnd);

    // Another person's in-window entry: must never appear for the owner.
    await seedTimeEntry(other.linkId, otherProjectId, "Acme", newer, newerEnd);

    const entries = await listCorrectableEntries(owner.linkId);

    expect(entries.map((e) => e.id)).toEqual([newerId, olderId]);
  });

  it("a correction that moves an entry's end across a 15-minute boundary changes the rounded weekly-grid cell", async () => {
    const { linkId } = await seedPerson();
    const projectId = await seedProject(linkId, "Acme");

    // Inside the correction window (well within the last day) and inside the current UTC week, so both the
    // window check and the weekly grid agree on where this entry lands.
    const now = new Date();
    const weekStart = mondayStartUtc(now);
    const startedAt = new Date(now.getTime() - 90 * 60_000);
    const originalEnd = new Date(startedAt.getTime() + 50 * 60_000); // 50 min -> rounds up to 60.
    const entryId = await seedTimeEntry(linkId, projectId, "Acme", startedAt, originalEnd);
    const dayIndex = Math.floor((startedAt.getTime() - weekStart.getTime()) / MS_PER_DAY);

    const before = buildWeeklyGrid(await fetchWeekEntries(linkId, weekStart), weekStart, now);
    expect(before[0]?.dailyMinutes[dayIndex]).toBe(60);

    const correctedEnd = new Date(startedAt.getTime() + 65 * 60_000); // 65 min -> rounds up to 75, crossing the next step.
    await correctEntry(linkId, entryId, startedAt, correctedEnd);

    const after = buildWeeklyGrid(await fetchWeekEntries(linkId, weekStart), weekStart, now);
    expect(after[0]?.dailyMinutes[dayIndex]).toBe(75);
  });
});
