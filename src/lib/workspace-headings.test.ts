import { describe, it, expect } from "vitest";
import { WORKSPACE_HEADINGS, headingAtIndex, headingForDate, headingIndexForDate } from "./workspace-headings";

// Dates are built with local components, the same way the code reads them, so these tests do not depend on the
// machine's timezone.
const day = (offset: number) => new Date(2026, 8, 24 + offset);

describe("headingForDate", () => {
  it("gives the same pair for the same day, whatever the time of day", () => {
    const morning = headingForDate(new Date(2026, 8, 24, 0, 0, 1));
    const night = headingForDate(new Date(2026, 8, 24, 23, 59, 59));
    expect(night).toEqual(morning);
  });

  it("gives a different pair on consecutive days", () => {
    for (let offset = 0; offset < WORKSPACE_HEADINGS.length * 2; offset++) {
      expect(headingForDate(day(offset))).not.toEqual(headingForDate(day(offset + 1)));
    }
  });

  it("cycles through every pair before repeating", () => {
    const idles = Array.from({ length: WORKSPACE_HEADINGS.length }, (_, offset) => headingForDate(day(offset)).idle);
    expect(new Set(idles).size).toBe(WORKSPACE_HEADINGS.length);
    expect(headingForDate(day(WORKSPACE_HEADINGS.length))).toEqual(headingForDate(day(0)));
  });

  it("maps a fixed date to a fixed pair", () => {
    // 2026-09-24 is day number 20720 since the epoch; 20720 % 6 = 2.
    expect(headingIndexForDate(new Date(2026, 8, 24))).toBe(2);
    expect(headingForDate(new Date(2026, 8, 24))).toEqual({
      idle: "Tick. Tock. Pick a project.",
      tracking: "Tick. Tock. Still going.",
    });
    expect(headingIndexForDate(new Date(2026, 8, 25))).toBe(3);
  });
});

describe("WORKSPACE_HEADINGS", () => {
  it("has six pairs, each with non-empty idle and tracking text", () => {
    expect(WORKSPACE_HEADINGS).toHaveLength(6);
    for (const pair of WORKSPACE_HEADINGS) {
      expect(pair.idle.trim()).not.toBe("");
      expect(pair.tracking.trim()).not.toBe("");
    }
  });
});

describe("headingAtIndex", () => {
  it("wraps out-of-range and negative indices into range", () => {
    expect(headingAtIndex(0)).toEqual(WORKSPACE_HEADINGS[0]);
    expect(headingAtIndex(WORKSPACE_HEADINGS.length)).toEqual(WORKSPACE_HEADINGS[0]);
    expect(headingAtIndex(-1)).toEqual(WORKSPACE_HEADINGS[WORKSPACE_HEADINGS.length - 1]);
  });
});
