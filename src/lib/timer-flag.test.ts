import { describe, it, expect } from "vitest";
import { LONG_RUNNING_TIMER_HOURS, elapsedWholeHours, isTimerFlagged } from "./timer-flag";

const START = "2026-09-24T08:00:00.000Z";

/** A `now` that is `hours`, `minutes` and `seconds` after `START`. */
function after(hours: number, minutes = 0, seconds = 0): Date {
  return new Date(Date.parse(START) + ((hours * 60 + minutes) * 60 + seconds) * 1000);
}

describe("LONG_RUNNING_TIMER_HOURS", () => {
  it("is 12 hours", () => {
    expect(LONG_RUNNING_TIMER_HOURS).toBe(12);
  });
});

describe("isTimerFlagged", () => {
  it("does not flag a timer one second short of the limit", () => {
    expect(isTimerFlagged(START, after(11, 59, 59))).toBe(false);
  });

  it("flags a timer at exactly the limit", () => {
    expect(isTimerFlagged(START, after(12))).toBe(true);
  });

  it("flags a timer well past the limit", () => {
    expect(isTimerFlagged(START, after(30))).toBe(true);
  });

  it("does not flag a timer that just started", () => {
    expect(isTimerFlagged(START, after(0))).toBe(false);
  });

  it("does not flag an unparseable start", () => {
    expect(isTimerFlagged("not a date", after(30))).toBe(false);
  });

  it("does not flag a start in the future", () => {
    expect(isTimerFlagged("2026-09-25T08:00:00.000Z", after(0))).toBe(false);
  });
});

describe("elapsedWholeHours", () => {
  it("rounds down to whole hours", () => {
    expect(elapsedWholeHours(START, after(14, 3))).toBe(14);
    expect(elapsedWholeHours(START, after(13, 59, 59))).toBe(13);
  });

  it("is 0 for less than an hour", () => {
    expect(elapsedWholeHours(START, after(0, 59))).toBe(0);
  });

  it("is 0 for an unparseable start", () => {
    expect(elapsedWholeHours("not a date", after(30))).toBe(0);
  });

  it("is 0 for a start in the future", () => {
    expect(elapsedWholeHours("2026-09-25T08:00:00.000Z", after(0))).toBe(0);
  });
});
