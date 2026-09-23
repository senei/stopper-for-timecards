import type { APIRoute } from "astro";
import { isWellFormedToken } from "@/lib/link-token";
import { findLinkByToken } from "@/lib/links";
import { isWellFormedId } from "@/lib/project-id";
import { deleteProject, ProjectInUseError } from "@/lib/projects";
import { ERROR_GENERIC, ERROR_PROJECT_IN_USE, STATUS_PROJECT_DELETED } from "@/lib/status-messages";

/**
 * The only way a project is actually deleted. Re-derives the link from the URL token exactly as
 * `timer/start.ts` does (well-formed check, then a database lookup) — the `projectId` in the URL
 * is never trusted as proof of ownership on its own.
 */
export const POST: APIRoute = async ({ params, redirect, rewrite }) => {
  const { token, projectId } = params;

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

  if (!isWellFormedId(projectId)) {
    return rewrite("/404");
  }

  let deleted: boolean;
  try {
    deleted = await deleteProject(link.id, projectId);
  } catch (err) {
    if (err instanceof ProjectInUseError) {
      return redirect(`/w/${token}?error=${ERROR_PROJECT_IN_USE}`, 303);
    }
    // eslint-disable-next-line no-console
    console.error("project delete failed:", err);
    return redirect(`/w/${token}?error=${ERROR_GENERIC}`, 303);
  }

  if (!deleted) {
    return rewrite("/404");
  }

  return redirect(`/w/${token}?status=${STATUS_PROJECT_DELETED}`, 303);
};

export const ALL: APIRoute = () => new Response(null, { status: 405, headers: { Allow: "POST" } });
