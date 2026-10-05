import { generateToken, hashToken } from "./link-token";
import { dbError } from "./db-error";
import { adminOrThrow } from "./supabase-admin";

export type CreateLinkResult = { status: "created"; id: string; token: string } | { status: "full" };
export type RegenerateLinkResult = { status: "regenerated"; id: string; token: string } | { status: "not_found" };

/** Creates a link through the capped database function. `full` means the 10-person cap is reached. */
export async function createLink(): Promise<CreateLinkResult> {
  const admin = adminOrThrow();
  const token = generateToken();

  const response = await admin.rpc("create_link", { p_token_hash: await hashToken(token) });
  if (response.error) {
    throw dbError("create_link", response.error);
  }

  const id: unknown = response.data;
  if (id === null) {
    return { status: "full" };
  }
  if (typeof id !== "string") {
    throw new Error("create_link returned an unexpected value");
  }
  return { status: "created", id, token };
}

/**
 * Atomically swaps `oldToken`'s link onto a freshly generated token through the database function.
 * `not_found` means `oldToken` no longer resolves to any link (already regenerated, or unknown) —
 * callers should treat this the same as `findLinkByToken` returning null.
 */
export async function regenerateLink(oldToken: string): Promise<RegenerateLinkResult> {
  const admin = adminOrThrow();
  const newToken = generateToken();

  const response = await admin.rpc("regenerate_link", {
    p_old_token_hash: await hashToken(oldToken),
    p_new_token_hash: await hashToken(newToken),
  });
  if (response.error) {
    throw dbError("regenerate_link", response.error);
  }

  const id: unknown = response.data;
  if (id === null) {
    return { status: "not_found" };
  }
  if (typeof id !== "string") {
    throw new Error("regenerate_link returned an unexpected value");
  }
  return { status: "regenerated", id, token: newToken };
}

/**
 * Permanently deletes a person's projects, time entries, access-log rows and link in one transaction through the
 * database function. `false` means no link has that id (already deleted, or never existed).
 */
export async function deleteAccount(linkId: string): Promise<boolean> {
  const admin = adminOrThrow();

  const response = await admin.rpc("delete_account", { p_link_id: linkId });
  if (response.error) {
    throw dbError("delete_account", response.error);
  }

  const deleted: unknown = response.data;
  if (typeof deleted !== "boolean") {
    throw new Error("delete_account returned an unexpected value");
  }
  return deleted;
}

/** Looks a link up by its token. Callers check the token's shape first. */
export async function findLinkByToken(token: string): Promise<{ id: string } | null> {
  const admin = adminOrThrow();

  const response = await admin
    .from("links")
    .select("id")
    .eq("token_hash", await hashToken(token))
    .maybeSingle();
  if (response.error) {
    throw dbError("link lookup", response.error);
  }

  const row: unknown = response.data;
  if (row === null) {
    return null;
  }
  if (typeof row === "object" && "id" in row && typeof row.id === "string") {
    return { id: row.id };
  }
  throw new Error("link lookup returned an unexpected row");
}

/** Counts links created in the last `windowMinutes` minutes, across all visitors. */
export async function countRecentLinks(windowMinutes: number): Promise<number> {
  const admin = adminOrThrow();
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();

  const { count, error } = await admin
    .from("links")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  if (error) {
    throw dbError("recent link count", error);
  }

  if (count === null) {
    throw new Error("recent link count returned null");
  }
  return count;
}
