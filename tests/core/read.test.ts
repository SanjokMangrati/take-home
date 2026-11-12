import { describe, expect, test } from "vitest";
import { XerFileError } from "../../src/core/xer/problems.ts";
import { readXer } from "../../src/core/xer/read.ts";
import { HEADER, type XerLine, xerBytes } from "../support/xer.ts";

const TASK_TABLE: readonly XerLine[] = [
  ["%T", "TASK"],
  ["%F", "task_id", "task_code"],
  ["%R", "1", "A1"],
];

function rejection(bytes: Uint8Array): { message: string; line: number | null } {
  try {
    readXer(bytes);
  } catch (error) {
    if (error instanceof XerFileError) {
      return { message: error.message, line: error.line };
    }
    throw error;
  }
  throw new Error("Expected the file to be rejected");
}

describe("whole-file rejections", () => {
  test("rejects an empty file", () => {
    expect(rejection(new Uint8Array())).toEqual({ message: "This file is empty.", line: null });
  });

  test("names a P6 XML export", () => {
    const xml = new TextEncoder().encode('<?xml version="1.0"?>\n<APIBusinessObjects>');

    expect(rejection(xml).message).toBe(
      "This is a P6 XML export. Export the schedule from P6 as XER instead.",
    );
  });

  test("rejects a file that does not start with ERMHDR", () => {
    expect(rejection(xerBytes([["%T", "TASK"]]))).toEqual({
      message: "This is not a P6 XER export. The first line of an XER file starts with ERMHDR.",
      line: 1,
    });
  });

  test("rejects a file without the %E end line as possibly incomplete", () => {
    expect(rejection(xerBytes([HEADER, ...TASK_TABLE]))).toEqual({
      message: "This file has no %E end line, so it may be incomplete. Export it from P6 again.",
      line: 4,
    });
  });

  test("rejects a table that appears twice", () => {
    const bytes = xerBytes([HEADER, ...TASK_TABLE, ...TASK_TABLE, ["%E"]]);

    expect(rejection(bytes)).toEqual({
      message: "Table TASK appears twice, on lines 2 and 5.",
      line: 5,
    });
  });

  test("rejects a %F line before any table", () => {
    expect(rejection(xerBytes([HEADER, ["%F", "task_id"], ["%E"]])).line).toBe(2);
  });

  test("rejects a second %F line in one table", () => {
    const bytes = xerBytes([HEADER, ["%T", "TASK"], ["%F", "a"], ["%F", "b"], ["%E"]]);

    expect(rejection(bytes)).toEqual({
      message: "Table TASK has a second %F column line.",
      line: 4,
    });
  });

  test("stops at the first line past 10,000 broken rows", () => {
    const strayLines = Array.from({ length: 20_000 }, (): XerLine => ["x"]);
    const bytes = xerBytes([HEADER, ...TASK_TABLE, ...strayLines, ["%E"]]);

    expect(rejection(bytes)).toEqual({
      message:
        "This file has more than 10,000 broken rows, so it is too damaged to check. Export it from P6 again.",
      line: 10_005,
    });
  });

  test("rejects a used table without a %F line", () => {
    expect(rejection(xerBytes([HEADER, ["%T", "TASK"], ["%E"]]))).toEqual({
      message: "Table TASK has no %F column line.",
      line: 2,
    });
  });
});

describe("structure", () => {
  test("reads the P6 version from the header", () => {
    const contents = readXer(xerBytes([HEADER, ...TASK_TABLE, ["%E"]]));

    expect(contents.p6Version).toBe("17.12");
  });

  test("keeps the line number of every row in a used table", () => {
    const contents = readXer(xerBytes([HEADER, ...TASK_TABLE, ["%R", "2", "A2"], ["%E"]]));

    expect(contents.tables.get("TASK")?.rows.map((row) => row.line)).toEqual([4, 5]);
  });

  test("reads CRLF line endings like LF", () => {
    const text = ["ERMHDR\t17.12", "%T\tTASK", "%F\ttask_id", "%R\t1", "%E", ""].join("\r\n");
    const contents = readXer(new TextEncoder().encode(text));

    expect(contents.tables.get("TASK")?.rows[0]?.values).toEqual(["1"]);
  });

  test("pads a row that ends early, because P6 drops trailing empty fields", () => {
    const bytes = xerBytes([HEADER, ["%T", "TASK"], ["%F", "a", "b", "c"], ["%R", "1"], ["%E"]]);
    const contents = readXer(bytes);

    expect(contents.tables.get("TASK")?.rows[0]?.values).toEqual(["1", "", ""]);
    expect(contents.paddedRows).toEqual({ count: 1, firstLine: 4 });
    expect(contents.broken).toEqual([]);
  });

  test("removes empty fields after the last column when every row of the table has fields there", () => {
    const bytes = xerBytes([
      HEADER,
      ["%T", "RISKTYPE"],
      ["%F", "risk_type_id", "risk_type"],
      ["%R", "1", "High", ""],
      ["%T", "TASK"],
      ["%F", "task_id", "task_code"],
      ["%R", "1", "A1", "", ""],
      ["%R", "2", "A2", ""],
      ["%E"],
    ]);
    const contents = readXer(bytes);

    expect(contents.tables.get("TASK")?.rows).toEqual([
      { line: 7, values: ["1", "A1"], problems: [] },
      { line: 8, values: ["2", "A2"], problems: [] },
    ]);
    expect(contents.trimmedRows).toEqual({ count: 3, firstLine: 4 });
    expect(contents.broken).toEqual([]);
  });

  test("still flags a row with a tab inside a value when every row of the table has an extra empty field", () => {
    const bytes = xerBytes([
      HEADER,
      ["%T", "TASK"],
      ["%F", "task_id", "task_name"],
      ["%R", "1", "Pour slab", ""],
      ["%R", "2", "Fix", "rebar", ""],
      ["%R", "3", "Cure", ""],
      ["%E"],
    ]);
    const contents = readXer(bytes);

    expect(contents.tables.get("TASK")?.rows.map((row) => row.problems)).toEqual([
      [],
      [{ kind: "extra-fields", fields: 4, columns: 2 }],
      [],
    ]);
    expect(contents.trimmedRows).toEqual({ count: 2, firstLine: 4 });
  });

  test("continues after %E when another table follows", () => {
    const bytes = xerBytes([
      HEADER,
      ["%T", "PROJECT"],
      ["%F", "proj_id"],
      ["%E"],
      ...TASK_TABLE,
      ["%E"],
    ]);

    expect(readXer(bytes).tables.get("TASK")?.rows).toHaveLength(1);
  });
});

describe("broken rows found while reading", () => {
  test("flags a row with more fields than columns", () => {
    const bytes = xerBytes([HEADER, ...TASK_TABLE, ["%R", "2", "A2", "extra"], ["%E"]]);
    const row = readXer(bytes).tables.get("TASK")?.rows[1];

    expect(row?.problems).toEqual([{ kind: "extra-fields", fields: 3, columns: 2 }]);
  });

  test("flags an empty extra field that other rows of the table do not have, because a tab inside a value shifts the columns", () => {
    const bytes = xerBytes([HEADER, ...TASK_TABLE, ["%R", "2", "A2", ""], ["%E"]]);
    const contents = readXer(bytes);

    expect(contents.tables.get("TASK")?.rows[1]?.problems).toEqual([
      { kind: "extra-fields", fields: 3, columns: 2 },
    ]);
    expect(contents.trimmedRows).toBeNull();
  });

  test("flags control characters and characters undefined in Windows-1252", () => {
    const bytes = xerBytes([HEADER, ...TASK_TABLE, ["%R", "2", "A\u0003\u0081"], ["%E"]]);

    expect(readXer(bytes).tables.get("TASK")?.rows[1]?.problems).toEqual([
      { kind: "damaged-text", codePoints: [0x03, 0x81] },
    ]);
  });

  test("does not flag the DEL character that P6 writes inside calendar data", () => {
    const bytes = xerBytes([HEADER, ...TASK_TABLE, ["%R", "2", "A\u007f2"], ["%E"]]);

    expect(readXer(bytes).tables.get("TASK")?.rows[1]?.problems).toEqual([]);
  });

  test("reports broken rows in tables the checks do not use, and skips healthy ones", () => {
    const bytes = xerBytes([
      HEADER,
      ["%T", "RISKTYPE"],
      ["%F", "risk_type_id", "risk_type"],
      ["%R", "1", "Fine"],
      ["%R", "2", "Split", "value"],
      ...TASK_TABLE,
      ["%E"],
    ]);

    expect(readXer(bytes).broken).toEqual([
      {
        line: 5,
        table: "RISKTYPE",
        subject: null,
        problems: [{ kind: "extra-fields", fields: 3, columns: 2 }],
        effect: { kind: "not-used" },
      },
    ]);
  });

  test("flags a line that is not a row and points to the row it may belong to", () => {
    const bytes = xerBytes([HEADER, ...TASK_TABLE, ["rest of a note"], ["%E"]]);

    expect(readXer(bytes).broken).toEqual([
      {
        line: 5,
        table: "TASK",
        subject: null,
        problems: [{ kind: "not-a-row", previousLine: 4 }],
        effect: { kind: "row-ignored" },
      },
    ]);
  });

  test("flags a row that comes before its %F line", () => {
    const bytes = xerBytes([HEADER, ["%T", "OTHER"], ["%R", "1"], ...TASK_TABLE, ["%E"]]);

    expect(readXer(bytes).broken[0]?.problems).toEqual([{ kind: "row-before-columns" }]);
  });

  test("flags text after the %E end line", () => {
    const bytes = xerBytes([HEADER, ...TASK_TABLE, ["%E"], ["trailing"]]);

    expect(readXer(bytes).broken[0]).toMatchObject({
      line: 6,
      problems: [{ kind: "text-after-end" }],
    });
  });
});
