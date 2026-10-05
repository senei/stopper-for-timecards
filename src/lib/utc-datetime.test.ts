import { describe, expect, it } from "vitest";
import { formatUtcDateTimeLocal, parseUtcDateTimeLocal } from "./utc-datetime";

describe("parseUtcDateTimeLocal", () => {
  it("reads the minute-precision shape as UTC", () => {
    expect(parseUtcDateTimeLocal("2026-10-05T09:30")?.toISOString()).toBe("2026-10-05T09:30:00.000Z");
  });

  it("reads the second-precision shape as UTC", () => {
    expect(parseUtcDateTimeLocal("2026-10-05T09:30:45")?.toISOString()).toBe("2026-10-05T09:30:45.000Z");
  });

  it.each([
    "2026-10-05T09:30Z",
    "2026-10-05T09:30:00Z",
    "2026-10-05T09:30:00+02:00",
    "2026-10-05 09:30",
    "2026/10/05T09:30",
    "10-05T09:30",
    "2026-10-05",
    "",
  ])("rejects a wrongly shaped value (%s)", (value) => {
    expect(parseUtcDateTimeLocal(value)).toBeNull();
  });

  it.each(["2026-02-30T10:00", "2026-13-01T10:00", "2026-10-05T24:00", "2026-10-05T10:60", "2026-10-00T10:00"])(
    "rejects an impossible calendar date or time (%s)",
    (value) => {
      expect(parseUtcDateTimeLocal(value)).toBeNull();
    },
  );

  it.each([null, undefined, 123, {}, ["2026-10-05T09:30"]])("rejects a non-string value (%j)", (value) => {
    expect(parseUtcDateTimeLocal(value)).toBeNull();
  });
});

describe("formatUtcDateTimeLocal", () => {
  it("formats a UTC instant as YYYY-MM-DDTHH:mm", () => {
    expect(formatUtcDateTimeLocal("2026-10-05T09:30:45.000Z")).toBe("2026-10-05T09:30");
  });

  it("pads single-digit month, day, hour and minute", () => {
    expect(formatUtcDateTimeLocal("2026-01-02T03:04:00.000Z")).toBe("2026-01-02T03:04");
  });

  it("round-trips through parseUtcDateTimeLocal at minute precision", () => {
    const iso = "2026-10-05T09:30:00.000Z";
    expect(parseUtcDateTimeLocal(formatUtcDateTimeLocal(iso))?.toISOString()).toBe(iso);
  });
});
