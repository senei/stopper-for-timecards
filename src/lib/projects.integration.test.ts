import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupSeeded, hasEnv, integrationTitle, seedPerson, seedProject } from "../test/integration-db";
import { deleteProject, getProject, listProjects } from "./projects";
import { getCurrentTimer } from "./timer";

// Oracle: PRD Access Control — a person sees only their own projects and time, never anyone else's.
describe.skipIf(!hasEnv)(integrationTitle("link_id ownership scoping (real database)"), () => {
  let linkA = "";
  let linkB = "";
  let projectA = "";
  let projectB = "";
  let unusedA = "";
  let unusedB = "";

  /** One OPEN entry per link at most: a unique index allows a single running timer per person. */
  async function insertOpenEntry(linkId: string, projectId: string, projectName: string) {
    const { error } = await admin().from("time_entries").insert({
      link_id: linkId,
      project_id: projectId,
      project_name: projectName,
      started_at: "2026-09-25T09:00:00Z",
    });
    if (error) throw new Error(`seed entry failed: ${error.message}`);
  }

  beforeAll(async () => {
    const personA = await seedPerson();
    const personB = await seedPerson();
    linkA = personA.linkId;
    linkB = personB.linkId;
    projectA = await seedProject(linkA, "Project of A");
    projectB = await seedProject(linkB, "Project of B");
    // The projects with logged time are for the read and timer checks; the FK would also block deleting them.
    await insertOpenEntry(linkA, projectA, "Project of A");
    await insertOpenEntry(linkB, projectB, "Project of B");
    // Unused projects are deletable, so only the ownership check can stop A from deleting B's.
    unusedA = await seedProject(linkA, "Unused of A");
    unusedB = await seedProject(linkB, "Unused of B");
  });

  afterAll(cleanupSeeded);

  it("lists only the caller's projects", async () => {
    const ids = (await listProjects(linkA)).map((project) => project.id);

    expect(ids).toContain(projectA);
    expect(ids).not.toContain(projectB);
  });

  it("does not return another person's project by id", async () => {
    expect(await getProject(linkA, projectB)).toBeNull();
    expect(await getProject(linkA, projectA)).toEqual({ id: projectA, name: "Project of A" });
  });

  async function projectRows(projectId: string) {
    const { data, error } = await admin().from("projects").select("id").eq("id", projectId);
    if (error) throw new Error(`verify project failed: ${error.message}`);
    return data;
  }

  it("does not delete another person's project, and leaves it in place", async () => {
    expect(await deleteProject(linkA, projectB)).toBe(false);
    expect(await projectRows(projectB)).toHaveLength(1);
  });

  it("does not delete another person's unused project, and leaves it in place", async () => {
    expect(await deleteProject(linkA, unusedB)).toBe(false);
    expect(await projectRows(unusedB)).toHaveLength(1);
  });

  it("deletes the caller's own unused project", async () => {
    expect(await deleteProject(linkA, unusedA)).toBe(true);
    expect(await projectRows(unusedA)).toHaveLength(0);
  });

  it("never returns another person's open timer", async () => {
    const current = await getCurrentTimer(linkA);

    expect(current?.projectId).toBe(projectA);
    expect(current?.projectId).not.toBe(projectB);
  });
});
