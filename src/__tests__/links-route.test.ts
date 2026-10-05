import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { APIContext } from "astro";
import { resolveCookieLink, setLinkCookie } from "@/lib/link-cookie";
import { countRecentLinks, createLink } from "@/lib/links";
import { SupabaseNotConfiguredError } from "@/lib/supabase-admin";
import { verifyTurnstile, type TurnstileRefusal } from "@/lib/turnstile";
import { ALL, POST } from "@/pages/api/links";

const env = vi.hoisted(() => ({ closed: undefined as string | undefined }));

vi.mock("astro:env/server", () => ({
  get LINK_CREATION_CLOSED() {
    return env.closed;
  },
  TURNSTILE_SECRET_KEY: "route-test-secret",
}));
vi.mock("@/lib/link-cookie", () => ({ resolveCookieLink: vi.fn(), setLinkCookie: vi.fn() }));
vi.mock("@/lib/links", () => ({ countRecentLinks: vi.fn(), createLink: vi.fn() }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: vi.fn() }));

const cookieLink = vi.mocked(resolveCookieLink);
const setCookie = vi.mocked(setLinkCookie);
const countLinks = vi.mocked(countRecentLinks);
const create = vi.mocked(createLink);
const verify = vi.mocked(verifyTurnstile);

const REFUSALS: TurnstileRefusal[] = ["missing_token", "missing_secret", "rejected", "unavailable", "bad_response"];

function call(form?: Record<string, string>) {
  const request = new Request("http://localhost/api/links", {
    method: "POST",
    body: new URLSearchParams(form ?? { "cf-turnstile-response": "visitor-token" }),
    headers: { "cf-connecting-ip": "203.0.113.7" },
  });
  const context = {
    request,
    cookies: {},
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as unknown as APIContext;
  return POST(context) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  env.closed = undefined;
  cookieLink.mockResolvedValue({ status: "none" });
  countLinks.mockResolvedValue(0);
  create.mockResolvedValue({ status: "created", id: "link-1", token: "new-token" });
  verify.mockResolvedValue({ ok: true });
});

// Fail-closed is a standing decision (private-link-access plan): any Turnstile verdict but an explicit `ok` must leave
// the visitor without a link, and the visitor sees one generic message whatever the reason.
describe("POST /api/links and the Turnstile verdict", () => {
  it.each(REFUSALS)("refuses with the generic message and creates nothing when the verdict is %s", async (reason) => {
    verify.mockResolvedValue({ ok: false, reason });

    const response = await call();

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/?error=verify");
    expect(countLinks).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("refuses a rejection that carries error codes in exactly the same way", async () => {
    verify.mockResolvedValue({ ok: false, reason: "rejected", errorCodes: ["timeout-or-duplicate"] });

    const response = await call();

    expect(response.headers.get("Location")).toBe("/?error=verify");
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a link, sets the cookie and opens the workspace only on an explicit ok", async () => {
    const response = await call();

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/w/new-token");
    expect(create).toHaveBeenCalledOnce();
    expect(setCookie).toHaveBeenCalledOnce();
  });

  it("hands the verifier the form's token, the visitor's IP and the configured secret", async () => {
    await call({ "cf-turnstile-response": "form-token" });

    expect(verify).toHaveBeenCalledExactlyOnceWith("form-token", "203.0.113.7", "route-test-secret");
  });

  it("hands the verifier a null token when the field is absent", async () => {
    await call({});

    expect(verify).toHaveBeenCalledExactlyOnceWith(null, "203.0.113.7", "route-test-secret");
  });

  it("still applies the creation throttle after a passing check", async () => {
    countLinks.mockResolvedValue(3);

    const response = await call();

    expect(response.headers.get("Location")).toBe("/?error=busy");
    expect(create).not.toHaveBeenCalled();
  });

  it("sends a visitor who already holds a valid link to it without spending a Turnstile check", async () => {
    cookieLink.mockResolvedValue({ status: "linked", token: "existing-token" });

    const response = await call();

    expect(response.headers.get("Location")).toBe("/w/existing-token");
    expect(verify).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("asks the cookie helper with its own route", async () => {
    await call();

    expect(cookieLink).toHaveBeenCalledExactlyOnceWith(expect.anything(), "POST /api/links");
  });

  // A failed cookie check is not "no link": creating one now could hand a returning visitor a second link and burn a slot.
  it("refuses, and creates nothing, when the cookie could not be checked", async () => {
    cookieLink.mockResolvedValue({ status: "unknown" });

    const response = await call();

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/?error=1");
    expect(verify).not.toHaveBeenCalled();
    expect(countLinks).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(setCookie).not.toHaveBeenCalled();
  });

  // A throttle count that could not be read is not "no recent links": skipping the throttle would let the sign-up through.
  it("refuses, creates nothing and logs one link_create_failed when the throttle count fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    countLinks.mockRejectedValue(new Error("recent link count returned null"));

    try {
      const response = await call();

      expect(response.status).toBe(303);
      expect(response.headers.get("Location")).toBe("/?error=1");
      expect(create).not.toHaveBeenCalled();
      expect(setCookie).not.toHaveBeenCalled();
      expect(errorSpy.mock.calls.map((args) => JSON.parse(String(args[0])) as unknown)).toMatchObject([
        { event: "link_create_failed", error: { message: "recent link count returned null" } },
      ]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it.each(["1", "true", " TRUE "])(
    "closes creation, before any Turnstile check, when the switch is %j",
    async (value) => {
      env.closed = value;

      const response = await call();

      expect(response.headers.get("Location")).toBe("/?closed=1");
      expect(verify).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("refuses every method other than POST with a 405", () => {
    const response = ALL({} as APIContext) as Response;

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });
});

// One line per outcome of the sign-up, so a drop in sign-ups, a full cap or a failing stage can be told apart in the
// logs. The created link's id is logged as soon as it exists; its token never is.
describe("POST /api/links events", () => {
  let infoSpy: MockInstance<typeof console.info>;
  let warnSpy: MockInstance<typeof console.warn>;
  let errorSpy: MockInstance<typeof console.error>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const linesOf = (spy: MockInstance<typeof console.info>) =>
    spy.mock.calls.map((args) => JSON.parse(String(args[0])) as Record<string, unknown>);
  const everyLine = () =>
    [infoSpy, warnSpy, errorSpy].flatMap((spy) => spy.mock.calls.map((args) => String(args[0]))).join("\n");

  it("writes one link_created info line with the link id, and never the token, for a created link", async () => {
    const response = await call();

    expect(response.headers.get("Location")).toBe("/w/new-token");
    expect(linesOf(infoSpy)).toEqual([
      { level: "info", event: "link_created", route: "POST /api/links", linkId: "link-1" },
    ]);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(everyLine()).not.toContain("new-token");
  });

  it("writes one link_creation_closed info line when the kill switch is on", async () => {
    env.closed = "1";

    await call();

    expect(linesOf(infoSpy)).toEqual([{ level: "info", event: "link_creation_closed", route: "POST /api/links" }]);
    expect(verify).not.toHaveBeenCalled();
  });

  it("writes one link_creation_busy warning with the count and the limit when the throttle fires", async () => {
    countLinks.mockResolvedValue(3);

    const response = await call();

    expect(response.headers.get("Location")).toBe("/?error=busy");
    expect(linesOf(warnSpy)).toEqual([
      {
        level: "warn",
        event: "link_creation_busy",
        route: "POST /api/links",
        op: "count_recent",
        detail: "3 of 3 in 10 minutes",
      },
    ]);
    expect(create).not.toHaveBeenCalled();
  });

  it("writes one link_creation_full warning when the cap is reached", async () => {
    create.mockResolvedValue({ status: "full" });

    const response = await call();

    expect(response.headers.get("Location")).toBe("/?full=1");
    expect(linesOf(warnSpy)).toEqual([
      { level: "warn", event: "link_creation_full", route: "POST /api/links", op: "create_link" },
    ]);
    expect(infoSpy).not.toHaveBeenCalled();
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("labels a failing throttle count with the count_recent stage", async () => {
    countLinks.mockRejectedValue(new Error("count down"));

    const response = await call();

    expect(response.headers.get("Location")).toBe("/?error=1");
    expect(linesOf(errorSpy)).toMatchObject([{ event: "link_create_failed", op: "count_recent" }]);
  });

  it("labels a failing create_link with its stage and has no link id to report", async () => {
    create.mockRejectedValue(new Error("create down"));

    const response = await call();

    expect(response.headers.get("Location")).toBe("/?error=1");
    const [line] = linesOf(errorSpy);
    expect(line).toMatchObject({ event: "link_create_failed", op: "create_link" });
    expect(line).not.toHaveProperty("linkId");
    expect(infoSpy).not.toHaveBeenCalled();
  });

  // The row is committed when createLink returns: a later failure must still say which link it was.
  it("keeps the created link's id on the log line when only the cookie step fails", async () => {
    setCookie.mockImplementation(() => {
      throw new Error("cookie jar broke");
    });

    const response = await call();

    expect(response.headers.get("Location")).toBe("/?error=1");
    expect(linesOf(infoSpy)).toMatchObject([{ event: "link_created", linkId: "link-1" }]);
    expect(linesOf(errorSpy)).toMatchObject([{ event: "link_create_failed", op: "set_cookie", linkId: "link-1" }]);
    expect(everyLine()).not.toContain("new-token");
  });

  it("logs a missing Supabase configuration under its own event, not as link_create_failed", async () => {
    create.mockRejectedValue(new SupabaseNotConfiguredError());

    const response = await call();

    expect(response.headers.get("Location")).toBe("/?error=1");
    const lines = linesOf(errorSpy);
    expect(lines).toMatchObject([{ event: "supabase_not_configured", op: "create_link" }]);
    expect(lines).toHaveLength(1);
  });
});
