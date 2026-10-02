import type { AstroCookies } from "astro";
import { isWellFormedToken } from "./link-token";
import { findLinkByToken } from "./links";
import { logError } from "./log";

/** Convenience cookie that remembers a browser's link. The path token stays authoritative. */
export const LINK_COOKIE = "stopper_link";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function setLinkCookie(cookies: AstroCookies, token: string): void {
  cookies.set(LINK_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: import.meta.env.PROD,
    maxAge: ONE_YEAR_SECONDS,
  });
}

export function clearLinkCookie(cookies: AstroCookies): void {
  cookies.delete(LINK_COOKIE, { path: "/" });
}

/**
 * The token in the browser's link cookie, when it still resolves to a link. A stale cookie
 * (malformed, or its link no longer exists) is cleared. If the lookup itself fails the cookie is
 * left alone and the browser counts as having no link, so the caller can carry on.
 */
export async function resolveCookieLink(cookies: AstroCookies): Promise<string | null> {
  const token = cookies.get(LINK_COOKIE)?.value;
  if (!token) {
    return null;
  }

  if (isWellFormedToken(token)) {
    try {
      if (await findLinkByToken(token)) {
        return token;
      }
    } catch (err) {
      logError("cookie_link_lookup_failed", { route: "lib/link-cookie" }, err);
      return null;
    }
  }

  clearLinkCookie(cookies);
  return null;
}
