import type { APIRoute } from "astro";
import { LINK_CREATION_CLOSED, TURNSTILE_SECRET_KEY } from "astro:env/server";
import { isCreationClosed } from "@/lib/creation-closed";
import { resolveCookieLink, setLinkCookie } from "@/lib/link-cookie";
import { countRecentLinks, createLink } from "@/lib/links";
import { logError, logInfo, logWarn } from "@/lib/log";
import { SupabaseNotConfiguredError } from "@/lib/supabase-admin";
import { verifyTurnstile } from "@/lib/turnstile";

const ROUTE = "POST /api/links";

// At most THROTTLE_MAX_LINKS links may be created in any THROTTLE_WINDOW_MINUTES, across all visitors.
const THROTTLE_WINDOW_MINUTES = 10;
const THROTTLE_MAX_LINKS = 3;

/**
 * The only way to get a link. Checks run cheapest first: the browser's own cookie, the owner's
 * close switch, the Turnstile bot check, the creation throttle, and finally the capped database function.
 */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const cookieLink = await resolveCookieLink(cookies, ROUTE);
  if (cookieLink.status === "linked") {
    return redirect(`/w/${cookieLink.token}`, 303);
  }
  // The visitor's cookie could not be checked (already logged). Creating a link now could give them a second one.
  if (cookieLink.status === "unknown") {
    return redirect("/?error=1", 303);
  }

  if (isCreationClosed(LINK_CREATION_CLOSED)) {
    logInfo("link_creation_closed", { route: ROUTE });
    return redirect("/?closed=1", 303);
  }

  // A body that is not a form (JSON, malformed, empty) simply has no Turnstile token.
  let rawToken: FormDataEntryValue | null = null;
  try {
    rawToken = (await request.formData()).get("cf-turnstile-response");
  } catch (err) {
    // Left as null: the check below refuses it.
    logWarn("form_parse_failed", { route: ROUTE, detail: request.headers.get("content-type") ?? undefined }, err);
  }
  const turnstileToken = typeof rawToken === "string" ? rawToken : null;
  const ip = request.headers.get("cf-connecting-ip");
  // Fails closed: only an explicit `ok` continues; every refusal looks the same to the visitor (and is logged inside).
  const verdict = await verifyTurnstile(turnstileToken, ip, TURNSTILE_SECRET_KEY);
  if (!verdict.ok) {
    return redirect("/?error=verify", 303);
  }

  // Which step is running, and the created link's id once it exists, so a failure says where it happened and for whom.
  let stage: "count_recent" | "create_link" | "set_cookie" = "count_recent";
  let createdLinkId: string | undefined;
  try {
    const recentLinks = await countRecentLinks(THROTTLE_WINDOW_MINUTES);
    if (recentLinks >= THROTTLE_MAX_LINKS) {
      logWarn("link_creation_busy", {
        route: ROUTE,
        op: stage,
        detail: `${String(recentLinks)} of ${String(THROTTLE_MAX_LINKS)} in ${String(THROTTLE_WINDOW_MINUTES)} minutes`,
      });
      return redirect("/?error=busy", 303);
    }

    stage = "create_link";
    const result = await createLink();
    if (result.status === "full") {
      logWarn("link_creation_full", { route: ROUTE, op: stage });
      return redirect("/?full=1", 303);
    }

    // The row is committed: log its id now (never the token), before the cookie and redirect that can still fail.
    createdLinkId = result.id;
    logInfo("link_created", { route: ROUTE, linkId: result.id });

    stage = "set_cookie";
    setLinkCookie(cookies, result.token);
    return redirect(`/w/${result.token}`, 303);
  } catch (err) {
    const context = { route: ROUTE, op: stage, linkId: createdLinkId };
    logError(
      err instanceof SupabaseNotConfiguredError ? "supabase_not_configured" : "link_create_failed",
      context,
      err,
    );
    return redirect("/?error=1", 303);
  }
};

export const ALL: APIRoute = () => new Response(null, { status: 405, headers: { Allow: "POST" } });
