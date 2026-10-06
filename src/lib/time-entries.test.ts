import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CorrectionRefusedError,
  correctEntry,
  correctionWindowStart,
  deleteEntry,
  listCorrectableEntries,
  type CorrectionRefusal,
} from "./time-entries";
import { adminOrThrow } from "./supabase-admin";

vi.mock("./supabase-admin", () => ({ adminOrThrow: vi.fn() }));

const rpc = vi.fn();

beforeEach(() => {
  rpc.mockReset();
  vi.mocked(adminOrThrow).mockReturnValue({ rpc } as unknown as ReturnType<typeof adminOrThrow>);
});

describe("correctionWindowStart", () => {
  it.each([
    { now: "2026-10-05T00:00:00.000Z", expected: "2026-10-04T00:00:00.000Z" },
    { now: "2026-10-05T23:59:59.999Z", expected: "2026-10-04T00:00:00.000Z" },
    { now: "2026-10-05T12:30:00.000Z", expected: "2026-10-04T00:00:00.000Z" },
    { now: "2026-01-01T00:00:00.000Z", expected: "2025-12-31T00:00:00.000Z" },
  ])("is yesterday 00:00 UTC for $now", ({ now, expected }) => {
    expect(correctionWindowStart(new Date(now)).toISOString()).toBe(expected);
  });
});

describe("listCorrectableEntries", () => {
  const order = vi.fn();
  const gte = vi.fn(() => ({ order }));
  const eq = vi.fn(() => ({ gte }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  beforeEach(() => {
    order.mockReset();
    gte.mockClear();
    eq.mockClear();
    select.mockClear();
    from.mockClear();
    vi.mocked(adminOrThrow).mockReturnValue({ from } as unknown as ReturnType<typeof adminOrThrow>);
  });

  const row = {
    id: "entry-1",
    project_name: "Acme",
    task: "Design",
    type: "Regular",
    work_type: "Billable",
    started_at: "2026-10-04T09:00:00Z",
    ended_at: "2026-10-04T10:00:00Z",
  };

  it("scopes the query to the link and the correction window, newest first", async () => {
    order.mockResolvedValue({ data: [], error: null });

    await listCorrectableEntries("link-1", new Date("2026-10-05T12:00:00.000Z"));

    expect(from).toHaveBeenCalledExactlyOnceWith("time_entries");
    expect(eq).toHaveBeenCalledExactlyOnceWith("link_id", "link-1");
    expect(gte).toHaveBeenCalledExactlyOnceWith("started_at", "2026-10-04T00:00:00.000Z");
    expect(order).toHaveBeenCalledExactlyOnceWith("started_at", { ascending: false });
  });

  it("maps a row to CorrectableEntry", async () => {
    order.mockResolvedValue({ data: [row], error: null });

    expect(await listCorrectableEntries("link-1")).toEqual([
      {
        id: "entry-1",
        projectName: "Acme",
        task: "Design",
        type: "Regular",
        workType: "Billable",
        startedAt: "2026-10-04T09:00:00Z",
        endedAt: "2026-10-04T10:00:00Z",
      },
    ]);
  });

  it("maps a null task and a still-open entry (null ended_at)", async () => {
    order.mockResolvedValue({ data: [{ ...row, task: null, ended_at: null }], error: null });

    const [entry] = await listCorrectableEntries("link-1");
    expect(entry).toMatchObject({ task: null, endedAt: null });
  });

  it("throws, keeping the original error as cause, when the database call fails", async () => {
    const failure = { message: "connection lost" };
    order.mockResolvedValue({ data: null, error: failure });

    const error: unknown = await listCorrectableEntries("link-1").then(
      () => undefined,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("time entry list failed: connection lost");
    expect((error as Error).cause).toBe(failure);
  });

  it.each([{ data: null }, { data: "oops" }])("throws when the data is not an array ($data)", async ({ data }) => {
    order.mockResolvedValue({ data, error: null });

    await expect(listCorrectableEntries("link-1")).rejects.toThrow("unexpected value");
  });

  it("throws when a row is missing an expected field", async () => {
    const { task, ...rest } = row;
    order.mockResolvedValue({ data: [rest], error: null });

    await expect(listCorrectableEntries("link-1")).rejects.toThrow("unexpected row");
  });
});

const REFUSALS: CorrectionRefusal[] = [
  "entry_not_found",
  "entry_running",
  "outside_window",
  "bad_range",
  "in_future",
  "overlap",
];

describe("correctEntry", () => {
  const startedAt = new Date("2026-10-04T09:00:00.000Z");
  const endedAt = new Date("2026-10-04T10:00:00.000Z");

  it("calls correct_time_entry with the ids and ISO strings", async () => {
    rpc.mockResolvedValue({
      data: [{ entry_id: "entry-1", started_at: startedAt.toISOString(), ended_at: endedAt.toISOString() }],
      error: null,
    });

    await correctEntry("link-1", "entry-1", startedAt, endedAt);

    expect(rpc).toHaveBeenCalledExactlyOnceWith("correct_time_entry", {
      p_link_id: "link-1",
      p_entry_id: "entry-1",
      p_started_at: "2026-10-04T09:00:00.000Z",
      p_ended_at: "2026-10-04T10:00:00.000Z",
    });
  });

  it("returns the corrected span, camelCased", async () => {
    rpc.mockResolvedValue({
      data: [{ entry_id: "entry-1", started_at: startedAt.toISOString(), ended_at: endedAt.toISOString() }],
      error: null,
    });

    expect(await correctEntry("link-1", "entry-1", startedAt, endedAt)).toEqual({
      entryId: "entry-1",
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
    });
  });

  it.each(REFUSALS)("maps the %s P0001 code to CorrectionRefusedError", async (reason) => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: reason } });

    const error: unknown = await correctEntry("link-1", "entry-1", startedAt, endedAt).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(CorrectionRefusedError);
    expect((error as CorrectionRefusedError).reason).toBe(reason);
  });

  it("maps an unknown P0001 message to dbError, keeping it as cause", async () => {
    const failure = { code: "P0001", message: "some_new_code" };
    rpc.mockResolvedValue({ data: null, error: failure });

    const error: unknown = await correctEntry("link-1", "entry-1", startedAt, endedAt).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );

    expect(error).not.toBeInstanceOf(CorrectionRefusedError);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).cause).toBe(failure);
  });

  it("maps a non-P0001 error to dbError, keeping it as cause", async () => {
    const failure = { code: "08006", message: "connection lost" };
    rpc.mockResolvedValue({ data: null, error: failure });

    const error: unknown = await correctEntry("link-1", "entry-1", startedAt, endedAt).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );

    expect(error).not.toBeInstanceOf(CorrectionRefusedError);
    expect((error as Error).message).toBe("correct_time_entry failed: connection lost");
    expect((error as Error).cause).toBe(failure);
  });

  it.each([{ data: null }, { data: [] }, { data: [{}] }])("throws on an unexpected value ($data)", async ({ data }) => {
    rpc.mockResolvedValue({ data, error: null });

    await expect(correctEntry("link-1", "entry-1", startedAt, endedAt)).rejects.toThrow("unexpected");
  });
});

describe("deleteEntry", () => {
  it("calls delete_time_entry with the link and entry ids", async () => {
    rpc.mockResolvedValue({ data: "entry-1", error: null });

    await deleteEntry("link-1", "entry-1");

    expect(rpc).toHaveBeenCalledExactlyOnceWith("delete_time_entry", { p_link_id: "link-1", p_entry_id: "entry-1" });
  });

  it("returns the deleted id", async () => {
    rpc.mockResolvedValue({ data: "entry-1", error: null });

    expect(await deleteEntry("link-1", "entry-1")).toBe("entry-1");
  });

  it.each(REFUSALS)("maps the %s P0001 code to CorrectionRefusedError", async (reason) => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: reason } });

    const error: unknown = await deleteEntry("link-1", "entry-1").then(
      () => undefined,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(CorrectionRefusedError);
    expect((error as CorrectionRefusedError).reason).toBe(reason);
  });

  it("maps a non-P0001 error to dbError, keeping it as cause", async () => {
    const failure = { code: "08006", message: "connection lost" };
    rpc.mockResolvedValue({ data: null, error: failure });

    const error: unknown = await deleteEntry("link-1", "entry-1").then(
      () => undefined,
      (thrown: unknown) => thrown,
    );

    expect(error).not.toBeInstanceOf(CorrectionRefusedError);
    expect((error as Error).message).toBe("delete_time_entry failed: connection lost");
    expect((error as Error).cause).toBe(failure);
  });

  it.each([{ data: null }, { data: 1 }])("throws on an unexpected value ($data)", async ({ data }) => {
    rpc.mockResolvedValue({ data, error: null });

    await expect(deleteEntry("link-1", "entry-1")).rejects.toThrow("unexpected value");
  });
});
