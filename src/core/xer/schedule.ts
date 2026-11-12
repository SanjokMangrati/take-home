import { type BrokenRow, type Effect, type Problem, XerFileError } from "./problems.ts";
import type { RawRow, RawTable, UsedTable, XerContents } from "./read.ts";

const TASK_TYPES = ["TT_Task", "TT_Rsrc", "TT_LOE", "TT_Mile", "TT_FinMile", "TT_WBS"] as const;
const ACTIVITY_STATUSES = ["TK_NotStart", "TK_Active", "TK_Complete"] as const;
const LINK_TYPES = ["PR_FS", "PR_SS", "PR_FF", "PR_SF"] as const;

type TaskType = (typeof TASK_TYPES)[number];

export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export type LinkType = (typeof LINK_TYPES)[number];

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly dataDate: string | null;
  readonly scheduledFinish: string | null;
  readonly mustFinishBy: string | null;
  readonly line: number;
}

export interface Activity {
  readonly id: string;
  readonly projectId: string;
  readonly code: string;
  readonly name: string;
  readonly type: TaskType;
  readonly status: ActivityStatus;
  readonly line: number;
  readonly checked: boolean;
  readonly calendarId: string;
  readonly totalFloatHours: number | null;
  readonly hoursPerDay: number | null;
}

export interface Link {
  readonly predecessorId: string;
  readonly successorId: string;
  readonly type: LinkType;
  readonly lagHours: number | null;
  readonly line: number;
}

export interface Schedule {
  readonly projects: readonly Project[];
  readonly activities: readonly Activity[];
  readonly links: readonly Link[];
  readonly hasRelationshipTable: boolean;
  readonly broken: readonly BrokenRow[];
}

interface Calendar {
  readonly line: number;
  readonly name: string;
  readonly hoursPerDay: number | null;
  readonly problems: readonly Problem[];
}

type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: Problem };

type FieldReader = (row: RawRow, column: string) => string;

const UNCHECKED_TYPES: ReadonlySet<TaskType> = new Set(["TT_LOE", "TT_WBS"]);
const WHOLE_NUMBER = /^\d+$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;
const HOURS_PER_DAY_COLUMN = "day_hr_cnt";
export const FLOAT_COLUMN = "total_float_hr_cnt";
const LAG_COLUMN = "lag_hr_cnt";
const columnList = new Intl.ListFormat("en-GB", { type: "conjunction" });

export const MAX_HOURS_PER_DAY = 24;

export function isHoursPerDayInRange(hours: number): boolean {
  return hours > 0 && hours <= MAX_HOURS_PER_DAY;
}

export function calendarTableWithoutHours(contents: XerContents): RawTable | null {
  const table = contents.tables.get("CALENDAR");
  if (table === undefined) {
    return null;
  }
  const column = table.columns.indexOf(HOURS_PER_DAY_COLUMN);
  const hasHours = column !== -1 && table.rows.some((row) => row.values[column] !== "");
  return hasHours ? null : table;
}

export function buildSchedule(
  contents: XerContents,
  hoursPerDayForEveryCalendar: number | null = null,
): Schedule {
  const taskTable = requireTable(contents, "TASK", "there are no activities to check");
  const calendarTable = requireTable(contents, "CALENDAR", "float cannot be converted to days");
  const linkTable = contents.tables.get("TASKPRED") ?? null;
  const projectTable = contents.tables.get("PROJECT") ?? null;

  const broken: BrokenRow[] = [];
  const calendars = readCalendars(calendarTable, hoursPerDayForEveryCalendar, broken);
  const calendarLines = firstLineById(calendarTable, "clndr_id");
  const activities = readActivities(taskTable, calendars, calendarLines, broken);
  const activityLines = firstLineById(taskTable, "task_id");
  const links = linkTable === null ? [] : readLinks(linkTable, activities, activityLines, broken);
  reportCalendars(calendars, activities, broken);
  const projects = projectTable === null ? [] : readProjects(projectTable, broken);

  return { projects, activities, links, hasRelationshipTable: linkTable !== null, broken };
}

function readCalendars(
  table: RawTable,
  hoursPerDayForEveryCalendar: number | null,
  broken: BrokenRow[],
): Map<string, Calendar> {
  const field = fieldReader(table, ["clndr_id"]);
  const calendars = new Map<string, Calendar>();

  for (const row of table.rows) {
    const rawId = field(row, "clndr_id");
    const name = field(row, "clndr_name");
    const subject = name || rawId || null;
    const ignore = (problem: Problem) =>
      broken.push(
        brokenRow(table, row, subject, [...row.problems, problem], { kind: "row-ignored" }),
      );

    const id = parseId("clndr_id", rawId);
    if (!id.ok) {
      ignore(id.problem);
      continue;
    }
    const first = calendars.get(id.value);
    if (first !== undefined) {
      ignore(duplicateId("clndr_id", id.value, first.line));
      continue;
    }
    const calendar = { line: row.line, name: name || id.value };
    if (columnsMayBeShifted(row.problems)) {
      calendars.set(id.value, { ...calendar, hoursPerDay: null, problems: row.problems });
      continue;
    }
    const hours =
      hoursPerDayForEveryCalendar === null
        ? parseHoursPerDay(field(row, HOURS_PER_DAY_COLUMN))
        : checkHoursPerDay(hoursPerDayForEveryCalendar);
    calendars.set(id.value, {
      ...calendar,
      hoursPerDay: hours.ok ? hours.value : null,
      problems: [...row.problems, ...problemOf(hours)],
    });
  }
  return calendars;
}

function readActivities(
  table: RawTable,
  calendars: ReadonlyMap<string, Calendar>,
  calendarLines: ReadonlyMap<string, number>,
  broken: BrokenRow[],
): Activity[] {
  const field = fieldReader(table, [
    "task_id",
    "task_code",
    "task_name",
    "task_type",
    "status_code",
    "clndr_id",
    FLOAT_COLUMN,
  ]);
  const activities: Activity[] = [];
  const activityLineById = new Map<string, number>();

  for (const row of table.rows) {
    const code = field(row, "task_code");
    const rawId = field(row, "task_id");
    const subject = code || rawId || null;
    const report = (problems: readonly Problem[], effect: Effect) =>
      broken.push(brokenRow(table, row, subject, problems, effect));

    if (columnsMayBeShifted(row.problems)) {
      report(row.problems, { kind: "activity-not-read" });
      continue;
    }
    const id = parseId("task_id", rawId);
    const type = parseEnum("task_type", field(row, "task_type"), TASK_TYPES);
    const status = parseEnum("status_code", field(row, "status_code"), ACTIVITY_STATUSES);
    if (!id.ok || !type.ok || !status.ok || code === "") {
      const fieldProblems = [
        ...problemOf(id),
        ...(code === "" ? [missingValue("task_code")] : []),
        ...problemOf(type),
        ...problemOf(status),
      ];
      report([...row.problems, ...fieldProblems], { kind: "activity-not-read" });
      continue;
    }
    const firstLine = activityLineById.get(id.value);
    if (firstLine !== undefined) {
      report([...row.problems, duplicateId("task_id", id.value, firstLine)], {
        kind: "activity-not-read",
      });
      continue;
    }
    activityLineById.set(id.value, row.line);

    const checked = status.value !== "TK_Complete" && !UNCHECKED_TYPES.has(type.value);
    const calendarId = field(row, "clndr_id");
    const activity = {
      id: id.value,
      projectId: field(row, "proj_id"),
      code,
      name: field(row, "task_name"),
      type: type.value,
      status: status.value,
      line: row.line,
      checked,
      calendarId,
    };
    if (!checked) {
      activities.push({ ...activity, totalFloatHours: null, hoursPerDay: null });
      if (row.problems.length > 0) {
        report(row.problems, { kind: "still-used" });
      }
      continue;
    }

    const float = parseFloatHours(field(row, FLOAT_COLUMN));
    const calendar = calendars.get(calendarId);
    activities.push({
      ...activity,
      totalFloatHours: float.ok ? float.value : null,
      hoursPerDay: calendar?.hoursPerDay ?? null,
    });
    const problems = [
      ...row.problems,
      ...problemOf(float),
      ...(calendar === undefined ? [calendarNotFound(calendarId, calendarLines)] : []),
    ];
    if (problems.length > 0) {
      report(problems, checkedActivityEffect(float.ok, calendar !== undefined));
    }
  }
  return activities;
}

function firstLineById(table: RawTable, column: string): ReadonlyMap<string, number> {
  const field = fieldReader(table, [column]);
  const lines = new Map<string, number>();
  for (const row of table.rows) {
    const id = field(row, column);
    if (!lines.has(id)) {
      lines.set(id, row.line);
    }
  }
  return lines;
}

function readLinks(
  table: RawTable,
  activities: readonly Activity[],
  activityLines: ReadonlyMap<string, number>,
  broken: BrokenRow[],
): Link[] {
  const field = fieldReader(table, ["task_id", "pred_task_id", "pred_type"]);
  const codeById = new Map(activities.map((activity) => [activity.id, activity.code]));
  const label = (id: string) => codeById.get(id) ?? (id || "?");
  const links: Link[] = [];

  for (const row of table.rows) {
    const predecessorId = field(row, "pred_task_id");
    const successorId = field(row, "task_id");
    const report = (problems: readonly Problem[], effect: Effect) => {
      const subject = `${label(predecessorId)} → ${label(successorId)}`;
      broken.push(brokenRow(table, row, subject, problems, effect));
    };

    if (columnsMayBeShifted(row.problems)) {
      report(row.problems, { kind: "link-not-counted" });
      continue;
    }
    const successor = parseId("task_id", successorId);
    const predecessor = parseId("pred_task_id", predecessorId);
    const type = parseEnum("pred_type", field(row, "pred_type"), LINK_TYPES);
    if (!successor.ok || !predecessor.ok || !type.ok) {
      const fieldProblems = [
        ...problemOf(successor),
        ...problemOf(predecessor),
        ...problemOf(type),
      ];
      report([...row.problems, ...fieldProblems], { kind: "link-not-counted" });
      continue;
    }
    const endProblems: Problem[] =
      successor.value === predecessor.value
        ? [{ kind: "self-link" }]
        : [
            ...linkEndProblems("pred_task_id", predecessor.value, codeById, activityLines),
            ...linkEndProblems("task_id", successor.value, codeById, activityLines),
          ];
    if (endProblems.length > 0) {
      report([...row.problems, ...endProblems], { kind: "link-not-counted" });
      continue;
    }
    links.push({
      predecessorId: predecessor.value,
      successorId: successor.value,
      type: type.value,
      lagHours: parseLagHours(field(row, LAG_COLUMN)),
      line: row.line,
    });
    if (row.problems.length > 0) {
      report(row.problems, { kind: "still-used" });
    }
  }
  return links;
}

function linkEndProblems(
  column: string,
  taskId: string,
  codeById: ReadonlyMap<string, string>,
  activityLines: ReadonlyMap<string, number>,
): Problem[] {
  if (codeById.has(taskId)) {
    return [];
  }
  const line = activityLines.get(taskId);
  return line === undefined
    ? [{ kind: "link-end-not-in-file", column, taskId }]
    : [{ kind: "link-end-broken", column, taskId, line }];
}

function reportCalendars(
  calendars: ReadonlyMap<string, Calendar>,
  activities: readonly Activity[],
  broken: BrokenRow[],
): void {
  const floatActivitiesByCalendar = new Map<string, number>();
  for (const activity of activities) {
    if (activity.checked && activity.totalFloatHours !== null) {
      const count = floatActivitiesByCalendar.get(activity.calendarId) ?? 0;
      floatActivitiesByCalendar.set(activity.calendarId, count + 1);
    }
  }
  for (const [id, calendar] of calendars) {
    if (calendar.problems.length === 0) {
      continue;
    }
    const effect: Effect =
      calendar.hoursPerDay === null
        ? { kind: "calendar-unusable", activities: floatActivitiesByCalendar.get(id) ?? 0 }
        : { kind: "still-used" };
    broken.push({
      line: calendar.line,
      table: "CALENDAR",
      subject: calendar.name,
      problems: calendar.problems,
      effect,
    });
  }
}

function readProjects(table: RawTable, broken: BrokenRow[]): Project[] {
  const field = fieldReader(table, []);
  return table.rows.map((row) => {
    const name = field(row, "proj_short_name");
    if (row.problems.length > 0) {
      broken.push(brokenRow(table, row, name || null, row.problems, { kind: "not-used" }));
    }
    return {
      id: field(row, "proj_id"),
      name,
      dataDate: dateOf(field(row, "last_recalc_date")),
      scheduledFinish: dateOf(field(row, "scd_end_date")),
      mustFinishBy: dateOf(field(row, "plan_end_date")),
      line: row.line,
    };
  });
}

function dateOf(value: string): string | null {
  return DATE_PREFIX.exec(value)?.[0] ?? null;
}

function parseLagHours(value: string): number | null {
  const hours = parseDecimal(LAG_COLUMN, value);
  return hours.ok ? hours.value : null;
}

function checkedActivityEffect(hasFloat: boolean, hasCalendar: boolean): Effect {
  if (!hasFloat) {
    return { kind: "left-out-of-float-checks" };
  }
  if (!hasCalendar) {
    return { kind: "left-out-of-high-float-check" };
  }
  return { kind: "still-used" };
}

function requireTable(contents: XerContents, name: UsedTable, consequence: string): RawTable {
  const table = contents.tables.get(name);
  if (table === undefined) {
    throw new XerFileError(`This file has no ${name} table, so ${consequence}.`);
  }
  return table;
}

function fieldReader(table: RawTable, required: readonly string[]): FieldReader {
  const indexByColumn = new Map(table.columns.map((column, index) => [column, index]));
  const missing = required.filter((column) => !indexByColumn.has(column));
  if (missing.length > 0) {
    const noun = missing.length === 1 ? "column" : "columns";
    throw new XerFileError(
      `Table ${table.name} is missing the ${columnList.format(missing)} ${noun}.`,
      table.line,
    );
  }
  return (row, column) => {
    const index = indexByColumn.get(column);
    return index === undefined ? "" : (row.values[index] ?? "");
  };
}

function parseId(column: string, value: string): Parsed<string> {
  if (value === "") {
    return { ok: false, problem: missingValue(column) };
  }
  return WHOLE_NUMBER.test(value)
    ? { ok: true, value }
    : { ok: false, problem: { kind: "not-an-integer", column, value } };
}

function parseEnum<T extends string>(
  column: string,
  value: string,
  allowed: readonly T[],
): Parsed<T> {
  if (value === "") {
    return { ok: false, problem: missingValue(column) };
  }
  const match = allowed.find((candidate) => candidate === value);
  return match === undefined
    ? { ok: false, problem: { kind: "unknown-value", column, value } }
    : { ok: true, value: match };
}

function parseDecimal(column: string, value: string): Parsed<number> {
  if (value === "") {
    return { ok: false, problem: missingValue(column) };
  }
  if (!DECIMAL.test(value)) {
    return { ok: false, problem: { kind: "not-a-number", column, value } };
  }
  const number = Number(value);
  return Number.isFinite(number)
    ? { ok: true, value: number }
    : { ok: false, problem: { kind: "number-too-large", column, value } };
}

function parseFloatHours(value: string): Parsed<number> {
  return value === ""
    ? { ok: false, problem: { kind: "missing-float" } }
    : parseDecimal(FLOAT_COLUMN, value);
}

function parseHoursPerDay(value: string): Parsed<number> {
  const hours = parseDecimal(HOURS_PER_DAY_COLUMN, value);
  return hours.ok ? checkHoursPerDay(hours.value) : hours;
}

function checkHoursPerDay(hours: number): Parsed<number> {
  return isHoursPerDayInRange(hours)
    ? { ok: true, value: hours }
    : { ok: false, problem: { kind: "hours-per-day-out-of-range", value: hours } };
}

function problemOf<T>(parsed: Parsed<T>): Problem[] {
  return parsed.ok ? [] : [parsed.problem];
}

function missingValue(column: string): Problem {
  return { kind: "missing-value", column };
}

function duplicateId(column: string, value: string, firstLine: number): Problem {
  return { kind: "duplicate-id", column, value, firstLine };
}

function calendarNotFound(calendarId: string, calendarLines: ReadonlyMap<string, number>): Problem {
  if (calendarId === "") {
    return missingValue("clndr_id");
  }
  const line = calendarLines.get(calendarId);
  return line === undefined
    ? { kind: "calendar-not-in-file", calendarId }
    : { kind: "calendar-broken", calendarId, line };
}

function columnsMayBeShifted(problems: readonly Problem[]): boolean {
  return problems.some((problem) => problem.kind === "extra-fields");
}

function brokenRow(
  table: RawTable,
  row: RawRow,
  subject: string | null,
  problems: readonly Problem[],
  effect: Effect,
): BrokenRow {
  return { line: row.line, table: table.name, subject, problems, effect };
}
