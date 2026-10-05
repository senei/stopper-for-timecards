import { describe, expect, it, vi } from "vitest";
import { adminOrThrow, createAdminClient, SupabaseNotConfiguredError } from "./supabase-admin";

vi.mock("astro:env/server", () => ({ SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined }));

// A caller that must tell "Supabase is not configured" from a database failure can do so by type, not by message text.
describe("adminOrThrow without Supabase configuration", () => {
  it("throws a SupabaseNotConfiguredError, which is still an Error with the old message", () => {
    let thrown: unknown;
    try {
      adminOrThrow();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(SupabaseNotConfiguredError);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("Supabase is not configured");
    expect((thrown as Error).name).toBe("SupabaseNotConfiguredError");
  });

  it("leaves createAdminClient returning null", () => {
    expect(createAdminClient()).toBeNull();
  });
});
