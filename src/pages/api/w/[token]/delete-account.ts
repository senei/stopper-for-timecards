import type { APIRoute } from "astro";
import { clearLinkCookie, LINK_COOKIE } from "@/lib/link-cookie";
import { isWellFormedToken } from "@/lib/link-token";
import { deleteAccount, findLinkByToken } from "@/lib/links";
import { logError, logWarn } from "@/lib/log";
import { ERROR_CONFIRM_PHRASE, ERROR_GENERIC, STATUS_ACCOUNT_DELETED } from "@/lib/status-messages";

const ROUTE = "POST /api/w/[token]/delete-account";

const CONFIRM_PHRASE = "DELETE";

/**
 * The only way an account is deleted. Re-derives the link from the URL token exactly as `regenerate.ts` does, then
 * requires the typed phrase on the server too: the page only disables its button until the phrase is typed, so a
 * replayed or hand-made post without it must still delete nothing.
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

  let phrase: FormDataEntryValue | null = null;
  try {
    phrase = (await request.formData()).get("confirm");
  } catch (err) {
    // A body that is not a form counts as no phrase.
    logWarn(
      "form_parse_failed",
      { route: ROUTE, linkId: link.id, detail: request.headers.get("content-type") ?? undefined },
      err,
    );
  }
  if (typeof phrase !== "string" || phrase.trim() !== CONFIRM_PHRASE) {
    return redirect(`/w/${token}/delete-account?error=${ERROR_CONFIRM_PHRASE}`, 303);
  }

  let deleted: boolean;
  try {
    deleted = await deleteAccount(link.id);
  } catch (err) {
    logError("account_delete_failed", { route: ROUTE, linkId: link.id }, err);
    return redirect(`/w/${token}/delete-account?error=${ERROR_GENERIC}`, 303);
  }
  if (!deleted) {
    // Deleted between our lookup and the delete: the link is already gone.
    return rewrite("/404");
  }

  // Forget the remembered link only when it is the one just deleted; another link's cookie is not ours to wipe.
  if (cookies.get(LINK_COOKIE)?.value === token) {
    clearLinkCookie(cookies);
  }
  return redirect(`/?status=${STATUS_ACCOUNT_DELETED}`, 303);
};

export const ALL: APIRoute = () => new Response(null, { status: 405, headers: { Allow: "POST" } });
