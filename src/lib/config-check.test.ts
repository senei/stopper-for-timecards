import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

type CheckSignupConfig = typeof import("./config-check").checkSignupConfig;
type Input = Parameters<CheckSignupConfig>[0];

const HEALTHY: Input = {
  route: "GET /",
  killSwitch: undefined,
  turnstileSiteKey: "healthy-site-key",
  supabaseUrl: "http://healthy-url.test",
  supabaseServiceRoleKey: "healthy-service-key",
  formShown: true,
};

let errorSpy: MockInstance<typeof console.error>;
let warnSpy: MockInstance<typeof console.warn>;
let infoSpy: MockInstance<typeof console.info>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The module remembers what it already reported, so every case loads a fresh copy: a test that reused one import would
 * see later cases pass only because an earlier one had used up the flag.
 */
async function freshCheck(): Promise<CheckSignupConfig> {
  vi.resetModules();
  return (await import("./config-check")).checkSignupConfig;
}

function lines(spy: MockInstance<typeof console.error>): Record<string, unknown>[] {
  return spy.mock.calls.map((args) => JSON.parse(String(args[0])) as Record<string, unknown>);
}

function everyLine(): string {
  return [errorSpy, warnSpy, infoSpy].flatMap((spy) => spy.mock.calls.map((args) => String(args[0]))).join("\n");
}

describe("checkSignupConfig", () => {
  it("writes nothing for a healthy configuration", async () => {
    const check = await freshCheck();

    check(HEALTHY);

    expect(everyLine()).toBe("");
  });

  describe("the kill switch", () => {
    it("warns once for an unrecognised value, and says what is accepted without echoing the value", async () => {
      const check = await freshCheck();

      check({ ...HEALTHY, killSwitch: "sentinel-kill-switch" });
      check({ ...HEALTHY, killSwitch: "sentinel-kill-switch" });

      expect(errorSpy).not.toHaveBeenCalled();
      expect(lines(warnSpy)).toEqual([
        {
          level: "warn",
          event: "creation_closed_unrecognised",
          route: "GET /",
          detail: "LINK_CREATION_CLOSED is set but not recognised, so sign-up stays open; use 1 or true to close it",
        },
      ]);
      expect(everyLine()).not.toContain("sentinel-kill-switch");
    });

    it.each(["yes", "on", "closed"])("warns for %j", async (value) => {
      const check = await freshCheck();

      check({ ...HEALTHY, killSwitch: value });

      expect(lines(warnSpy)).toMatchObject([{ event: "creation_closed_unrecognised" }]);
    });

    it.each(["1", "true", "0", "false", "off", "", undefined])("writes nothing for %j", async (value) => {
      const check = await freshCheck();

      check({ ...HEALTHY, killSwitch: value });

      expect(everyLine()).toBe("");
    });
  });

  describe("the Turnstile site key", () => {
    it("logs one error when the form is shown and the key is unset, and not again", async () => {
      const check = await freshCheck();

      check({ ...HEALTHY, turnstileSiteKey: undefined });
      check({ ...HEALTHY, turnstileSiteKey: undefined });

      expect(warnSpy).not.toHaveBeenCalled();
      expect(lines(errorSpy)).toHaveLength(1);
      expect(lines(errorSpy)[0]).toMatchObject({
        level: "error",
        event: "turnstile_site_key_missing",
        route: "GET /",
        error: { message: expect.stringContaining("TURNSTILE_SITE_KEY") as unknown },
      });
    });

    it("counts an empty key as missing", async () => {
      const check = await freshCheck();

      check({ ...HEALTHY, turnstileSiteKey: "" });

      expect(lines(errorSpy)).toMatchObject([{ event: "turnstile_site_key_missing" }]);
    });

    it("stays quiet while the form is not shown, and does not use up the flag", async () => {
      const check = await freshCheck();

      check({ ...HEALTHY, turnstileSiteKey: undefined, formShown: false });
      expect(everyLine()).toBe("");

      check({ ...HEALTHY, turnstileSiteKey: undefined, formShown: true });
      expect(lines(errorSpy)).toMatchObject([{ event: "turnstile_site_key_missing" }]);
    });
  });

  describe("the Supabase secrets", () => {
    it.each([
      { name: "the URL", input: { supabaseUrl: undefined }, detail: "SUPABASE_URL" },
      {
        name: "the service-role key",
        input: { supabaseServiceRoleKey: undefined },
        detail: "SUPABASE_SERVICE_ROLE_KEY",
      },
      { name: "an empty URL", input: { supabaseUrl: "" }, detail: "SUPABASE_URL" },
      {
        name: "both",
        input: { supabaseUrl: undefined, supabaseServiceRoleKey: undefined },
        detail: "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY",
      },
    ])("logs one error naming exactly what is missing when $name is missing", async ({ input, detail }) => {
      const check = await freshCheck();

      check({ ...HEALTHY, ...input });
      check({ ...HEALTHY, ...input });

      expect(lines(errorSpy)).toHaveLength(1);
      expect(lines(errorSpy)[0]).toMatchObject({
        level: "error",
        event: "supabase_secrets_missing",
        route: "GET /",
        detail,
      });
    });

    it("still reports when the form is not shown", async () => {
      const check = await freshCheck();

      check({ ...HEALTHY, supabaseUrl: undefined, formShown: false });

      expect(lines(errorSpy)).toMatchObject([{ event: "supabase_secrets_missing" }]);
    });
  });

  it("writes one line per problem when several are wrong at once, each with the given route", async () => {
    const check = await freshCheck();

    check({ ...HEALTHY, route: "GET /probe", killSwitch: "yes", turnstileSiteKey: undefined, supabaseUrl: undefined });

    expect(lines(warnSpy)).toMatchObject([{ event: "creation_closed_unrecognised", route: "GET /probe" }]);
    expect(lines(errorSpy).map((line) => line.event)).toEqual([
      "turnstile_site_key_missing",
      "supabase_secrets_missing",
    ]);
    expect(lines(errorSpy).every((line) => line.route === "GET /probe")).toBe(true);
  });

  // The names are enough to act on; a value could be a secret.
  it("never writes a configuration value into a line", async () => {
    const check = await freshCheck();

    check({
      route: "GET /",
      killSwitch: "sentinel-kill-switch",
      turnstileSiteKey: undefined,
      supabaseUrl: "sentinel-url",
      supabaseServiceRoleKey: "",
      formShown: true,
    });
    check({ ...HEALTHY, supabaseUrl: undefined, supabaseServiceRoleKey: "sentinel-key" });

    const text = everyLine();
    expect(text).not.toContain("sentinel-kill-switch");
    expect(text).not.toContain("sentinel-url");
    expect(text).not.toContain("sentinel-key");
    expect(text).not.toContain("healthy-site-key");
  });
});
