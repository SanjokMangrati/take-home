import { describe, expect, test } from "vitest";
import { type ParsedSchedule, parseXer } from "../../src/core/analyze.ts";
import { compareSchedules, isLostFloat } from "../../src/core/compare.ts";
import { checkedFile, repoFile } from "../support/xer.ts";

const RISKTYPE_BROKEN_LINES = [689, 750, 6707, 6708, 6709, 6714, 6715, 6716, 6717];

const UPDATES = [
  {
    file: "data/dukhan-ph9-update-06.xer",
    project: { name: "DHBL Month 6", dataDate: "2013-04-27" },
    checked: 5058,
    missingLinks: 0,
    negativeFloat: 2528,
    highFloat: 731,
    highFloatStatus: "fail",
  },
  {
    file: "data/dukhan-ph9-update-12.xer",
    project: { name: "DHBL Month 12", dataDate: "2013-11-02" },
    checked: 4333,
    missingLinks: 0,
    negativeFloat: 3589,
    highFloat: 114,
    highFloatStatus: "pass",
  },
] as const;

describe.each(UPDATES)("$file", (update) => {
  const analysis = checkedFile(update.file);

  test("is one P6 17.12 project", () => {
    expect(analysis.facts).toMatchObject({
      p6Version: "17.12",
      checkedActivityCount: update.checked,
      projects: [expect.objectContaining(update.project)],
    });
    expect(analysis.notes).toEqual([]);
  });

  test("matches the independent count of all three checks", () => {
    const { missingLinks, negativeFloat, highFloat } = analysis.checks;

    expect(missingLinks.summary).toEqual({
      counted: update.checked,
      leftOut: 0,
      flagged: update.missingLinks,
      status: "pass",
    });
    expect(negativeFloat.summary).toEqual({
      counted: update.checked,
      leftOut: 0,
      flagged: update.negativeFloat,
      status: "fail",
    });
    expect(highFloat.summary).toEqual({
      counted: update.checked,
      leftOut: 0,
      flagged: update.highFloat,
      status: update.highFloatStatus,
    });
    expect(analysis.floatDays).toHaveLength(update.checked);
  });

  test("finds the same nine broken RISKTYPE rows, none of which the checks use", () => {
    expect(analysis.broken.map((row) => row.line)).toEqual(RISKTYPE_BROKEN_LINES);
    expect(new Set(analysis.broken.map((row) => `${row.table} ${row.effect.kind}`))).toEqual(
      new Set(["RISKTYPE not-used"]),
    );
  });
});

describe("Month 6 compared with Month 12", () => {
  const parsed = (path: string): ParsedSchedule => {
    const result = parseXer(repoFile(path));
    if (result.kind !== "parsed") {
      throw new Error(`${path} was not read: ${JSON.stringify(result)}`);
    }
    return result;
  };
  const month6 = parsed("data/dukhan-ph9-update-06.xer");
  const month12 = parsed("data/dukhan-ph9-update-12.xer");
  const comparison = compareSchedules(month6, month12);

  test("has a scheduled finish 61 days later against the same must finish by date", () => {
    expect(month6.projects).toMatchObject([
      { scheduledFinish: "2015-04-28", mustFinishBy: "2015-03-31" },
    ]);
    expect(month12.projects).toMatchObject([
      { scheduledFinish: "2015-06-28", mustFinishBy: "2015-03-31" },
    ]);
  });

  test("matches the independent count of progress and float changes", () => {
    const lost = comparison.floatChanges.filter(isLostFloat);
    const nowNegative = lost.filter((change) => change.beforeDays >= 0 && change.afterDays < 0);

    expect(comparison).toMatchObject({
      matchedActivityCount: 5608,
      repeatedCodeCount: 0,
      added: [{ code: "DUKHPROGEN00MTAP1880", name: "New Activity", status: "TK_Complete" }],
      removed: [],
      completedCount: 725,
      startedCount: 43,
      openInBothCount: 4333,
      unchangedFloatCount: 16,
    });
    expect(lost).toHaveLength(4286);
    expect(comparison.floatChanges.length - lost.length).toBe(31);
    expect(nowNegative).toHaveLength(1294);
  });

  test("finds 63 pairs of activities whose relationships changed, 59 of them from FS to FF", () => {
    const fsToFf = comparison.relationshipChanges.filter(
      (change) =>
        change.before.length === 1 &&
        change.before[0]?.type === "PR_FS" &&
        change.after.length === 1 &&
        change.after[0]?.type === "PR_FF",
    );

    expect(comparison.relationshipChanges).toHaveLength(63);
    expect(fsToFf).toHaveLength(59);
  });
});
