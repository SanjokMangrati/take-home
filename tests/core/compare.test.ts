import { describe, expect, test } from "vitest";
import { calendarDaysBetween, compareSchedules, medianOf } from "../../src/core/compare.ts";
import { scheduleFrom, type TaskSpec } from "../support/xer.ts";

const FOUR_ACTIVITIES: readonly TaskSpec[] = [
  { id: "1", code: "A1" },
  { id: "2", code: "A2" },
  { id: "3", code: "A3" },
  { id: "4", code: "A4" },
];

describe("matching activities", () => {
  test("matches activities by Activity ID, because P6 gives them new internal IDs in each export", () => {
    const before = scheduleFrom({
      tasks: [
        { id: "1", code: "A1", floatHours: "80" },
        { id: "2", code: "A2", floatHours: "16" },
      ],
    });
    const after = scheduleFrom({
      tasks: [
        { id: "11", code: "A2", floatHours: "-8" },
        { id: "12", code: "A1", floatHours: "80" },
      ],
    });

    const comparison = compareSchedules(before, after);

    expect(comparison).toMatchObject({
      matchedActivityCount: 2,
      added: [],
      removed: [],
      openInBothCount: 2,
      unchangedFloatCount: 1,
    });
    expect(comparison.floatChanges).toEqual([
      { code: "A2", name: "Activity 11", beforeDays: 2, afterDays: -1, changeDays: -3 },
    ]);
  });

  test("lists the activities added and removed, with their status", () => {
    const before = scheduleFrom({
      tasks: [
        { id: "1", code: "A1" },
        { id: "2", code: "A2" },
      ],
    });
    const after = scheduleFrom({
      tasks: [
        { id: "2", code: "A2" },
        { id: "3", code: "A3", status: "TK_Complete" },
      ],
    });

    expect(compareSchedules(before, after)).toMatchObject({
      matchedActivityCount: 1,
      added: [{ code: "A3", name: "Activity 3", status: "TK_Complete" }],
      removed: [{ code: "A1", name: "Activity 1", status: "TK_NotStart" }],
    });
  });

  test("leaves out an Activity ID used by more than one activity in a file", () => {
    const before = scheduleFrom({
      tasks: [
        { id: "1", code: "A1", project: "1" },
        { id: "2", code: "A1", project: "2" },
        { id: "3", code: "A2" },
      ],
    });
    const after = scheduleFrom({
      tasks: [
        { id: "11", code: "A1" },
        { id: "12", code: "A2" },
      ],
    });

    expect(compareSchedules(before, after)).toMatchObject({
      matchedActivityCount: 1,
      repeatedCodeCount: 1,
      added: [],
      removed: [],
    });
  });
});

describe("progress", () => {
  test("counts the activities completed and started between the two files", () => {
    const before = scheduleFrom({
      tasks: [
        { id: "1", code: "A1", status: "TK_NotStart" },
        { id: "2", code: "A2", status: "TK_Active" },
        { id: "3", code: "A3", status: "TK_NotStart" },
        { id: "4", code: "A4", status: "TK_Complete" },
      ],
    });
    const after = scheduleFrom({
      tasks: [
        { id: "1", code: "A1", status: "TK_Complete" },
        { id: "2", code: "A2", status: "TK_Complete" },
        { id: "3", code: "A3", status: "TK_Active" },
        { id: "4", code: "A4", status: "TK_Complete" },
      ],
    });

    expect(compareSchedules(before, after)).toMatchObject({
      completedCount: 2,
      startedCount: 1,
      openInBothCount: 1,
    });
  });
});

describe("float", () => {
  test("lists float changes largest loss first, in working days of each activity's own calendar", () => {
    const calendars = [
      ["1", "8"],
      ["2", "10"],
    ] as const;
    const before = scheduleFrom({
      calendars,
      tasks: [
        { id: "1", code: "A1", floatHours: "80" },
        { id: "2", code: "A2", calendar: "2", floatHours: "100" },
        { id: "3", code: "A3", floatHours: "0" },
      ],
    });
    const after = scheduleFrom({
      calendars,
      tasks: [
        { id: "1", code: "A1", floatHours: "40" },
        { id: "2", code: "A2", calendar: "2", floatHours: "0" },
        { id: "3", code: "A3", floatHours: "16" },
      ],
    });

    expect(
      compareSchedules(before, after).floatChanges.map((change) => [
        change.code,
        change.changeDays,
      ]),
    ).toEqual([
      ["A2", -10],
      ["A1", -5],
      ["A3", 2],
    ]);
  });

  test("leaves out of the float comparison an activity with no float value in one file", () => {
    const before = scheduleFrom({ tasks: [{ id: "1", code: "A1", floatHours: "" }] });
    const after = scheduleFrom({ tasks: [{ id: "1", code: "A1", floatHours: "8" }] });

    expect(compareSchedules(before, after)).toMatchObject({
      openInBothCount: 1,
      unchangedFloatCount: 0,
      floatChanges: [],
    });
  });
});

describe("relationships", () => {
  const before = scheduleFrom({
    tasks: FOUR_ACTIVITIES,
    links: [
      { predecessor: "1", successor: "2", type: "PR_FS" },
      { predecessor: "1", successor: "3", type: "PR_FS" },
      { predecessor: "1", successor: "4", type: "PR_FS" },
      { predecessor: "2", successor: "3", type: "PR_SS" },
      { predecessor: "2", successor: "3", type: "PR_FF" },
      { predecessor: "3", successor: "4", type: "PR_FS", lagHours: "8" },
    ],
  });
  const after = scheduleFrom({
    tasks: FOUR_ACTIVITIES,
    links: [
      { predecessor: "1", successor: "2", type: "PR_FF" },
      { predecessor: "1", successor: "3", type: "PR_FS" },
      { predecessor: "2", successor: "3", type: "PR_SS" },
      { predecessor: "2", successor: "4", type: "PR_FS" },
      { predecessor: "3", successor: "4", type: "PR_FS" },
    ],
  });

  test("compares the relationships of each pair of activities, so a pair linked SS and FF is one pair", () => {
    const fs = { type: "PR_FS", lagHours: 0 };

    expect(compareSchedules(before, after).relationshipChanges).toEqual([
      {
        predecessorCode: "A1",
        successorCode: "A2",
        before: [fs],
        after: [{ ...fs, type: "PR_FF" }],
      },
      { predecessorCode: "A1", successorCode: "A4", before: [fs], after: [] },
      {
        predecessorCode: "A2",
        successorCode: "A3",
        before: [
          { type: "PR_FF", lagHours: 0 },
          { type: "PR_SS", lagHours: 0 },
        ],
        after: [{ type: "PR_SS", lagHours: 0 }],
      },
      { predecessorCode: "A2", successorCode: "A4", before: [], after: [fs] },
      { predecessorCode: "A3", successorCode: "A4", before: [{ ...fs, lagHours: 8 }], after: [fs] },
    ]);
  });

  test("counts a lag that is not a number as different from any lag", () => {
    const withLag = scheduleFrom({
      tasks: FOUR_ACTIVITIES,
      links: [{ predecessor: "1", successor: "2", lagHours: "8" }],
    });
    const unreadable = scheduleFrom({
      tasks: FOUR_ACTIVITIES,
      links: [{ predecessor: "1", successor: "2", lagHours: "soon" }],
    });

    expect(compareSchedules(withLag, unreadable).relationshipChanges).toHaveLength(1);
    expect(compareSchedules(unreadable, unreadable).relationshipChanges).toEqual([]);
  });
});

describe("medianOf", () => {
  test.each([
    [[3, -1, 2], 2],
    [[4, -2, 1, 0], 0.5],
    [[-37], -37],
  ])("is the middle of %j", (values, median) => {
    expect(medianOf(values)).toBe(median);
  });

  test("is null for no values", () => {
    expect(medianOf([])).toBeNull();
  });
});

describe("calendarDaysBetween", () => {
  test.each([
    ["2015-04-28", "2015-06-28", 61],
    ["2015-03-31", "2015-04-28", 28],
    ["2013-11-02", "2013-04-27", -189],
  ])("counts %s to %s as %i days", (from, to, days) => {
    expect(calendarDaysBetween(from, to)).toBe(days);
  });
});
