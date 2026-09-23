import type { APIRoute } from "astro";
import { isWellFormedToken } from "@/lib/link-token";
import { findLinkByToken } from "@/lib/links";
import { isValidProjectName } from "@/lib/project-name";
import { ERROR_GENERIC, ERROR_INVALID_NAME } from "@/lib/status-messages";
import { startTimer, TimerAlreadyRunningError } from "@/lib/timer";

/**
 * The only way to start a timer. Re-derives the link from the URL token exactly as
 * `/w/[token].astro` does (well-formed check, then a database lookup) — the `stopper_link`
 * cookie is never trusted for authorization.
 */
export const POST: APIRoute = async ({ params, request, redirect, rewrite }) => {
  const { token } = params;

  // Malformed tokens never reach the database, same as the workspace page.
  if (!isWellFormedToken(token)) {
    return rewrite("/404");
  }

  let link: { id: string } | null;
  try {
    link = await findLinkByToken(token);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("link lookup failed:", err);
    return new Response(null, { status: 503 });
  }
  if (!link) {
    return rewrite("/404");
  }

  // A body that is not a form (JSON, malformed, empty) simply has no projectName.
  let rawName: FormDataEntryValue | null = null;
  try {
    rawName = (await request.formData()).get("projectName");
  } catch {
    // Left as null: the check below refuses it.
  }
  if (!isValidProjectName(rawName)) {
    return redirect(`/w/${token}?error=${ERROR_INVALID_NAME}`, 303);
  }

  try {
    await startTimer(link.id, rawName);
  } catch (err) {
    if (err instanceof TimerAlreadyRunningError) {
      // The UI shouldn't have shown the form while a timer is running — this is a race
      // backstop, not a primary path. The workspace already shows the running timer.
      return redirect(`/w/${token}`, 303);
    }
    // eslint-disable-next-line no-console
    console.error("timer start failed:", err);
    return redirect(`/w/${token}?error=${ERROR_GENERIC}`, 303);
  }

  return redirect(`/w/${token}`, 303);
};

export const ALL: APIRoute = () => new Response(null, { status: 405, headers: { Allow: "POST" } });
