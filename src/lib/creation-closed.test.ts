import { describe, expect, it } from "vitest";
import { classifyKillSwitch, isCreationClosed } from "./creation-closed";

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

// The three states let a caller tell a deliberate "off" from a value nobody understands; isCreationClosed above still
// treats both as open.
describe("classifyKillSwitch", () => {
  it.each(["1", "true", "TRUE", " true "])("is closed for %j", (value) => {
    expect(classifyKillSwitch(value)).toBe("closed");
  });

  it.each([undefined, "", "   ", "0", "false", "No", "off", " OFF "])(
    "is open, as a deliberate off, for %j",
    (value) => {
      expect(classifyKillSwitch(value)).toBe("open");
    },
  );

  it.each(["yes", "on", "closed", "enabled", "2"])("is unrecognised for %j", (value) => {
    expect(classifyKillSwitch(value)).toBe("unrecognised");
  });
});
