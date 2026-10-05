import { beforeEach, describe, expect, it, vi } from "vitest";
import { countRecentLinks, deleteAccount } from "./links";
import { adminOrThrow } from "./supabase-admin";

vi.mock("./supabase-admin", () => ({ adminOrThrow: vi.fn() }));

const rpc = vi.fn();

beforeEach(() => {
  rpc.mockReset();
  vi.mocked(adminOrThrow).mockReturnValue({ rpc } as unknown as ReturnType<typeof adminOrThrow>);
});

// The wrapper's contract, from the SQL function it calls (a boolean: true when the person was deleted, false when no link
// has that id) and from its own doc comment: an irreversible action must never report success on an error.
describe("deleteAccount", () => {
  it("calls the delete_account function with the link id", async () => {
    rpc.mockResolvedValue({ data: true, error: null });

    await deleteAccount("link-1");

    expect(rpc).toHaveBeenCalledExactlyOnceWith("delete_account", { p_link_id: "link-1" });
  });

  it.each([true, false])("returns the function's answer as it is (%s)", async (answer) => {
    rpc.mockResolvedValue({ data: answer, error: null });

    expect(await deleteAccount("link-1")).toBe(answer);
  });

  it("throws, and does not report a result, when the database call fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "connection lost" } });

    await expect(deleteAccount("link-1")).rejects.toThrow("delete_account failed: connection lost");
  });

  it.each([{ answer: null }, { answer: "true" }, { answer: 1 }])(
    "throws when the function answers with something other than a boolean ($answer)",
    async ({ answer }) => {
      rpc.mockResolvedValue({ data: answer, error: null });

      await expect(deleteAccount("link-1")).rejects.toThrow("unexpected value");
    },
  );

  it("throws, and does not report a result, when Supabase is not configured", async () => {
    vi.mocked(adminOrThrow).mockImplementation(() => {
      throw new Error("Supabase is not configured");
    });

    await expect(deleteAccount("link-1")).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});

// The creation throttle reads this count: a missing count must be an error, not "zero recent links", or the throttle
// would be skipped.
describe("countRecentLinks", () => {
  const gte = vi.fn();

  beforeEach(() => {
    gte.mockReset();
    const admin = { from: () => ({ select: () => ({ gte }) }) };
    vi.mocked(adminOrThrow).mockReturnValue(admin as unknown as ReturnType<typeof adminOrThrow>);
  });

  it.each([0, 3])("returns the count as it is (%s)", async (count) => {
    gte.mockResolvedValue({ count, error: null });

    expect(await countRecentLinks(10)).toBe(count);
  });

  it("throws, keeping the original error as cause, when the database call fails", async () => {
    const failure = { message: "connection lost" };
    gte.mockResolvedValue({ count: null, error: failure });

    const error: unknown = await countRecentLinks(10).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("recent link count failed: connection lost");
    expect((error as Error).cause).toBe(failure);
  });

  it("throws, and does not report zero, when the count is null", async () => {
    gte.mockResolvedValue({ count: null, error: null });

    await expect(countRecentLinks(10)).rejects.toThrow("recent link count returned null");
  });
});
