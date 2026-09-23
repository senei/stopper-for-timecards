import { describe, it, expect } from "vitest";
import { isWellFormedId } from "./project-id";

describe("isWellFormedId", () => {
  it("accepts a well-formed UUID", () => {
    expect(isWellFormedId("a0000000-0000-0000-0000-000000000001")).toBe(true);
  });

  it("rejects a malformed string", () => {
    expect(isWellFormedId("not-a-uuid")).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isWellFormedId(undefined)).toBe(false);
    expect(isWellFormedId(null)).toBe(false);
    expect(isWellFormedId(42)).toBe(false);
    expect(isWellFormedId({})).toBe(false);
  });
});
