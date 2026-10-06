import type { APIRoute } from "astro";
import { isWellFormedToken } from "@/lib/link-token";
import { findLinkByToken } from "@/lib/links";
import { logError, logInfo, logWarn } from "@/lib/log";
import { isWellFormedId } from "@/lib/project-id";
import {
  ERROR_ENTRY_IN_FUTURE,
  ERROR_ENTRY_OUTSIDE_WINDOW,
  ERROR_ENTRY_OVERLAP,
  ERROR_ENTRY_RANGE,
  ERROR_ENTRY_RUNNING,
  ERROR_GENERIC,
  STATUS_ENTRY_DELETED,
} from "@/lib/status-messages";
import { deleteEntry, CorrectionRefusedError, type CorrectionRefusal } from "@/lib/time-entries";

const ROUTE = "POST /api/w/[token]/entries/[entryId]/delete";

const REFUSAL_ERROR_CODE: Record<Exclude<CorrectionRefusal, "entry_not_found">, string> = {
  entry_running: ERROR_ENTRY_RUNNING,
  outside_window: ERROR_ENTRY_OUTSIDE_WINDOW,
  bad_range: ERROR_ENTRY_RANGE,
  in_future: ERROR_ENTRY_IN_FUTURE,
  overlap: ERROR_ENTRY_OVERLAP,
};

/**
 * The only way a closed entry is removed. Re-derives the link from the URL token exactly as
 * `projects/[projectId]/delete.ts` does — the `entryId` in the URL is never trusted as proof of
 * ownership on its own; `deleteEntry` is always called with the looked-up `link.id`.
 */
export const POST: APIRoute = async ({ params, redirect, rewrite }) => {
  const { token, entryId } = params;

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

  if (!isWellFormedId(entryId)) {
    return rewrite("/404");
  }

  try {
    await deleteEntry(link.id, entryId);
  } catch (err) {
    if (err instanceof CorrectionRefusedError) {
      if (err.reason === "entry_not_found") {
        return rewrite("/404");
      }
      logWarn("entry_deletion_refused", { route: ROUTE, linkId: link.id, entryId, op: err.reason });
      return redirect(`/w/${token}/corrections?error=${REFUSAL_ERROR_CODE[err.reason]}`, 303);
    }
    logError("entry_delete_failed", { route: ROUTE, linkId: link.id, entryId }, err);
    return redirect(`/w/${token}/corrections?error=${ERROR_GENERIC}`, 303);
  }

  logInfo("entry_deleted", { route: ROUTE, linkId: link.id, entryId });
  return redirect(`/w/${token}/corrections?status=${STATUS_ENTRY_DELETED}`, 303);
};

export const ALL: APIRoute = () => new Response(null, { status: 405, headers: { Allow: "POST" } });
