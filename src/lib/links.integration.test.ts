import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupSeeded, hasEnv, integrationTitle, seedPerson } from "../test/integration-db";
import { generateToken } from "./link-token";
import { findLinkByToken, regenerateLink } from "./links";

// Oracle: PRD FR-007 and Access Control (link regeneration invalidates the old link at once; a link opens only its
// owner's data). Decided in planning: the old link is a 404 with no grace window.
describe.skipIf(!hasEnv)(integrationTitle("findLinkByToken / regenerateLink (real database)"), () => {
  let personA: { linkId: string; token: string };
  let personB: { linkId: string; token: string };

  beforeAll(async () => {
    personA = await seedPerson();
    personB = await seedPerson();
  });

  afterAll(cleanupSeeded);

  it("resolves a person's token to that person's link", async () => {
    expect(await findLinkByToken(personA.token)).toEqual({ id: personA.linkId });
    expect(await findLinkByToken(personB.token)).toEqual({ id: personB.linkId });
  });

  it("returns null for a well-formed token nobody holds", async () => {
    expect(await findLinkByToken(generateToken())).toBeNull();
  });

  it("swaps a person onto a new token: the old one is dead at once, the new one opens the same link, others are untouched", async () => {
    const result = await regenerateLink(personA.token);

    if (result.status !== "regenerated") throw new Error("expected regenerateLink to succeed for a valid token");
    expect(result.id).toBe(personA.linkId);
    expect(result.token).not.toBe(personA.token);

    expect(await findLinkByToken(personA.token)).toBeNull();
    expect(await findLinkByToken(result.token)).toEqual({ id: personA.linkId });
    expect(await findLinkByToken(personB.token)).toEqual({ id: personB.linkId });
  });

  it("reports not_found when the already-replaced token is regenerated again", async () => {
    expect(await regenerateLink(personA.token)).toEqual({ status: "not_found" });
  });

  describe("documents the current PRD-accepted model: whoever holds a link can regenerate it (lockout accepted)", () => {
    it("regenerates a link for any holder of a valid token, without any other proof of ownership", async () => {
      const holder = await seedPerson();

      const result = await regenerateLink(holder.token);

      expect(result).toMatchObject({ status: "regenerated", id: holder.linkId });
      expect(await findLinkByToken(holder.token)).toBeNull();
    });
  });
});
