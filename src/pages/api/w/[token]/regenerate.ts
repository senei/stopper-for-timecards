import type { APIRoute } from "astro";
import { logAccess } from "@/lib/access-log";
import { setLinkCookie } from "@/lib/link-cookie";
import { isWellFormedToken } from "@/lib/link-token";
import { findLinkByToken, regenerateLink } from "@/lib/links";
import { logError } from "@/lib/log";
import { ERROR_GENERIC, STATUS_LINK_REGENERATED } from "@/lib/status-messages";

const ROUTE = "POST /api/w/[token]/regenerate";

/**
 * The only way a link is actually regenerated. Re-derives the link from the URL token exactly as
 * `timer/start.ts` / `projects/[projectId]/delete.ts` do — the `stopper_link` cookie is never
 * trusted for authorization, only updated as a side effect of success.
 */
export const POST: APIRoute = async ({ params, request, cookies, redirect, rewrite }) => {
  const { token } = params;

  // Malformed tokens never reach the database, same as the workspace page.
  if (!isWellFormedToken(token)) {
    return rewrite("/404");
  }

  let link: { id: string } | null;
  try {
    link = await findLinkByToken(token);
  } catch (err) {
    logError("link_lookup_failed", { route: ROUTE }, err);
    return new Response(null, { status: 503 });
  }
  if (!link) {
    return rewrite("/404");
  }

  try {
    const result = await regenerateLink(token);
    if (result.status === "not_found") {
      // The token was superseded (or vanished) between our lookup and the swap — a race
      // backstop, not a primary path.
      await logAccess(link.id, request, "not_found");
      return await rewrite("/404");
    }

    await logAccess(link.id, request, "success");
    // Unlike the passive "only if the browser has none" rule on the workspace page, this is the
    // person's own explicit action on their own session, so the cookie follows immediately.
    setLinkCookie(cookies, result.token);
    return redirect(`/w/${result.token}?status=${STATUS_LINK_REGENERATED}`, 303);
  } catch (err) {
    await logAccess(link.id, request, "error");
    logError("link_regenerate_failed", { route: ROUTE, linkId: link.id }, err);
    return redirect(`/w/${token}?error=${ERROR_GENERIC}`, 303);
  }
};

export const ALL: APIRoute = () => new Response(null, { status: 405, headers: { Allow: "POST" } });
