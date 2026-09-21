import type { APIRoute } from "astro";
import { LINK_CREATION_CLOSED, TURNSTILE_SECRET_KEY } from "astro:env/server";
import { isCreationClosed } from "@/lib/creation-closed";
import { clearLinkCookie, LINK_COOKIE, setLinkCookie } from "@/lib/link-cookie";
import { isWellFormedToken } from "@/lib/link-token";
import { countRecentLinks, createLink, findLinkByToken } from "@/lib/links";
import { verifyTurnstile } from "@/lib/turnstile";

// At most THROTTLE_MAX_LINKS links may be created in any THROTTLE_WINDOW_MINUTES, across all visitors.
const THROTTLE_WINDOW_MINUTES = 10;
const THROTTLE_MAX_LINKS = 3;

/**
 * The only way to get a link. Checks run cheapest first: the browser's own cookie, the owner's
 * close switch, the Turnstile bot check, the creation throttle, and finally the capped database function.
 */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const cookieToken = cookies.get(LINK_COOKIE)?.value;
  if (cookieToken) {
    let stale = !isWellFormedToken(cookieToken);
    if (!stale) {
      try {
        if (await findLinkByToken(cookieToken)) {
          return redirect(`/w/${cookieToken}`, 303);
        }
        stale = true;
      } catch {
        // Database trouble: leave the cookie alone and let creation below report the problem.
      }
    }
    if (stale) {
      clearLinkCookie(cookies);
    }
  }

  if (isCreationClosed(LINK_CREATION_CLOSED)) {
    return redirect("/?closed=1", 303);
  }

  const form = await request.formData();
  const rawToken = form.get("cf-turnstile-response");
  const turnstileToken = typeof rawToken === "string" ? rawToken : null;
  const ip = request.headers.get("cf-connecting-ip");
  if (!(await verifyTurnstile(turnstileToken, ip, TURNSTILE_SECRET_KEY))) {
    return redirect("/?error=verify", 303);
  }

  try {
    if ((await countRecentLinks(THROTTLE_WINDOW_MINUTES)) >= THROTTLE_MAX_LINKS) {
      return redirect("/?error=busy", 303);
    }

    const result = await createLink();
    if (result.status === "full") {
      return redirect("/?full=1", 303);
    }

    setLinkCookie(cookies, result.token);
    return redirect(`/w/${result.token}`, 303);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("link creation failed:", err);
    return redirect("/?error=1", 303);
  }
};

export const ALL: APIRoute = () => new Response(null, { status: 405, headers: { Allow: "POST" } });
