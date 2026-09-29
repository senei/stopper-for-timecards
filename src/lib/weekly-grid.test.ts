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

// Roadmap rule (context/foundation/roadmap.md, S-03): always round up to the next 15 minutes, never to the nearest.
describe("buildWeeklyGrid rounding boundaries", () => {
  it.each([
    { label: "1 second", endedAt: "2026-09-21T09:00:01.000Z", expected: 15 },
    { label: "exactly 15 minutes", endedAt: "2026-09-21T09:15:00.000Z", expected: 15 },
    { label: "15 minutes 1 second", endedAt: "2026-09-21T09:15:01.000Z", expected: 30 },
    { label: "exactly 60 minutes", endedAt: "2026-09-21T10:00:00.000Z", expected: 60 },
  ])("rounds $label up to $expected minutes", ({ endedAt, expected }) => {
    const rows = buildWeeklyGrid([entry({ startedAt: "2026-09-21T09:00:00.000Z", endedAt })], WEEK_START, NOW);

    expect(rows).toHaveLength(1);
    expect(rows[0].dailyMinutes).toEqual([expected, 0, 0, 0, 0, 0, 0]);
  });
});

// These tests document the CURRENT decision that day and week boundaries are UTC (weekly-grid-summary plan-brief);
// the roadmap still lists the timezone as an open question. They are not proof that UTC is the right boundary.
describe("buildWeeklyGrid day and week boundaries (documents the current UTC decision)", () => {
  it("credits a Sunday-to-Monday segment to Sunday in its own week and to Monday in the next week", () => {
    const crossing = entry({ startedAt: "2026-09-27T23:50:00.000Z", endedAt: "2026-09-28T00:10:00.000Z" });

    const thisWeek = buildWeeklyGrid([crossing], WEEK_START, NOW);
    const nextWeek = buildWeeklyGrid([crossing], new Date("2026-09-28T00:00:00.000Z"), NOW);

    // 10 raw min on each side of the boundary, each rounded up to 15.
    expect(thisWeek[0].dailyMinutes).toEqual([0, 0, 0, 0, 0, 0, 15]);
    expect(nextWeek[0].dailyMinutes).toEqual([15, 0, 0, 0, 0, 0, 0]);
  });

  it("credits nothing to the next day when a segment ends exactly at UTC midnight", () => {
    const rows = buildWeeklyGrid(
      [entry({ startedAt: "2026-09-21T23:00:00.000Z", endedAt: "2026-09-22T00:00:00.000Z" })],
      WEEK_START,
      NOW,
    );

    expect(rows[0].dailyMinutes).toEqual([60, 0, 0, 0, 0, 0, 0]);
  });

  it("credits nothing to the week when a segment ends exactly at the week start", () => {
    const rows = buildWeeklyGrid(
      [entry({ startedAt: "2026-09-20T23:00:00.000Z", endedAt: "2026-09-21T00:00:00.000Z" })],
      WEEK_START,
      NOW,
    );

    expect(rows).toEqual([]);
  });

  it("splits a segment longer than 24 hours across every UTC day it touches, rounding each day's portion", () => {
    // Mon 22:00 -> Thu 01:10: Mon 120 min, Tue 1440, Wed 1440, Thu 70 raw -> 75.
    const rows = buildWeeklyGrid(
      [entry({ startedAt: "2026-09-21T22:00:00.000Z", endedAt: "2026-09-24T01:10:00.000Z" })],
      WEEK_START,
      NOW,
    );

    expect(rows[0].dailyMinutes).toEqual([120, 1440, 1440, 75, 0, 0, 0]);
  });

  it("splits a still-open entry that crosses midnight, crediting each day up to nowUtc", () => {
    const rows = buildWeeklyGrid(
      [entry({ startedAt: "2026-09-21T23:50:00.000Z", endedAt: null })],
      WEEK_START,
      new Date("2026-09-22T00:10:00.000Z"),
    );

    // 10 raw min on Monday and 10 raw min on Tuesday, each rounded up to 15.
    expect(rows[0].dailyMinutes).toEqual([15, 15, 0, 0, 0, 0, 0]);
  });

  it("credits nothing for a still-open entry whose start is after nowUtc", () => {
    const rows = buildWeeklyGrid(
      [entry({ startedAt: "2026-09-22T08:00:00.000Z", endedAt: null })],
      WEEK_START,
      new Date("2026-09-22T07:00:00.000Z"),
    );

    expect(rows).toEqual([]);
  });
});

describe("buildWeeklyGrid row grouping and per-row rounding", () => {
  it("treats a null task and an empty-string task as two distinct rows", () => {
    const rows = buildWeeklyGrid(
      [
        entry({ task: null, startedAt: "2026-09-21T09:00:00.000Z", endedAt: "2026-09-21T09:15:00.000Z" }),
        entry({ task: "", startedAt: "2026-09-21T10:00:00.000Z", endedAt: "2026-09-21T10:15:00.000Z" }),
      ],
      WEEK_START,
      NOW,
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.task).sort()).toEqual(["", null]);
  });

  it("merges segments of one tuple into one row even when another row's segment sits between them", () => {
    const rows = buildWeeklyGrid(
      [
        entry({ projectName: "Acme", startedAt: "2026-09-21T10:00:00.000Z", endedAt: "2026-09-21T10:10:00.000Z" }),
        entry({ projectName: "Other", startedAt: "2026-09-21T10:20:00.000Z", endedAt: "2026-09-21T10:35:00.000Z" }),
        entry({ projectName: "Acme", startedAt: "2026-09-21T11:00:00.000Z", endedAt: "2026-09-21T11:10:00.000Z" }),
      ],
      WEEK_START,
      NOW,
    );

    // Acme: 10 + 10 = 20 raw min summed before rounding -> 30. Other: 15 raw -> 15.
    expect(rows.map((row) => [row.projectName, row.dailyMinutes[0]])).toEqual([
      ["Acme", 30],
      ["Other", 15],
    ]);
  });

  it("rounds each row separately on the same day instead of pooling minutes across rows", () => {
    const rows = buildWeeklyGrid(
      [
        entry({ projectName: "Acme", startedAt: "2026-09-21T09:00:00.000Z", endedAt: "2026-09-21T09:10:00.000Z" }),
        entry({ projectName: "Zebra", startedAt: "2026-09-21T10:00:00.000Z", endedAt: "2026-09-21T10:10:00.000Z" }),
      ],
      WEEK_START,
      NOW,
    );

    // Pooled 20 raw min would round to 30 in total; per-row rounding gives 15 + 15.
    expect(rows.map((row) => row.dailyMinutes[0])).toEqual([15, 15]);
  });

  it.each([
    { label: "zero-length", startedAt: "2026-09-21T09:00:00.000Z", endedAt: "2026-09-21T09:00:00.000Z" },
    { label: "negative-length", startedAt: "2026-09-21T09:30:00.000Z", endedAt: "2026-09-21T09:00:00.000Z" },
  ])("adds no minutes for a $label entry", ({ startedAt, endedAt }) => {
    expect(buildWeeklyGrid([entry({ startedAt, endedAt })], WEEK_START, NOW)).toEqual([]);
  });
});
