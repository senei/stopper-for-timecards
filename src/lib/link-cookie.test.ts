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
    it("returns null and touches nothing when there is no cookie", async () => {
      const { jar, del } = fakeCookies();

      expect(await resolveCookieLink(jar)).toBeNull();
      expect(findLink).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
    });

    it("clears a malformed cookie without looking it up", async () => {
      const { jar, del } = fakeCookies("not-a-token");

      expect(await resolveCookieLink(jar)).toBeNull();
      expect(findLink).not.toHaveBeenCalled();
      expect(del).toHaveBeenCalledWith("stopper_link", { path: "/" });
    });

    it("clears a well-formed cookie whose link no longer exists", async () => {
      const token = generateToken();
      findLink.mockResolvedValue(null);
      const { jar, del } = fakeCookies(token);

      expect(await resolveCookieLink(jar)).toBeNull();
      expect(findLink).toHaveBeenCalledWith(token);
      expect(del).toHaveBeenCalledWith("stopper_link", { path: "/" });
    });

    it("returns the token and keeps the cookie when the link resolves", async () => {
      const token = generateToken();
      findLink.mockResolvedValue({ id: "link-1" });
      const { jar, del } = fakeCookies(token);

      expect(await resolveCookieLink(jar)).toBe(token);
      expect(del).not.toHaveBeenCalled();
    });

    it("returns null and leaves the cookie alone when the lookup throws", async () => {
      findLink.mockRejectedValue(new Error("db down"));
      const { jar, del } = fakeCookies(generateToken());

      expect(await resolveCookieLink(jar)).toBeNull();
      expect(del).not.toHaveBeenCalled();
    });
  });
});
