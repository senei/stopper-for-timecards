import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { AstroCookies } from "astro";
import { generateToken } from "./link-token";
import { findLinkByToken } from "./links";
import { LINK_COOKIE, resolveCookieLink, setLinkCookie } from "./link-cookie";

vi.mock("./links", () => ({ findLinkByToken: vi.fn() }));

const findLink = vi.mocked(findLinkByToken);

/** Minimal in-test cookie jar: only the get/set/delete calls the module makes. */
function fakeCookies(initial?: string) {
  const get = vi.fn((name: string) => (name === LINK_COOKIE && initial !== undefined ? { value: initial } : undefined));
  const set = vi.fn();
  const del = vi.fn();
  return { jar: { get, set, delete: del } as unknown as AstroCookies, set, del };
}

beforeEach(() => {
  findLink.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("link cookie — documents current behavior (oracle is the code comment, not a PRD line)", () => {
  describe("setLinkCookie", () => {
    it.each([
      { prod: true, secure: true },
      { prod: false, secure: false },
    ])("sets stopper_link with the expected flags (PROD=$prod -> secure=$secure)", ({ prod, secure }) => {
      vi.stubEnv("PROD", prod);
      const { jar, set } = fakeCookies();
      const token = generateToken();

      setLinkCookie(jar, token);

      expect(set).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledWith("stopper_link", token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure,
        maxAge: 31_536_000, // one year in seconds
      });
    });
  });

  describe("resolveCookieLink", () => {
    const ROUTE = "GET /";

    it("is none, and touches nothing, when there is no cookie", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { jar, del } = fakeCookies();

      expect(await resolveCookieLink(jar, ROUTE)).toEqual({ status: "none" });
      expect(findLink).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("clears a malformed cookie without looking it up, and says why", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { jar, del } = fakeCookies("not-a-token");

      expect(await resolveCookieLink(jar, ROUTE)).toEqual({ status: "none" });
      expect(findLink).not.toHaveBeenCalled();
      expect(del).toHaveBeenCalledWith("stopper_link", { path: "/" });
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(JSON.parse(warnSpy.mock.calls[0]?.[0] as string)).toMatchObject({
        level: "warn",
        event: "cookie_stale",
        route: ROUTE,
        detail: "malformed",
      });
    });

    it("clears a well-formed cookie whose link no longer exists, and says why", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const token = generateToken();
      findLink.mockResolvedValue(null);
      const { jar, del } = fakeCookies(token);

      expect(await resolveCookieLink(jar, ROUTE)).toEqual({ status: "none" });
      expect(findLink).toHaveBeenCalledWith(token);
      expect(del).toHaveBeenCalledWith("stopper_link", { path: "/" });
      expect(warnSpy).toHaveBeenCalledOnce();
      const line = warnSpy.mock.calls[0]?.[0] as string;
      expect(JSON.parse(line)).toMatchObject({ event: "cookie_stale", route: ROUTE, detail: "not_found" });
      expect(line).not.toContain(token);
    });

    it("is linked, and keeps the cookie, when the link resolves", async () => {
      const token = generateToken();
      findLink.mockResolvedValue({ id: "link-1" });
      const { jar, del } = fakeCookies(token);

      expect(await resolveCookieLink(jar, ROUTE)).toEqual({ status: "linked", token });
      expect(del).not.toHaveBeenCalled();
    });

    it("is unknown, not none, and leaves the cookie alone when the lookup throws", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      findLink.mockRejectedValue(new Error("db down"));
      const token = generateToken();
      const { jar, del } = fakeCookies(token);

      expect(await resolveCookieLink(jar, "POST /api/links")).toEqual({ status: "unknown" });
      expect(del).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();

      // The failure is logged with the caller's route and the error, and never with the cookie's token.
      expect(errorSpy).toHaveBeenCalledOnce();
      const line = errorSpy.mock.calls[0]?.[0] as string;
      expect(JSON.parse(line)).toMatchObject({
        event: "cookie_link_lookup_failed",
        route: "POST /api/links",
        error: { message: "db down" },
      });
      expect(line).not.toContain(token);
    });
  });
});
