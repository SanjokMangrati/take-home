import { describe, expect, test } from "vitest";
import { describeEffect, describeNote, describeProblem } from "../../src/ui/describe.ts";

describe("describeProblem", () => {
  test("names control characters by code point", () => {
    expect(describeProblem({ kind: "damaged-text", codePoints: [0x03, 0x81] })).toBe(
      "Contains control characters (U+0003, U+0081), so its text is damaged.",
    );
  });

  test("points a stray line at the row it probably belongs to", () => {
    expect(describeProblem({ kind: "not-a-row", previousLine: 35 })).toBe(
      "Does not start with %T, %F, %R or %E, so it is not a row. It may be the rest of line 35, split by a line break inside a value.",
    );
  });

  test("names which end of a relationship is missing", () => {
    expect(
      describeProblem({ kind: "link-end-not-in-file", column: "pred_task_id", taskId: "999" }),
    ).toBe("Predecessor 999 is not in the file. It may belong to another project.");
    expect(
      describeProblem({ kind: "link-end-broken", column: "task_id", taskId: "112", line: 30 }),
    ).toBe("Successor 112 is on line 30, which is broken.");
  });

  test("says when a number is too large to read", () => {
    expect(
      describeProblem({
        kind: "number-too-large",
        column: "total_float_hr_cnt",
        value: `1${"0".repeat(400)}`,
      }),
    ).toBe("total_float_hr_cnt is too large to read as a number.");
  });

  test("says how to fill in an empty total float", () => {
    expect(describeProblem({ kind: "missing-float" })).toBe(
      "total_float_hr_cnt is empty. Schedule the project in P6 (F9), then export it again.",
    );
  });
});

describe("describeEffect", () => {
  test("counts the activities a broken calendar affects", () => {
    expect(describeEffect({ kind: "calendar-unusable", activities: 1 })).toBe(
      "1 activity on this calendar left out of the high float check.",
    );
    expect(describeEffect({ kind: "calendar-unusable", activities: 1200 })).toBe(
      "1,200 activities on this calendar left out of the high float check.",
    );
  });

  test("says when a broken calendar affects no open activity", () => {
    expect(describeEffect({ kind: "calendar-unusable", activities: 0 })).toBe(
      "No open activity with a float value uses this calendar.",
    );
  });
});

describe("describeNote", () => {
  test("explains padded rows as normal P6 output", () => {
    expect(describeNote({ kind: "padded-rows", count: 3, firstLine: 37 })).toBe(
      "3 rows end early, starting at line 37. P6 leaves out empty fields at the end of a row, so the checker filled them in as empty.",
    );
  });

  test("explains why empty fields after the last column were removed", () => {
    expect(describeNote({ kind: "trimmed-rows", count: 14, firstLine: 4 })).toBe(
      "Removed empty fields after the last column from 14 rows, starting at line 4. Every row in those tables has fields after the last column, so the tool that wrote the file added them.",
    );
  });

  test("names the hours per day the person entered", () => {
    expect(describeNote({ kind: "hours-per-day-entered", hours: 7.5 })).toBe(
      "This file does not include the work hours in a day, so float is counted in days of 7.5 hours, the value you entered.",
    );
  });
});
