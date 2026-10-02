import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import { resolveCookieLink, setLinkCookie } from "@/lib/link-cookie";
import { countRecentLinks, createLink } from "@/lib/links";
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
  cookieLink.mockResolvedValue(null);
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
    cookieLink.mockResolvedValue("existing-token");

    const response = await call();

    expect(response.headers.get("Location")).toBe("/w/existing-token");
    expect(verify).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
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
