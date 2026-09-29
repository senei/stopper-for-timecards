import { describe, it, expect } from "vitest";
import { buildWeeklyGrid, type RawWeekEntry } from "./weekly-grid";

// UTC Monday 2026-09-21T00:00:00.000Z .. Sunday 2026-09-27T23:59:59.999Z; index 0 = Monday .. 6 = Sunday.
const WEEK_START = new Date("2026-09-21T00:00:00.000Z");
// A `nowUtc` safely after the week, for tests that don't exercise the still-open-entry case.
const NOW = new Date("2026-09-28T00:00:00.000Z");

function entry(overrides: Partial<RawWeekEntry> = {}): RawWeekEntry {
  return {
    projectName: "Acme",
    task: "Build",
    type: "Dev",
    workType: "Billable",
    startedAt: "2026-09-21T09:00:00.000Z",
    endedAt: "2026-09-21T09:50:00.000Z",
    ...overrides,
  };
}

describe("buildWeeklyGrid", () => {
  it("buckets a segment entirely within one day, rounded up to the next 15 minutes", () => {
    const rows = buildWeeklyGrid(
      [entry({ startedAt: "2026-09-21T09:00:00.000Z", endedAt: "2026-09-21T09:50:00.000Z" })], // 50 raw min
      WEEK_START,
      NOW,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].dailyMinutes).toEqual([60, 0, 0, 0, 0, 0, 0]);
  });

  it("splits a segment spanning a UTC midnight boundary and rounds each day independently", () => {
    // Monday 23:40 -> Tuesday 00:50: 20 raw min on Monday, 50 raw min on Tuesday.
    const rows = buildWeeklyGrid(
      [entry({ startedAt: "2026-09-21T23:40:00.000Z", endedAt: "2026-09-22T00:50:00.000Z" })],
      WEEK_START,
      NOW,
    );

    expect(rows).toHaveLength(1);
    // Monday: 20 -> 30. Tuesday: 50 -> 60. Rounding the 70-minute segment once before splitting would give a
    // different (wrong) total, since the plan requires per-day rounding of the split raw portions.
    expect(rows[0].dailyMinutes).toEqual([30, 60, 0, 0, 0, 0, 0]);
  });

  it("sums two segments in the same (day, row) cell before rounding, not after", () => {
    const rows = buildWeeklyGrid(
      [
        entry({ startedAt: "2026-09-23T10:00:00.000Z", endedAt: "2026-09-23T10:10:00.000Z" }), // 10 raw min
        entry({ startedAt: "2026-09-23T10:20:00.000Z", endedAt: "2026-09-23T10:25:00.000Z" }), // 5 raw min
      ],
      WEEK_START,
      NOW,
    );

    expect(rows).toHaveLength(1);
    // 10 + 5 = 15 raw min summed first, then rounded once -> 15. Rounding each segment individually first
    // (10 -> 15, 5 -> 15) and summing after would wrongly give 30.
    expect(rows[0].dailyMinutes).toEqual([0, 0, 15, 0, 0, 0, 0]);
  });

  // Roadmap rule: always round up, so a total of exactly 15 minutes stays 15. Summing fractional minutes as floats
  // drifts above the boundary (45 x 20 s = 15.000000000000009 min) and would wrongly round up to 30.
  it.each([
    { segments: 45, seconds: 20 },
    { segments: 90, seconds: 10 },
    { segments: 30, seconds: 30 },
  ])(
    "keeps an exact 15-minute total at 15 when made of $segments contiguous $seconds-second segments",
    ({ segments, seconds }) => {
      const dayStartMs = new Date("2026-09-21T09:00:00.000Z").getTime();
      const entries = Array.from({ length: segments }, (_, i) =>
        entry({
          startedAt: new Date(dayStartMs + i * seconds * 1000).toISOString(),
          endedAt: new Date(dayStartMs + (i + 1) * seconds * 1000).toISOString(),
        }),
      );

      const rows = buildWeeklyGrid(entries, WEEK_START, NOW);

      expect(rows).toHaveLength(1);
      expect(rows[0].dailyMinutes).toEqual([15, 0, 0, 0, 0, 0, 0]);
    },
  );

  it("credits a still-open entry up to the fixed nowUtc parameter", () => {
    const rows = buildWeeklyGrid(
      [entry({ startedAt: "2026-09-24T08:00:00.000Z", endedAt: null })],
      WEEK_START,
      new Date("2026-09-24T08:20:00.000Z"), // 20 raw min -> 30
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].dailyMinutes).toEqual([0, 0, 0, 30, 0, 0, 0]);
  });

  it("produces two distinct rows for the same project with different task/type/workType", () => {
    const rows = buildWeeklyGrid(
      [
        entry({
          task: "Build",
          type: "Dev",
          workType: "Billable",
          startedAt: "2026-09-21T09:00:00.000Z",
          endedAt: "2026-09-21T09:15:00.000Z",
        }),
        entry({
          task: "Review",
          type: "QA",
          workType: "NonBillable",
          startedAt: "2026-09-21T10:00:00.000Z",
          endedAt: "2026-09-21T10:15:00.000Z",
        }),
      ],
      WEEK_START,
      NOW,
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => ({ task: row.task, type: row.type, workType: row.workType }))).toEqual([
      { task: "Build", type: "Dev", workType: "Billable" },
      { task: "Review", type: "QA", workType: "NonBillable" },
    ]);
  });

  it("omits a row whose total minutes across the week is zero", () => {
    const rows = buildWeeklyGrid(
      [entry({ startedAt: "2026-09-14T09:00:00.000Z", endedAt: "2026-09-14T09:50:00.000Z" })], // entirely before the week
      WEEK_START,
      NOW,
    );

    expect(rows).toEqual([]);
  });

  it("orders rows alphabetically by projectName", () => {
    const rows = buildWeeklyGrid(
      [
        entry({ projectName: "Zebra", startedAt: "2026-09-21T09:00:00.000Z", endedAt: "2026-09-21T09:15:00.000Z" }),
        entry({ projectName: "Acme", startedAt: "2026-09-21T10:00:00.000Z", endedAt: "2026-09-21T10:15:00.000Z" }),
        entry({ projectName: "Mango", startedAt: "2026-09-21T11:00:00.000Z", endedAt: "2026-09-21T11:15:00.000Z" }),
      ],
      WEEK_START,
      NOW,
    );

    expect(rows.map((row) => row.projectName)).toEqual(["Acme", "Mango", "Zebra"]);
  });
});
