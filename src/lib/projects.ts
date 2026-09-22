import { adminOrThrow } from "./supabase-admin";

export interface Project {
  id: string;
  name: string;
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
