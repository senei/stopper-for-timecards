import type { AstroCookies } from "astro";

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
