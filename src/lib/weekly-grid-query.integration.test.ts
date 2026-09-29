import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchWeekEntries } from "./weekly-grid-query";

// Integration test against the real local Supabase stack: `npm run test:integration` with SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY taken from `npx supabase status -o env` (API_URL / SERVICE_ROLE_KEY).
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Only ever run against a local stack: the test inserts and deletes rows with the service-role key.
const isLocal = url !== undefined && URL.canParse(url) && ["127.0.0.1", "localhost"].includes(new URL(url).hostname);
const hasEnv = isLocal && Boolean(serviceKey);

// UTC Monday 2026-09-21 .. Sunday 2026-09-27; the week's exclusive end is Monday 2026-09-28T00:00Z.
const WEEK_START = new Date("2026-09-21T00:00:00.000Z");

function makeAdmin() {
  return createClient(url ?? "", serviceKey ?? "", { auth: { persistSession: false } });
}

/** The `id` of a just-inserted row, checked rather than asserted so the untyped client stays lint-clean. */
function idOf(row: unknown): string {
  const id = typeof row === "object" && row !== null && "id" in row ? row.id : undefined;
  if (typeof id !== "string") throw new Error("seeded row has no string id");
  return id;
}

const title = hasEnv
  ? "fetchWeekEntries (real database)"
  : "fetchWeekEntries (real database) — skipped: set SUPABASE_URL (a local 127.0.0.1/localhost stack) and SUPABASE_SERVICE_ROLE_KEY";

describe.skipIf(!hasEnv)(title, () => {
  // Created in beforeAll, not at collection time: createClient throws on an empty URL, which would fail the run
  // instead of skipping it when the env vars are absent.
  let admin: ReturnType<typeof makeAdmin>;
  const linkIds: string[] = [];

  async function createLink(): Promise<string> {
    const { data, error } = await admin
      .from("links")
      .insert({ token_hash: `week-query-it-${randomUUID()}` })
      .select("id")
      .single();
    if (error) throw new Error(`seed link failed: ${error.message}`);
    const id = idOf(data);
    linkIds.push(id);
    return id;
  }

  async function createProject(linkId: string): Promise<string> {
    const { data, error } = await admin
      .from("projects")
      .insert({ link_id: linkId, name: "Acme" })
      .select("id")
      .single();
    if (error) throw new Error(`seed project failed: ${error.message}`);
    return idOf(data);
  }

  /** `task` doubles as a label so assertions can say which seeded entry came back. */
  async function insertEntry(
    linkId: string,
    projectId: string,
    task: string,
    startedAt: string,
    endedAt: string | null,
  ) {
    const { error } = await admin.from("time_entries").insert({
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
    admin = makeAdmin();
    linkA = await createLink();
    const projectA = await createProject(linkA);

    await insertEntry(linkA, projectA, "inside-week", "2026-09-22T09:00:00Z", "2026-09-22T10:00:00Z");
    await insertEntry(linkA, projectA, "from-prior-week", "2026-09-20T22:00:00Z", "2026-09-21T01:00:00Z");
    await insertEntry(linkA, projectA, "into-next-week", "2026-09-27T23:00:00Z", "2026-09-28T01:00:00Z");
    await insertEntry(linkA, projectA, "open-in-week", "2026-09-25T09:00:00Z", null);
    // Touch the week only at its boundaries: neither overlaps a single millisecond of it.
    await insertEntry(linkA, projectA, "ends-at-week-start", "2026-09-20T20:00:00Z", "2026-09-21T00:00:00Z");
    await insertEntry(linkA, projectA, "starts-at-week-end", "2026-09-28T00:00:00Z", "2026-09-28T01:00:00Z");

    // Another person's entry inside the same week must never appear for link A.
    const linkB = await createLink();
    const projectB = await createProject(linkB);
    await insertEntry(linkB, projectB, "other-person", "2026-09-23T09:00:00Z", "2026-09-23T10:00:00Z");
  });

  afterAll(async () => {
    for (const id of linkIds) {
      await admin.from("time_entries").delete().eq("link_id", id);
      await admin.from("projects").delete().eq("link_id", id);
      await admin.from("links").delete().eq("id", id);
    }
  });

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
