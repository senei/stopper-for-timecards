import type { AstroCookies } from "astro";
import { isWellFormedToken } from "./link-token";
import { findLinkByToken } from "./links";
import { logError, logWarn } from "./log";

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
 * What the browser's link cookie says: it `linked` to a link that still exists, there is `none` (no cookie, or a stale
 * one that was cleared), or we cannot tell (`unknown`, the lookup itself failed). `unknown` is not "none": a caller
 * must never treat an outage as the absence of a link, for example by offering to create a second one.
 */
export type CookieLink = { status: "linked"; token: string } | { status: "none" } | { status: "unknown" };

/**
 * Resolves the browser's link cookie. A stale cookie (malformed, or its link no longer exists) is cleared and reported
 * as a `cookie_stale` warning. If the lookup fails the cookie is left alone, the failure is logged and the result is
 * `unknown`. `route` is the caller's route template, so a log line says who asked.
 */
export async function resolveCookieLink(cookies: AstroCookies, route: string): Promise<CookieLink> {
  const token = cookies.get(LINK_COOKIE)?.value;
  if (!token) {
    return { status: "none" };
  }

  let reason = "malformed";
  if (isWellFormedToken(token)) {
    try {
      if (await findLinkByToken(token)) {
        return { status: "linked", token };
      }
    } catch (err) {
      logError("cookie_link_lookup_failed", { route }, err);
      return { status: "unknown" };
    }
    reason = "not_found";
  }

  logWarn("cookie_stale", { route, detail: reason });
  clearLinkCookie(cookies);
  return { status: "none" };
}
