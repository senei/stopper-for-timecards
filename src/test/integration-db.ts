import { createClient } from "@supabase/supabase-js";
import { generateToken, hashToken } from "../lib/link-token";

// Shared setup for the opt-in integration tests against the real local Supabase stack: `npm run test:integration`
// with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY taken from `npx supabase status -o env` (API_URL / SERVICE_ROLE_KEY).
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Only ever run against a local stack: the tests insert and delete rows with the service-role key.
const isLocal = url !== undefined && URL.canParse(url) && ["127.0.0.1", "localhost"].includes(new URL(url).hostname);

export const hasEnv = isLocal && Boolean(serviceKey);

/** A `describe` title that says why the suite was skipped when the local stack is not configured. */
export function integrationTitle(name: string): string {
  return hasEnv
    ? name
    : `${name} — skipped: set SUPABASE_URL (a local 127.0.0.1/localhost stack) and SUPABASE_SERVICE_ROLE_KEY`;
}

export function makeAdmin() {
  return createClient(url ?? "", serviceKey ?? "", { auth: { persistSession: false } });
}

export type Admin = ReturnType<typeof makeAdmin>;

/** The `id` of a just-inserted row, checked rather than asserted so the untyped client stays lint-clean. */
export function idOf(row: unknown): string {
  const id = typeof row === "object" && row !== null && "id" in row ? row.id : undefined;
  if (typeof id !== "string") throw new Error("seeded row has no string id");
  return id;
}

const seededLinkIds: string[] = [];

// Created on first use, not at import time: createClient throws on an empty URL, which would fail the run
// instead of skipping it when the env vars are absent.
let sharedAdmin: Admin | undefined;

/** The admin client the seed helpers use, for tests that seed or inspect extra rows (e.g. time entries). */
export function admin(): Admin {
  sharedAdmin ??= makeAdmin();
  return sharedAdmin;
}

/**
 * Seeds one person with a real token, inserting the link row directly so the 10-person cap of `create_link`
 * does not apply. Returns the raw token: the caller holds the secret, the database only the hash.
 */
export async function seedPerson(): Promise<{ linkId: string; token: string }> {
  const token = generateToken();
  const { data, error } = await admin()
    .from("links")
    .insert({ token_hash: await hashToken(token) })
    .select("id")
    .single();
  if (error) throw new Error(`seed link failed: ${error.message}`);
  const linkId = idOf(data);
  seededLinkIds.push(linkId);
  return { linkId, token };
}

export async function seedProject(linkId: string, name: string): Promise<string> {
  const { data, error } = await admin().from("projects").insert({ link_id: linkId, name }).select("id").single();
  if (error) throw new Error(`seed project failed: ${error.message}`);
  return idOf(data);
}

/** Inserts one closed (or, with `endedAt` null, open) time entry directly, skipping the timer RPCs. Returns its id. */
export async function seedTimeEntry(
  linkId: string,
  projectId: string,
  projectName: string,
  startedAt: Date,
  endedAt: Date | null,
): Promise<string> {
  const { data, error } = await admin()
    .from("time_entries")
    .insert({
      link_id: linkId,
      project_id: projectId,
      project_name: projectName,
      started_at: startedAt.toISOString(),
      ended_at: endedAt?.toISOString() ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`seed time entry failed: ${error.message}`);
  return idOf(data);
}

/**
 * Removes every seeded link with its time entries, projects and access-log rows. A regenerated link keeps its id,
 * so it is covered. A failed delete throws (after the rest ran), because a leftover link blocks the next smoke run.
 */
export async function cleanupSeeded(linkIds?: readonly string[]): Promise<void> {
  const failures: string[] = [];
  const idsToClean = linkIds === undefined ? seededLinkIds.splice(0) : [...new Set(linkIds)];
  if (linkIds !== undefined) {
    for (const id of idsToClean) {
      let index = seededLinkIds.indexOf(id);
      while (index !== -1) {
        seededLinkIds.splice(index, 1);
        index = seededLinkIds.indexOf(id);
      }
    }
  }
  for (const id of idsToClean) {
    for (const table of ["time_entries", "projects", "access_log"] as const) {
      const { error } = await admin().from(table).delete().eq("link_id", id);
      if (error) failures.push(`${table} for ${id}: ${error.message}`);
    }
    const { error } = await admin().from("links").delete().eq("id", id);
    if (error) failures.push(`links ${id}: ${error.message}`);
  }
  if (failures.length > 0) throw new Error(`cleanup failed: ${failures.join("; ")}`);
}
