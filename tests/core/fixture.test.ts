import { describe, expect, test } from "vitest";
import { affectsChecks } from "../../src/core/xer/problems.ts";
import { checkedFile } from "../support/xer.ts";

describe("hand-made fixture with one row per broken-row reason", () => {
  const analysis = checkedFile("tests/fixtures/broken-rows.xer");
  const codes = (findings: readonly { activity: { code: string } }[]) =>
    findings.map((finding) => finding.activity.code);

  test("counts the activities and relationships it could use", () => {
    expect(analysis.facts).toEqual({
      p6Version: "17.12",
      activityCount: 15,
      checkedActivityCount: 13,
      linkCount: 13,
      projects: [
        {
          id: "1",
          name: "FIXTURE",
          dataDate: "2026-11-01",
          scheduledFinish: null,
          mustFinishBy: null,
          line: 4,
        },
      ],
    });
  });

  test("flags every broken row once, in line order, with its effect", () => {
    expect(
      analysis.broken.map((row) => [
        row.line,
        row.table,
        row.subject,
        row.problems.map((problem) => problem.kind),
        row.effect.kind,
      ]),
    ).toEqual([
      [9, "CALENDAR", "No hours", ["missing-value"], "calendar-unusable"],
      [10, "CALENDAR", "Duplicate", ["duplicate-id"], "row-ignored"],
      [14, "RISKTYPE", null, ["damaged-text"], "not-used"],
      [15, "RISKTYPE", null, ["extra-fields"], "not-used"],
      [25, "TASK", "A1070", ["missing-float"], "left-out-of-float-checks"],
      [26, "TASK", "A1080", ["not-a-number"], "left-out-of-float-checks"],
      [27, "TASK", "A1090", ["calendar-not-in-file"], "left-out-of-high-float-check"],
      [30, "TASK", "A1120", ["unknown-value"], "activity-not-read"],
      [31, "TASK", "A1130", ["duplicate-id"], "activity-not-read"],
      [34, "TASK", "A1160", ["extra-fields"], "activity-not-read"],
      [35, "TASK", "A1170", ["damaged-text"], "still-used"],
      [36, "TASK", null, ["not-a-row"], "row-ignored"],
      [37, "TASK", "A1180", ["missing-value", "missing-value"], "activity-not-read"],
      [53, "TASKPRED", "112 → A1140", ["link-end-broken"], "link-not-counted"],
      [54, "TASKPRED", "999 → A1140", ["link-end-not-in-file"], "link-not-counted"],
      [55, "TASKPRED", "A1010 → A1010", ["self-link"], "link-not-counted"],
      [56, "TASKPRED", "A1000 → A1020", ["unknown-value"], "link-not-counted"],
      [57, "TASKPRED", "A1020 → A1030", ["extra-fields"], "link-not-counted"],
      [58, "TASKPRED", "A1020 → abc", ["not-an-integer"], "link-not-counted"],
    ]);
  });

  test("14 of the 19 broken rows change what the checks count", () => {
    expect(analysis.broken.filter((row) => affectsChecks(row.effect))).toHaveLength(14);
  });

  test("counts the activities a broken calendar keeps out of the high float check", () => {
    expect(analysis.broken[0]?.effect).toEqual({ kind: "calendar-unusable", activities: 1 });
  });

  test("points a link to a left-out activity at that activity's line", () => {
    const link = analysis.broken.find((row) => row.line === 53);

    expect(link?.problems).toEqual([
      { kind: "link-end-broken", column: "pred_task_id", taskId: "112", line: 30 },
    ]);
  });

  test("notes the row that P6 cut short", () => {
    expect(analysis.notes).toEqual([{ kind: "padded-rows", count: 1, firstLine: 37 }]);
  });

  test("missing links: 1 of 13 checked activities, which fails the 5% limit", () => {
    expect(analysis.checks.missingLinks.summary).toEqual({
      counted: 13,
      leftOut: 0,
      flagged: 1,
      status: "fail",
    });
    expect(analysis.checks.missingLinks.findings).toEqual([
      expect.objectContaining({ noPredecessor: true, noSuccessor: false }),
    ]);
    expect(codes(analysis.checks.missingLinks.findings)).toEqual(["A1150"]);
  });

  test("negative float: 2 of 11 activities with a float value, most negative first", () => {
    expect(analysis.checks.negativeFloat.summary).toEqual({
      counted: 11,
      leftOut: 2,
      flagged: 2,
      status: "fail",
    });
    expect(
      analysis.checks.negativeFloat.findings.map((finding) => [
        finding.activity.code,
        finding.floatDays,
      ]),
    ).toEqual([
      ["A1010", -2],
      ["A1140", -1],
    ]);
  });

  test("high float: 2 of 9, and exactly 44 days on 8 h and 10 h calendars is not flagged", () => {
    expect(analysis.checks.highFloat.summary).toEqual({
      counted: 9,
      leftOut: 4,
      flagged: 2,
      status: "fail",
    });
    expect(
      analysis.checks.highFloat.findings.map((finding) => [
        finding.activity.code,
        finding.floatDays,
      ]),
    ).toEqual([
      ["A1030", 45],
      ["A1040", 45],
    ]);
  });

  test("charts the float in days of every activity the high float check measured", () => {
    expect([...analysis.floatDays].sort((a, b) => a - b)).toEqual([
      -2, -1, 0, 0, 2, 44, 44, 45, 45,
    ]);
  });
});
