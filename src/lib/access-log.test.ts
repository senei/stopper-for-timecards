import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { logAccess } from "./access-log";
import { createAdminClient } from "./supabase-admin";

vi.mock("./supabase-admin", () => ({ createAdminClient: vi.fn() }));

const request = new Request("https://example.test/w/token", {
  headers: { "cf-connecting-ip": "1.2.3.4", "user-agent": "vitest" },
});

function clientInserting(result: unknown) {
  const insert = vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)));
  vi.mocked(createAdminClient).mockReturnValue({ from: () => ({ insert }) } as unknown as ReturnType<
    typeof createAdminClient
  >);
  return insert;
}

let errorSpy: MockInstance<typeof console.error>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function loggedLine(): Record<string, unknown> {
  expect(errorSpy).toHaveBeenCalledOnce();
  return JSON.parse(String(errorSpy.mock.calls[0][0])) as Record<string, unknown>;
}

describe("logAccess", () => {
  it("writes the access row and logs nothing on success", async () => {
    const insert = clientInserting({ error: null });

    await logAccess("link-1", request, "success");

    expect(insert).toHaveBeenCalledWith({ link_id: "link-1", ip: "1.2.3.4", user_agent: "vitest", outcome: "success" });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("logs the database code, link id and outcome when the insert returns an error, and does not throw", async () => {
    clientInserting({ error: { message: "violates foreign key", code: "23503" } });

    await expect(logAccess("link-1", request, "success")).resolves.toBeUndefined();

    expect(loggedLine()).toMatchObject({
      event: "access_log_failed",
      route: "lib/access-log",
      linkId: "link-1",
      op: "success",
      error: { message: "violates foreign key", code: "23503" },
    });
  });

  it("logs when the insert throws, and does not throw", async () => {
    clientInserting(new Error("Network connection lost."));

    await expect(logAccess(null, request, "error")).resolves.toBeUndefined();

    const line = loggedLine();
    expect(line).toMatchObject({
      event: "access_log_failed",
      op: "error",
      error: { message: "Network connection lost." },
    });
    expect(line).not.toHaveProperty("linkId");
  });

  it("returns silently when Supabase is not configured", async () => {
    vi.mocked(createAdminClient).mockReturnValue(null);

    await expect(logAccess("link-1", request, "success")).resolves.toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
