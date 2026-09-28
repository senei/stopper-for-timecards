import { describe, it, expect } from "vitest";
import { earliestNavigableWeekStart } from "./weekly-grid-retention";

describe("earliestNavigableWeekStart", () => {
  it("rounds up to the next Monday when the 3-month-ago cutoff lands mid-week", () => {
    // now = Mon 2026-09-28. Cutoff = now - 3 calendar months = Sun 2026-06-28 (mid-week, not a Monday),
    // so the week containing it (Mon 2026-06-22 .. Sun 2026-06-28) straddles the cutoff and is excluded;
    // the earliest fully-retained week starts the following Monday.
    const now = new Date("2026-09-28T00:00:00.000Z");
    const result = earliestNavigableWeekStart(now);
    expect(result.toISOString()).toBe("2026-06-29T00:00:00.000Z");
  });

  it("returns the cutoff's own week when the cutoff lands exactly on a Monday", () => {
    // now = Tue 2026-09-22. Cutoff = now - 3 calendar months = Mon 2026-06-22T00:00:00.000Z exactly, so
    // that week is already entirely at/after the cutoff and is itself the earliest navigable week.
    const now = new Date("2026-09-22T00:00:00.000Z");
    const result = earliestNavigableWeekStart(now);
    expect(result.toISOString()).toBe("2026-06-22T00:00:00.000Z");
  });

  it("always returns a UTC Monday at 00:00:00.000", () => {
    const now = new Date("2026-09-24T15:37:42.123Z");
    const result = earliestNavigableWeekStart(now);
    expect(result.getUTCDay()).toBe(1);
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
    expect(result.getUTCMilliseconds()).toBe(0);
  });

  it("preserves the cutoff's time-of-day when checking Monday-exactness, not just the date", () => {
    // Same calendar date as the exact-Monday case above, but a non-midnight time, so the cutoff no
    // longer lands exactly on the Monday boundary and the week must be rounded up.
    const now = new Date("2026-09-22T08:00:00.000Z");
    const result = earliestNavigableWeekStart(now);
    expect(result.toISOString()).toBe("2026-06-29T00:00:00.000Z");
  });

  it("normalizes a day-of-month that doesn't exist 3 months back via calendar-month rollover", () => {
    // now = Sun 2026-05-31. Date.UTC(2026, 1 /* Feb */, 31) has no Feb 31 in 2026 (28-day Feb), so JS
    // normalizes it forward into March: cutoff = 2026-03-03T00:00:00.000Z (Tue), matching the plan's
    // prescribed Date.UTC calendar-month subtraction.
    const now = new Date("2026-05-31T00:00:00.000Z");
    const result = earliestNavigableWeekStart(now);
    // Cutoff 2026-03-03 (Tue) is mid-week, so round up: week containing it starts Mon 2026-03-02,
    // earliest navigable week is the following Monday, 2026-03-09.
    expect(result.toISOString()).toBe("2026-03-09T00:00:00.000Z");
  });
});
