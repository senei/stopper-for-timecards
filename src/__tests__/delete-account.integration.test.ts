import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { APIContext, AstroCookies } from "astro";
import { admin, cleanupSeeded, hasEnv, integrationTitle, seedPerson, seedProject } from "../test/integration-db";
import { POST } from "../pages/api/w/[token]/delete-account";

// Oracle: PRD FR-010 -- delete exactly the requester's projects, time entries and link, in one confirmed action, and
// nobody else's data (prd.md:84-85, :90, :102). The route runs for real here (real link lookup, real deleteAccount, real
// delete_account function); only the request and the cookie jar are fake, as in the hermetic route test.
const NOBODY_AGENT = `delete-account-it-${randomUUID()}`;

interface Person {
  linkId: string;
  token: string;
  projectId: string;
}

/** A person who owns a project, a closed and an open time entry, and an access-log row. */
async function seedOwner(): Promise<Person> {
  const { linkId, token } = await seedPerson();
  const projectId = await seedProject(linkId, "Acme Widgets");
  const started = "2026-09-25T09:00:00Z";
  const entries = await admin()
    .from("time_entries")
    .insert([
      {
        link_id: linkId,
        project_id: projectId,
        project_name: "Acme Widgets",
        started_at: started,
        ended_at: "2026-09-25T10:00:00Z",
      },
      { link_id: linkId, project_id: projectId, project_name: "Acme Widgets", started_at: "2026-09-25T11:00:00Z" },
    ]);
  if (entries.error) throw new Error(`seed entries failed: ${entries.error.message}`);
  const log = await admin()
    .from("access_log")
    .insert({ link_id: linkId, outcome: "success", user_agent: "delete-account-it" });
  if (log.error) throw new Error(`seed access log failed: ${log.error.message}`);
  return { linkId, token, projectId };
}

async function count(table: "links" | "projects" | "time_entries" | "access_log", linkId: string): Promise<number> {
  const column = table === "links" ? "id" : "link_id";
  const { count: rows, error } = await admin()
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, linkId);
  if (error) throw new Error(`count ${table} failed: ${error.message}`);
  if (rows === null) throw new Error(`count ${table} returned no count`);
  return rows;
}

async function snapshot(person: Person) {
  return {
    links: await count("links", person.linkId),
    projects: await count("projects", person.linkId),
    time_entries: await count("time_entries", person.linkId),
    access_log: await count("access_log", person.linkId),
  };
}

const FULL = { links: 1, projects: 1, time_entries: 2, access_log: 1 };
const EMPTY = { links: 0, projects: 0, time_entries: 0, access_log: 0 };

/** Calls the real route with a form body and a cookie jar holding `cookie`, like the browser would send. */
function post({ token, phrase, cookie }: { token: string; phrase?: string; cookie?: string }) {
  const form = new FormData();
  if (phrase !== undefined) form.set("confirm", phrase);
  const del = vi.fn();
  const cookies = {
    get: (name: string) => (name === "stopper_link" && cookie !== undefined ? { value: cookie } : undefined),
    delete: del,
  } as unknown as AstroCookies;
  const rewrite = vi.fn(() => Promise.resolve(new Response(null, { status: 404 })));
  const context = {
    params: { token },
    request: new Request(`http://localhost/api/w/${token}/delete-account`, { method: "POST", body: form }),
    cookies,
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
    rewrite,
  } as unknown as APIContext;
  return { response: POST(context), del, rewrite };
}

describe.skipIf(!hasEnv)(integrationTitle("POST /api/w/[token]/delete-account (real route, real database)"), () => {
  afterAll(async () => {
    await admin().from("access_log").delete().eq("user_agent", NOBODY_AGENT);
    await cleanupSeeded();
  });

  it.each([
    { name: "no phrase at all", phrase: undefined },
    { name: "an empty phrase", phrase: "" },
    { name: "the phrase in lower case", phrase: "delete" },
  ])("deletes nothing when the phrase is wrong ($name)", async ({ phrase }) => {
    const leaver = await seedOwner();
    const stayer = await seedOwner();

    const { response, rewrite } = post({ token: leaver.token, phrase });
    const result = await response;

    // The route must have reached the phrase check (not failed earlier), and then refused.
    expect(result.status).toBe(303);
    expect(result.headers.get("Location")).toBe(`/w/${leaver.token}/delete-account?error=confirm-phrase`);
    expect(rewrite).not.toHaveBeenCalled();
    expect(await snapshot(leaver)).toEqual(FULL);
    expect(await snapshot(stayer)).toEqual(FULL);
  });

  it("deletes exactly the URL token's person, with every project, time entry and log row, and nobody else", async () => {
    const leaver = await seedOwner();
    const stayer = await seedOwner();

    // The browser's cookie holds the OTHER person's link: the route must still act on the URL token's person.
    await post({ token: leaver.token, phrase: "DELETE", cookie: stayer.token }).response;

    expect(await snapshot(leaver)).toEqual(EMPTY);
    expect(await snapshot(stayer)).toEqual(FULL);
  });

  describe("documents the current plan decision (redirect target, cookie rule, 404 for the old link, rows of nobody)", () => {
    it("redirects home with the deleted notice and leaves another person's remembered link alone", async () => {
      const leaver = await seedOwner();
      const stayer = await seedOwner();

      const { response, del } = post({ token: leaver.token, phrase: "DELETE", cookie: stayer.token });
      const result = await response;

      expect(result.status).toBe(303);
      expect(result.headers.get("Location")).toBe("/?status=account-deleted");
      expect(del).not.toHaveBeenCalled();
    });

    it("forgets the remembered link when it is the deleted one", async () => {
      const leaver = await seedOwner();

      const { response, del } = post({ token: leaver.token, phrase: "DELETE", cookie: leaver.token });
      await response;

      expect(del).toHaveBeenCalledWith("stopper_link", { path: "/" });
    });

    it("answers a second delete of the same link with a 404 and changes nothing", async () => {
      const leaver = await seedOwner();
      const stayer = await seedOwner();
      await post({ token: leaver.token, phrase: "DELETE" }).response;

      const { response, rewrite } = post({ token: leaver.token, phrase: "DELETE" });
      await response;

      expect(rewrite).toHaveBeenCalledWith("/404");
      expect(await snapshot(leaver)).toEqual(EMPTY);
      expect(await snapshot(stayer)).toEqual(FULL);
    });

    it("leaves access-log rows that belong to nobody (no link id) alone", async () => {
      const leaver = await seedOwner();
      const inserted = await admin()
        .from("access_log")
        .insert({ link_id: null, outcome: "not_found", user_agent: NOBODY_AGENT });
      if (inserted.error) throw new Error(`seed null-link row failed: ${inserted.error.message}`);

      await post({ token: leaver.token, phrase: "DELETE" }).response;

      const { count: rows, error } = await admin()
        .from("access_log")
        .select("id", { count: "exact", head: true })
        .eq("user_agent", NOBODY_AGENT);
      if (error) throw new Error(`count failed: ${error.message}`);
      expect(rows).toBe(1);
    });
  });
});
