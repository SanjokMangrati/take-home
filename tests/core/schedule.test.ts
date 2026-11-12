import { describe, expect, test } from "vitest";
import { readXer } from "../../src/core/xer/read.ts";
import { buildSchedule } from "../../src/core/xer/schedule.ts";
import { analyzeXer, HEADER, scheduleFrom, type XerLine, xerBytes } from "../support/xer.ts";

const CALENDAR_TABLE: readonly XerLine[] = [
  ["%T", "CALENDAR"],
  ["%F", "clndr_id", "day_hr_cnt"],
  ["%R", "1", "8"],
];

const TASK_COLUMNS: XerLine = [
  "%F",
  "task_id",
  "clndr_id",
  "task_code",
  "task_name",
  "task_type",
  "status_code",
  "total_float_hr_cnt",
];

describe("files the checks cannot run on", () => {
  test("rejects a file without a TASK table", () => {
    expect(analyzeXer(xerBytes([HEADER, ...CALENDAR_TABLE, ["%E"]]))).toEqual({
      kind: "rejected",
      reason: "This file has no TASK table, so there are no activities to check.",
      line: null,
    });
  });

  test("rejects a file without a CALENDAR table", () => {
    const bytes = xerBytes([HEADER, ["%T", "TASK"], TASK_COLUMNS, ["%E"]]);

    expect(analyzeXer(bytes)).toMatchObject({
      kind: "rejected",
      reason: "This file has no CALENDAR table, so float cannot be converted to days.",
    });
  });

  test("names every required column the TASK table is missing", () => {
    const bytes = xerBytes([
      HEADER,
      ...CALENDAR_TABLE,
      ["%T", "TASK"],
      ["%F", "task_id", "task_code"],
      ["%E"],
    ]);

    expect(analyzeXer(bytes)).toEqual({
      kind: "rejected",
      reason:
        "Table TASK is missing the task_name, task_type, status_code, clndr_id and total_float_hr_cnt columns.",
      line: 5,
    });
  });

  test("uses the singular for one missing column", () => {
    const bytes = xerBytes([
      HEADER,
      ...CALENDAR_TABLE,
      ["%T", "TASK"],
      TASK_COLUMNS,
      ["%T", "TASKPRED"],
      ["%F", "task_id", "pred_task_id"],
      ["%E"],
    ]);

    expect(analyzeXer(bytes)).toMatchObject({
      reason: "Table TASKPRED is missing the pred_type column.",
    });
  });
});

describe("reading the schedule", () => {
  test("treats a file without a TASKPRED table as having no links, and notes it", () => {
    const bytes = xerBytes([
      HEADER,
      ...CALENDAR_TABLE,
      ["%T", "TASK"],
      TASK_COLUMNS,
      ["%R", "1", "1", "A1", "Only", "TT_Task", "TK_NotStart", "0"],
      ["%E"],
    ]);

    expect(buildSchedule(readXer(bytes))).toMatchObject({ links: [], hasRelationshipTable: false });
    expect(analyzeXer(bytes)).toMatchObject({ notes: [{ kind: "no-relationship-table" }] });
  });

  test("takes each activity's hours per day from its own calendar", () => {
    const schedule = scheduleFrom({
      calendars: [
        ["1", "8"],
        ["2", "7.5"],
      ],
      tasks: [
        { id: "1", calendar: "1" },
        { id: "2", calendar: "2" },
      ],
    });

    expect(schedule.activities.map((activity) => activity.hoursPerDay)).toEqual([8, 7.5]);
  });

  test("does not read float on activities the checks leave out", () => {
    const schedule = scheduleFrom({
      tasks: [{ id: "1", status: "TK_Complete", floatHours: "abc" }],
    });

    expect(schedule.activities[0]).toMatchObject({ checked: false, totalFloatHours: null });
    expect(schedule.broken).toEqual([]);
  });

  test("flags a float too large to read as a number, and leaves it out of the float checks", () => {
    const schedule = scheduleFrom({ tasks: [{ id: "1", floatHours: `1${"0".repeat(400)}` }] });

    expect(schedule.activities[0]).toMatchObject({ totalFloatHours: null });
    expect(schedule.broken[0]).toMatchObject({
      problems: [{ kind: "number-too-large", column: "total_float_hr_cnt" }],
      effect: { kind: "left-out-of-float-checks" },
    });
  });

  test("rejects a file with more than 10,000 broken rows, counting rows of every table", () => {
    const unreadableActivities = Array.from(
      { length: 10_001 },
      (_, index): XerLine => [
        "%R",
        String(index + 1),
        "1",
        "",
        "No code",
        "TT_Task",
        "TK_NotStart",
        "0",
      ],
    );
    const bytes = xerBytes([
      HEADER,
      ...CALENDAR_TABLE,
      ["%T", "TASK"],
      TASK_COLUMNS,
      ...unreadableActivities,
      ["%E"],
    ]);

    expect(analyzeXer(bytes)).toEqual({
      kind: "rejected",
      reason:
        "This file has more than 10,000 broken rows, so it is too damaged to check. Export it from P6 again.",
      line: 10_007,
    });
  });

  test("flags hours per day outside the range a day can hold", () => {
    const schedule = scheduleFrom({
      calendars: [["1", "25"]],
      tasks: [{ id: "1", floatHours: "8" }],
    });

    expect(schedule.broken).toEqual([
      {
        line: 4,
        table: "CALENDAR",
        subject: "Calendar 1",
        problems: [{ kind: "hours-per-day-out-of-range", value: 25 }],
        effect: { kind: "calendar-unusable", activities: 1 },
      },
    ]);
  });

  test("points an activity at its calendar's broken row instead of calling the calendar missing", () => {
    const schedule = scheduleFrom({
      calendars: [["7a", "8"]],
      tasks: [{ id: "1", calendar: "7a" }],
    });

    expect(schedule.broken.find((row) => row.table === "TASK")?.problems).toEqual([
      { kind: "calendar-broken", calendarId: "7a", line: 4 },
    ]);
  });

  test("labels a link by the Activity IDs at both ends", () => {
    const schedule = scheduleFrom({
      tasks: [
        { id: "1", code: "EXC-100" },
        { id: "2", code: "EXC-110" },
      ],
      links: [{ predecessor: "1", successor: "2", type: "PR_XX" }],
    });

    expect(schedule.broken[0]?.subject).toBe("EXC-100 → EXC-110");
  });

  test("points a link at the first broken row of an activity that is broken twice", () => {
    const schedule = scheduleFrom({
      tasks: [{ id: "1" }, { id: "2", type: "TT_Unknown" }, { id: "2", status: "TK_Unknown" }],
      links: [{ predecessor: "1", successor: "2" }],
    });

    expect(schedule.broken.find((row) => row.table === "TASKPRED")?.problems).toEqual([
      { kind: "link-end-broken", column: "task_id", taskId: "2", line: 8 },
    ]);
  });

  test("reads the project name, data date, scheduled finish and must finish by date", () => {
    const bytes = xerBytes([
      HEADER,
      ["%T", "PROJECT"],
      ["%F", "proj_id", "proj_short_name", "last_recalc_date", "scd_end_date", "plan_end_date"],
      ["%R", "7", "DHBL", "2013-11-02 00:00", "2015-06-28 17:00", "2015-03-31 17:00"],
      ["%R", "8", "Draft", "", "", ""],
      ...CALENDAR_TABLE,
      ["%T", "TASK"],
      TASK_COLUMNS,
      ["%E"],
    ]);

    expect(buildSchedule(readXer(bytes)).projects).toEqual([
      {
        id: "7",
        name: "DHBL",
        dataDate: "2013-11-02",
        scheduledFinish: "2015-06-28",
        mustFinishBy: "2015-03-31",
        line: 4,
      },
      {
        id: "8",
        name: "Draft",
        dataDate: null,
        scheduledFinish: null,
        mustFinishBy: null,
        line: 5,
      },
    ]);
  });

  test("reads each activity's status and each relationship's type and lag", () => {
    const bytes = xerBytes([
      HEADER,
      ...CALENDAR_TABLE,
      ["%T", "TASK"],
      TASK_COLUMNS,
      ["%R", "1", "1", "A1", "Survey", "TT_Task", "TK_Complete", ""],
      ["%R", "2", "1", "A2", "Excavate", "TT_Task", "TK_Active", "0"],
      ["%T", "TASKPRED"],
      ["%F", "task_pred_id", "task_id", "pred_task_id", "pred_type", "lag_hr_cnt"],
      ["%R", "1", "2", "1", "PR_SS", "16"],
      ["%R", "2", "2", "1", "PR_FF", "-8"],
      ["%R", "3", "1", "2", "PR_FS", "soon"],
      ["%E"],
    ]);
    const schedule = buildSchedule(readXer(bytes));

    expect(schedule.activities.map((activity) => activity.status)).toEqual([
      "TK_Complete",
      "TK_Active",
    ]);
    expect(schedule.links.map(({ type, lagHours }) => [type, lagHours])).toEqual([
      ["PR_SS", 16],
      ["PR_FF", -8],
      ["PR_FS", null],
    ]);
    expect(schedule.broken).toEqual([]);
  });
});

describe("calendars without hours per day", () => {
  const oldExport = xerBytes([
    HEADER,
    ["%T", "CALENDAR"],
    ["%F", "clndr_id", "clndr_name"],
    ["%R", "1", "Standard"],
    ["%R", "2", "Night shift"],
    ["%T", "TASK"],
    TASK_COLUMNS,
    ["%R", "1", "1", "A1", "Day work", "TT_Task", "TK_NotStart", "500"],
    ["%R", "2", "2", "A2", "Night work", "TT_Task", "TK_NotStart", "-40"],
    ["%E"],
  ]);

  test("asks for the work hours in a day, pointing at the CALENDAR table", () => {
    expect(analyzeXer(oldExport)).toEqual({ kind: "needs-hours-per-day", line: 2 });
  });

  test("counts float in days of the hours the person entered, and notes it", () => {
    const analysis = analyzeXer(oldExport, 10);
    expect.assert(analysis.kind === "checked");

    expect(analysis.floatDays).toEqual([50, -4]);
    expect(analysis.checks.highFloat.summary).toMatchObject({ counted: 2, flagged: 1 });
    expect(analysis.notes).toEqual([
      { kind: "hours-per-day-entered", hours: 10 },
      { kind: "no-relationship-table" },
    ]);
    expect(analysis.broken).toEqual([]);
  });

  test("flags an entered value a day cannot hold, instead of using it", () => {
    const analysis = analyzeXer(oldExport, 30);
    expect.assert(analysis.kind === "checked");

    expect(analysis.broken.map((row) => [row.line, row.effect])).toEqual([
      [4, { kind: "calendar-unusable", activities: 1 }],
      [5, { kind: "calendar-unusable", activities: 1 }],
    ]);
  });

  test("also asks when the hours per day column is there but empty on every calendar", () => {
    const blankHours = xerBytes([
      HEADER,
      ["%T", "CALENDAR"],
      ["%F", "clndr_id", "day_hr_cnt"],
      ["%R", "1", ""],
      ["%T", "TASK"],
      TASK_COLUMNS,
      ["%R", "1", "1", "A1", "Only", "TT_Task", "TK_NotStart", "80"],
      ["%E"],
    ]);

    expect(analyzeXer(blankHours)).toEqual({ kind: "needs-hours-per-day", line: 2 });
    expect(analyzeXer(blankHours, 10)).toMatchObject({
      floatDays: [8],
      notes: [{ kind: "hours-per-day-entered", hours: 10 }, { kind: "no-relationship-table" }],
    });
  });

  test("keeps each calendar's own hours when the file has them", () => {
    const analysis = analyzeXer(
      xerBytes([
        HEADER,
        ...CALENDAR_TABLE,
        ["%T", "TASK"],
        TASK_COLUMNS,
        ["%R", "1", "1", "A1", "Only", "TT_Task", "TK_NotStart", "80"],
        ["%E"],
      ]),
      10,
    );
    expect.assert(analysis.kind === "checked");

    expect(analysis.floatDays).toEqual([10]);
    expect(analysis.notes).toEqual([{ kind: "no-relationship-table" }]);
  });
});
