import { decodeXer } from "./decode.ts";
import {
  type BrokenRow,
  byLine,
  MAX_BROKEN_ROWS,
  type Problem,
  tooManyBrokenRows,
  XerFileError,
} from "./problems.ts";

const USED_TABLES = ["PROJECT", "CALENDAR", "TASK", "TASKPRED"] as const;

export type UsedTable = (typeof USED_TABLES)[number];

export interface RawRow {
  readonly line: number;
  readonly values: readonly string[];
  readonly problems: readonly Problem[];
}

export interface RawTable {
  readonly name: UsedTable;
  readonly line: number;
  readonly columns: readonly string[];
  readonly rows: readonly RawRow[];
}

export interface RowSpan {
  readonly count: number;
  readonly firstLine: number;
}

export interface XerContents {
  readonly p6Version: string;
  readonly paddedRows: RowSpan | null;
  readonly trimmedRows: RowSpan | null;
  readonly tables: ReadonlyMap<UsedTable, RawTable>;
  readonly broken: readonly BrokenRow[];
}

interface PendingRow {
  readonly line: number;
  readonly values: readonly string[];
  readonly controlCharacters: readonly number[];
}

interface OpenTable {
  readonly name: string;
  readonly line: number;
  readonly used: UsedTable | null;
  columns: readonly string[] | null;
  readonly rows: PendingRow[];
  rowCount: number;
  everyRowHasExtraFields: boolean;
}

interface ScannedLines {
  readonly tables: readonly OpenTable[];
  readonly paddedRows: RowSpan | null;
  readonly broken: readonly BrokenRow[];
}

interface FinishedTables {
  readonly used: ReadonlyMap<UsedTable, RawTable>;
  readonly trimmedRows: RowSpan | null;
  readonly broken: readonly BrokenRow[];
}

const HEADER_TAG = "ERMHDR";
const XML_START = /^\s*<(\?xml|APIBusinessObjects)/;
const CONTROL_CHARACTER_EXCEPT_TAB_AND_DELETE = /[^\P{Cc}\t\x7F]/gu;

export function readXer(bytes: Uint8Array): XerContents {
  if (bytes.length === 0) {
    throw new XerFileError("This file is empty.");
  }
  const lines = decodeXer(bytes).split("\n").map(withoutCarriageReturn);
  const p6Version = readP6Version(lines[0] ?? "");
  const scanned = scanLines(lines);
  const finished = finishTables(scanned.tables);
  return {
    p6Version,
    paddedRows: scanned.paddedRows,
    trimmedRows: finished.trimmedRows,
    tables: finished.used,
    broken: [...scanned.broken, ...finished.broken].sort(byLine),
  };
}

function readP6Version(firstLine: string): string {
  const [tag, version = ""] = firstLine.split("\t");
  if (tag === HEADER_TAG) {
    return version;
  }
  if (XML_START.test(firstLine)) {
    throw new XerFileError(
      "This is a P6 XML export. Export the schedule from P6 as XER instead.",
      1,
    );
  }
  throw new XerFileError(
    "This is not a P6 XER export. The first line of an XER file starts with ERMHDR.",
    1,
  );
}

function scanLines(lines: readonly string[]): ScannedLines {
  const tables = new Map<string, OpenTable>();
  const broken: BrokenRow[] = [];
  let paddedRows: RowSpan | null = null;
  let current: OpenTable | null = null;
  let lastRowLine: number | null = null;
  let lastContentLine = 1;
  let ended = false;

  for (const [index, content] of lines.entries()) {
    const line = index + 1;
    if (index === 0 || content === "") {
      continue;
    }
    if (broken.length > MAX_BROKEN_ROWS) {
      throw tooManyBrokenRows(broken[MAX_BROKEN_ROWS]?.line ?? line);
    }
    lastContentLine = line;
    const [tag, ...fields] = content.split("\t");

    if (ended && tag !== "%T") {
      broken.push(ignoredLine(line, null, { kind: "text-after-end" }));
      continue;
    }

    switch (tag) {
      case "%T": {
        current = openTable(fields[0] ?? "", line, tables);
        tables.set(current.name, current);
        lastRowLine = null;
        ended = false;
        break;
      }
      case "%F": {
        if (current === null) {
          throw new XerFileError("This %F column line comes before any %T table line.", line);
        }
        if (current.columns !== null) {
          throw new XerFileError(`Table ${current.name} has a second %F column line.`, line);
        }
        current.columns = fields;
        break;
      }
      case "%R": {
        if (current === null || current.columns === null) {
          broken.push(ignoredLine(line, current?.name ?? null, { kind: "row-before-columns" }));
          break;
        }
        const columnCount = current.columns.length;
        if (fields.length < columnCount) {
          paddedRows = addToSpan(paddedRows, line);
        }
        addRow(current, columnCount, {
          line,
          values: fields,
          controlCharacters: controlCharactersIn(content),
        });
        lastRowLine = line;
        break;
      }
      case "%E": {
        ended = true;
        current = null;
        break;
      }
      default: {
        broken.push(
          ignoredLine(line, current?.name ?? null, {
            kind: "not-a-row",
            previousLine: lastRowLine,
          }),
        );
      }
    }
  }

  if (!ended) {
    throw new XerFileError(
      "This file has no %E end line, so it may be incomplete. Export it from P6 again.",
      lastContentLine,
    );
  }
  return { tables: [...tables.values()], paddedRows, broken };
}

function openTable(name: string, line: number, tables: ReadonlyMap<string, OpenTable>): OpenTable {
  if (name === "") {
    throw new XerFileError("This %T table line has no table name.", line);
  }
  const previous = tables.get(name);
  if (previous !== undefined) {
    throw new XerFileError(
      `Table ${name} appears twice, on lines ${previous.line} and ${line}.`,
      line,
    );
  }
  return {
    name,
    line,
    used: asUsedTable(name),
    columns: null,
    rows: [],
    rowCount: 0,
    everyRowHasExtraFields: true,
  };
}

function addRow(table: OpenTable, columnCount: number, row: PendingRow): void {
  table.rowCount += 1;
  const hasExtraFields = row.values.length > columnCount;
  table.everyRowHasExtraFields &&= hasExtraFields;
  if (table.used !== null || hasExtraFields || row.controlCharacters.length > 0) {
    table.rows.push(row);
  }
}

function finishTables(tables: readonly OpenTable[]): FinishedTables {
  const used = new Map<UsedTable, RawTable>();
  const broken: BrokenRow[] = [];
  let trimmedRows: RowSpan | null = null;

  for (const table of tables) {
    const { columns } = table;
    if (columns === null) {
      if (table.used !== null) {
        throw new XerFileError(`Table ${table.name} has no %F column line.`, table.line);
      }
      continue;
    }
    const trimsEmptyFields = table.rowCount > 0 && table.everyRowHasExtraFields;
    const rows: RawRow[] = [];
    for (const row of table.rows) {
      const trimmed = trimsEmptyFields && endsInEmptyFields(row.values, columns.length);
      if (trimmed) {
        trimmedRows = addToSpan(trimmedRows, row.line);
      }
      rows.push(finishRow(row, columns.length, trimmed));
    }
    if (table.used !== null) {
      used.set(table.used, { name: table.used, line: table.line, columns, rows });
      continue;
    }
    for (const row of rows) {
      if (row.problems.length > 0) {
        broken.push({
          line: row.line,
          table: table.name,
          subject: null,
          problems: row.problems,
          effect: { kind: "not-used" },
        });
      }
    }
  }
  return { used, trimmedRows, broken };
}

function finishRow(row: PendingRow, columnCount: number, trimmed: boolean): RawRow {
  const values = trimmed ? row.values.slice(0, columnCount) : row.values;
  const problems: Problem[] = [];
  if (values.length > columnCount) {
    problems.push({ kind: "extra-fields", fields: values.length, columns: columnCount });
  }
  if (row.controlCharacters.length > 0) {
    problems.push({ kind: "damaged-text", codePoints: row.controlCharacters });
  }
  return { line: row.line, values: padTo(values, columnCount), problems };
}

function endsInEmptyFields(values: readonly string[], columnCount: number): boolean {
  return values.length > columnCount && values.slice(columnCount).every((value) => value === "");
}

function controlCharactersIn(content: string): number[] {
  const found = new Set<number>();
  for (const [character] of content.matchAll(CONTROL_CHARACTER_EXCEPT_TAB_AND_DELETE)) {
    found.add(character.charCodeAt(0));
  }
  return [...found].sort((a, b) => a - b);
}

function padTo(values: readonly string[], length: number): readonly string[] {
  if (values.length >= length) {
    return values;
  }
  return [...values, ...Array.from({ length: length - values.length }, () => "")];
}

function addToSpan(span: RowSpan | null, line: number): RowSpan {
  return span === null ? { count: 1, firstLine: line } : { ...span, count: span.count + 1 };
}

function ignoredLine(line: number, table: string | null, problem: Problem): BrokenRow {
  return { line, table, subject: null, problems: [problem], effect: { kind: "row-ignored" } };
}

function asUsedTable(name: string): UsedTable | null {
  return USED_TABLES.find((used) => used === name) ?? null;
}

function withoutCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}
