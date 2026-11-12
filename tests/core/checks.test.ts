import { describe, expect, test } from "vitest";
import { type CheckResults, runChecks } from "../../src/core/checks.ts";
import { chain, type ScheduleSpec, scheduleFrom, type TaskSpec } from "../support/xer.ts";

function check(spec: ScheduleSpec): CheckResults {
  return runChecks(scheduleFrom(spec));
}

function tasks(count: number, overrides: Partial<TaskSpec> = {}): TaskSpec[] {
  return Array.from({ length: count }, (_, index) => ({ ...overrides, id: String(index + 1) }));
}

function withChange(
  list: readonly TaskSpec[],
  index: number,
  change: Partial<TaskSpec>,
): TaskSpec[] {
  return list.map((task, position) => (position === index ? { ...task, ...change } : task));
}

function idsOf(list: readonly TaskSpec[]): string[] {
  return list.map((task) => task.id);
}

describe("which activities are checked", () => {
  test("leaves out completed, level-of-effort and WBS summary activities", () => {
    const results = check({
      tasks: [
        { id: "1", status: "TK_Complete", floatHours: "-80" },
        { id: "2", type: "TT_LOE", floatHours: "-80" },
        { id: "3", type: "TT_WBS", floatHours: "-80" },
        { id: "4", status: "TK_Active", floatHours: "-80" },
        { id: "5", type: "TT_Rsrc", floatHours: "-80" },
      ],
    });

    expect(results.missingLinks.summary.counted).toBe(2);
    expect(results.negativeFloat.summary).toMatchObject({ counted: 2, flagged: 2 });
  });

  test("reports nothing to check when every activity is complete", () => {
    const results = check({ tasks: tasks(2, { status: "TK_Complete" }) });

    expect(results.missingLinks.summary.status).toBe("nothing-to-check");
    expect(results.negativeFloat.summary.status).toBe("nothing-to-check");
    expect(results.highFloat.summary.status).toBe("nothing-to-check");
  });
});

describe("missing links", () => {
  test("the project's start milestone needs no predecessor and its finish milestone needs no successor", () => {
    const list: TaskSpec[] = [
      { id: "1", type: "TT_Mile" },
      { id: "2" },
      { id: "3", type: "TT_FinMile" },
    ];

    expect(check({ tasks: list, links: chain(idsOf(list)) }).missingLinks.summary.flagged).toBe(0);
  });

  test("counts every start milestone without a predecessor when there is more than one", () => {
    const results = check({
      tasks: [
        { id: "1", type: "TT_Mile", status: "TK_Complete" },
        { id: "2", type: "TT_Mile" },
        { id: "3", type: "TT_FinMile" },
      ],
      links: [
        { predecessor: "1", successor: "3" },
        { predecessor: "2", successor: "3" },
      ],
    });

    expect(results.missingLinks.findings).toEqual([
      expect.objectContaining({
        activity: expect.objectContaining({ id: "2" }),
        noPredecessor: true,
        noSuccessor: false,
      }),
    ]);
  });

  test("counts every finish milestone without a successor when there is more than one", () => {
    const results = check({
      tasks: [
        { id: "1", type: "TT_Mile" },
        { id: "2", type: "TT_FinMile" },
        { id: "3", type: "TT_FinMile" },
      ],
      links: [
        { predecessor: "1", successor: "2" },
        { predecessor: "1", successor: "3" },
      ],
    });

    expect(results.missingLinks.findings.map((finding) => finding.activity.id)).toEqual(["2", "3"]);
  });

  test("allows one open start and one open finish in each project of the file", () => {
    const results = check({
      tasks: [
        { id: "1", project: "1", type: "TT_Mile" },
        { id: "2", project: "1", type: "TT_FinMile" },
        { id: "3", project: "2", type: "TT_Mile" },
        { id: "4", project: "2", type: "TT_FinMile" },
      ],
      links: [
        { predecessor: "1", successor: "2" },
        { predecessor: "3", successor: "4" },
      ],
    });

    expect(results.missingLinks.summary.flagged).toBe(0);
  });

  test("a finish milestone without a predecessor is still flagged", () => {
    const results = check({ tasks: [{ id: "1", type: "TT_FinMile" }] });

    expect(results.missingLinks.findings).toEqual([
      expect.objectContaining({ noPredecessor: true, noSuccessor: false }),
    ]);
  });

  test("a link from a completed activity counts as a predecessor", () => {
    const results = check({
      tasks: [
        { id: "1", status: "TK_Complete" },
        { id: "2", type: "TT_FinMile" },
      ],
      links: [{ predecessor: "1", successor: "2" }],
    });

    expect(results.missingLinks.summary.flagged).toBe(0);
  });

  test("an activity with neither link is counted once", () => {
    const results = check({ tasks: tasks(1) });

    expect(results.missingLinks.summary.flagged).toBe(1);
    expect(results.missingLinks.findings[0]).toMatchObject({
      noPredecessor: true,
      noSuccessor: true,
    });
  });

  test("passes at exactly 5% and fails above it", () => {
    const twenty = tasks(20);
    const links = chain(idsOf(twenty));
    const startsWithMilestone = withChange(twenty, 0, { type: "TT_Mile" });

    expect(check({ tasks: startsWithMilestone, links }).missingLinks.summary).toMatchObject({
      flagged: 1,
      status: "pass",
    });
    expect(check({ tasks: twenty, links }).missingLinks.summary).toMatchObject({
      flagged: 2,
      status: "fail",
    });
  });
});

describe("negative float", () => {
  test("zero float is not negative", () => {
    const results = check({ tasks: tasks(3, { floatHours: "0" }) });

    expect(results.negativeFloat.summary).toMatchObject({ flagged: 0, status: "pass" });
  });

  test("a single activity below zero fails the check", () => {
    const results = check({ tasks: withChange(tasks(100), 0, { floatHours: "-0.5" }) });

    expect(results.negativeFloat.summary).toMatchObject({ flagged: 1, status: "fail" });
  });

  test("an activity without a float value is left out, not counted as zero", () => {
    const results = check({ tasks: withChange(tasks(2), 0, { floatHours: "" }) });

    expect(results.negativeFloat.summary).toMatchObject({ counted: 1, leftOut: 1 });
  });

  test("lists the most negative float in working days first, across calendars", () => {
    const results = check({
      calendars: [
        ["8", "8"],
        ["10", "10"],
      ],
      tasks: [
        { id: "1", calendar: "10", floatHours: "-50" },
        { id: "2", calendar: "8", floatHours: "-45" },
      ],
    });

    expect(
      results.negativeFloat.findings.map((finding) => [finding.activity.id, finding.floatDays]),
    ).toEqual([
      ["2", -5.625],
      ["1", -5],
    ]);
  });
});

describe("high float", () => {
  test("is measured in working days of each activity's own calendar", () => {
    const results = check({
      calendars: [
        ["8", "8"],
        ["10", "10"],
      ],
      tasks: [
        { id: "1", calendar: "8", floatHours: "352" },
        { id: "2", calendar: "8", floatHours: "352.5" },
        { id: "3", calendar: "10", floatHours: "440" },
        { id: "4", calendar: "10", floatHours: "441" },
      ],
    });

    expect(
      results.highFloat.findings.map((finding) => [finding.activity.id, finding.floatDays]),
    ).toEqual([
      ["4", 44.1],
      ["2", 44.0625],
    ]);
  });

  test("does not flag exactly 44 days on calendars with uneven hours per day", () => {
    const results = check({
      calendars: [
        ["1", "8.18"],
        ["2", "5.92"],
      ],
      tasks: [
        { id: "1", calendar: "1", floatHours: "359.92" },
        { id: "2", calendar: "2", floatHours: "260.48" },
      ],
    });

    expect(results.highFloat.summary.flagged).toBe(0);
  });

  test("passes at exactly 5% and fails above it", () => {
    const oneHigh = withChange(tasks(20), 0, { floatHours: "360" });
    const twoHigh = withChange(oneHigh, 1, { floatHours: "360" });

    expect(check({ tasks: oneHigh }).highFloat.summary).toMatchObject({
      flagged: 1,
      status: "pass",
    });
    expect(check({ tasks: twoHigh }).highFloat.summary).toMatchObject({
      flagged: 2,
      status: "fail",
    });
  });

  test("skips activities on a calendar without hours per day, but still checks their sign", () => {
    const results = check({ calendars: [["1", ""]], tasks: tasks(2, { floatHours: "-800" }) });

    expect(results.highFloat.summary).toEqual({
      counted: 0,
      leftOut: 2,
      flagged: 0,
      status: "nothing-to-check",
    });
    expect(results.negativeFloat.summary).toMatchObject({ counted: 2, flagged: 2 });
  });
});
