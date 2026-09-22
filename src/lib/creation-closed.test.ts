import { describe, expect, it } from "vitest";
import { isCreationClosed } from "./creation-closed";

describe("isCreationClosed", () => {
  it("is open when unset or empty", () => {
    expect(isCreationClosed(undefined)).toBe(false);
    expect(isCreationClosed("")).toBe(false);
  });

  it("is open for values that do not mean closed", () => {
    expect(isCreationClosed("0")).toBe(false);
    expect(isCreationClosed("false")).toBe(false);
    expect(isCreationClosed("yes")).toBe(false);
  });

  it("is closed for 1 and true, ignoring case and surrounding whitespace", () => {
    expect(isCreationClosed("1")).toBe(true);
    expect(isCreationClosed("true")).toBe(true);
    expect(isCreationClosed("TRUE")).toBe(true);
    expect(isCreationClosed(" true ")).toBe(true);
  });
});
