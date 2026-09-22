import { describe, it, expect } from "vitest";
import { isValidProjectName } from "./project-name";

describe("isValidProjectName", () => {
  it("accepts a normal name", () => {
    expect(isValidProjectName("Acme")).toBe(true);
  });

  it("accepts a purely numeric project name", () => {
    expect(isValidProjectName("12345")).toBe(true);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(isValidProjectName("  Acme  ")).toBe(true);
  });

  it("rejects empty and whitespace-only input", () => {
    expect(isValidProjectName("")).toBe(false);
    expect(isValidProjectName("   ")).toBe(false);
  });

  it("accepts a name exactly 200 characters", () => {
    expect(isValidProjectName("a".repeat(200))).toBe(true);
  });

  it("rejects a name over 200 characters", () => {
    expect(isValidProjectName("a".repeat(201))).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isValidProjectName(undefined)).toBe(false);
    expect(isValidProjectName(null)).toBe(false);
    expect(isValidProjectName(42)).toBe(false);
    expect(isValidProjectName({})).toBe(false);
  });
});
