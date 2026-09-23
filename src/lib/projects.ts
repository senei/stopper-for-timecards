import { adminOrThrow } from "./supabase-admin";

export interface Project {
  id: string;
  name: string;
}

/** Thrown when a delete hits the projects->time_entries FK (`23503`): the project has logged time. */
export class ProjectInUseError extends Error {
  constructor() {
    super("This project has logged time and can't be deleted");
    this.name = "ProjectInUseError";
  }
}

/** A link's projects, ordered by name, for the pick list. */
export async function listProjects(linkId: string): Promise<Project[]> {
  const admin = adminOrThrow();

  const response = await admin
    .from("projects")
    .select("id, name")
    .eq("link_id", linkId)
    .order("name", { ascending: true });
  if (response.error) {
    throw new Error(`project list failed: ${response.error.message}`);
  }

  const rows: unknown = response.data;
  if (!Array.isArray(rows)) {
    throw new Error("project list returned an unexpected value");
  }

  return rows.map((row: unknown) => {
    if (
      typeof row === "object" &&
      row !== null &&
      "id" in row &&
      typeof row.id === "string" &&
      "name" in row &&
      typeof row.name === "string"
    ) {
      return { id: row.id, name: row.name };
    }
    throw new Error("project list returned an unexpected row");
  });
}

/** A single link-owned project by id, or `null` if it doesn't exist or belongs to another link. */
export async function getProject(linkId: string, projectId: string): Promise<Project | null> {
  const admin = adminOrThrow();

  const response = await admin
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .eq("link_id", linkId)
    .maybeSingle();
  if (response.error) {
    throw new Error(`project lookup failed: ${response.error.message}`);
  }

  const row: unknown = response.data;
  if (row === null) {
    return null;
  }
  if (
    typeof row === "object" &&
    "id" in row &&
    typeof row.id === "string" &&
    "name" in row &&
    typeof row.name === "string"
  ) {
    return { id: row.id, name: row.name };
  }
  throw new Error("project lookup returned an unexpected row");
}

/**
 * Deletes a link-owned project, returning whether a row was actually removed. A `projectId`
 * that doesn't exist or belongs to another link removes zero rows (returns `false`) rather than
 * erroring. `ProjectInUseError` means the project has logged time against it (`23503`).
 */
export async function deleteProject(linkId: string, projectId: string): Promise<boolean> {
  const admin = adminOrThrow();

  const response = await admin.from("projects").delete().eq("id", projectId).eq("link_id", linkId).select("id");
  if (response.error) {
    if (response.error.code === "23503") {
      throw new ProjectInUseError();
    }
    throw new Error(`deleteProject failed: ${response.error.message}`);
  }

  return response.data.length > 0;
}
