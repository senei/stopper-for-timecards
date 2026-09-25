import type { APIRoute } from "astro";
import { isWellFormedToken } from "@/lib/link-token";
import { findLinkByToken } from "@/lib/links";
import { ERROR_GENERIC, STATUS_TIMER_STOPPED } from "@/lib/status-messages";
import { NoActiveTimerError, stopTimer } from "@/lib/timer";

/**
 * The only way a running timer is stopped. Re-derives the link from the URL token exactly as
 * `timer/start.ts` and `timer/switch.ts` do — the `stopper_link` cookie is never trusted for
 * authorization. The request carries no fields: there is only ever one timer to stop.
 */
export const POST: APIRoute = async ({ params, redirect, rewrite }) => {
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

  try {
    await stopTimer(link.id);
  } catch (err) {
    if (err instanceof NoActiveTimerError) {
      // The UI only shows the stop form while a timer runs — this is a race backstop, not a
      // primary path. The workspace already reflects the actual state.
      return redirect(`/w/${token}`, 303);
    }
    // eslint-disable-next-line no-console
    console.error("timer stop failed:", err);
    return redirect(`/w/${token}?error=${ERROR_GENERIC}`, 303);
  }

  return redirect(`/w/${token}?status=${STATUS_TIMER_STOPPED}`, 303);
};

export const ALL: APIRoute = () => new Response(null, { status: 405, headers: { Allow: "POST" } });
