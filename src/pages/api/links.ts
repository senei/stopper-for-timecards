import type { APIRoute } from "astro";
import { LINK_CREATION_CLOSED, TURNSTILE_SECRET_KEY } from "astro:env/server";
import { isCreationClosed } from "@/lib/creation-closed";
import { resolveCookieLink, setLinkCookie } from "@/lib/link-cookie";
import { countRecentLinks, createLink } from "@/lib/links";
import { verifyTurnstile } from "@/lib/turnstile";

// At most THROTTLE_MAX_LINKS links may be created in any THROTTLE_WINDOW_MINUTES, across all visitors.
const THROTTLE_WINDOW_MINUTES = 10;
const THROTTLE_MAX_LINKS = 3;

/**
 * The only way to get a link. Checks run cheapest first: the browser's own cookie, the owner's
 * close switch, the Turnstile bot check, the creation throttle, and finally the capped database function.
 */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const linkedToken = await resolveCookieLink(cookies);
  if (linkedToken) {
    return redirect(`/w/${linkedToken}`, 303);
  }

  if (isCreationClosed(LINK_CREATION_CLOSED)) {
    return redirect("/?closed=1", 303);
  }

  // A body that is not a form (JSON, malformed, empty) simply has no Turnstile token.
  let rawToken: FormDataEntryValue | null = null;
  try {
    rawToken = (await request.formData()).get("cf-turnstile-response");
  } catch {
    // Left as null: the check below refuses it.
  }
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
