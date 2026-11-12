import { type CheckResults, floatDays, runChecks } from "./checks.ts";
import {
  type BrokenRow,
  byLine,
  MAX_BROKEN_ROWS,
  tooManyBrokenRows,
  XerFileError,
} from "./xer/problems.ts";
import { readXer, type XerContents } from "./xer/read.ts";
import {
  type Activity,
  buildSchedule,
  calendarTableWithoutHours,
  type Link,
  type Project,
  type Schedule,
} from "./xer/schedule.ts";

export interface FileFacts {
  readonly p6Version: string;
  readonly activityCount: number;
  readonly checkedActivityCount: number;
  readonly linkCount: number;
  readonly projects: readonly Project[];
}

export type Note =
  | { readonly kind: "padded-rows"; readonly count: number; readonly firstLine: number }
  | { readonly kind: "trimmed-rows"; readonly count: number; readonly firstLine: number }
  | { readonly kind: "no-relationship-table" }
  | { readonly kind: "several-projects"; readonly count: number }
  | { readonly kind: "hours-per-day-entered"; readonly hours: number };

export interface ParsedSchedule {
  readonly kind: "parsed";
  readonly p6Version: string;
  readonly projects: readonly Project[];
  readonly activities: readonly Activity[];
  readonly links: readonly Link[];
  readonly broken: readonly BrokenRow[];
  readonly notes: readonly Note[];
}

export interface CheckedAnalysis {
  readonly kind: "checked";
  readonly facts: FileFacts;
  readonly checks: CheckResults;
  readonly floatDays: readonly number[];
  readonly broken: readonly BrokenRow[];
  readonly notes: readonly Note[];
}

export interface RejectedAnalysis {
  readonly kind: "rejected";
  readonly reason: string;
  readonly line: number | null;
}

export interface NeedsHoursPerDayAnalysis {
  readonly kind: "needs-hours-per-day";
  readonly line: number;
}

export type ParseResult = ParsedSchedule | RejectedAnalysis | NeedsHoursPerDayAnalysis;

export type Analysis = CheckedAnalysis | RejectedAnalysis | NeedsHoursPerDayAnalysis;

export function parseXer(bytes: Uint8Array, hoursPerDay: number | null = null): ParseResult {
  try {
    const contents = readXer(bytes);
    const calendarsWithoutHours = calendarTableWithoutHours(contents);
    if (calendarsWithoutHours !== null && hoursPerDay === null) {
      return { kind: "needs-hours-per-day", line: calendarsWithoutHours.line };
    }
    const enteredHoursPerDay = calendarsWithoutHours === null ? null : hoursPerDay;
    const schedule = buildSchedule(contents, enteredHoursPerDay);
    const broken = [...contents.broken, ...schedule.broken].sort(byLine);
    const firstOverLimit = broken[MAX_BROKEN_ROWS];
    if (firstOverLimit !== undefined) {
      throw tooManyBrokenRows(firstOverLimit.line);
    }
    return {
      kind: "parsed",
      p6Version: contents.p6Version,
      projects: schedule.projects,
      activities: schedule.activities,
      links: schedule.links,
      broken,
      notes: notesFor(contents, schedule, enteredHoursPerDay),
    };
  } catch (error) {
    if (error instanceof XerFileError) {
      return { kind: "rejected", reason: error.message, line: error.line };
    }
    throw error;
  }
}

export function checkSchedule(schedule: ParsedSchedule): CheckedAnalysis {
  const checked = schedule.activities.filter((activity) => activity.checked);
  return {
    kind: "checked",
    facts: {
      p6Version: schedule.p6Version,
      activityCount: schedule.activities.length,
      checkedActivityCount: checked.length,
      linkCount: schedule.links.length,
      projects: schedule.projects,
    },
    checks: runChecks(schedule),
    floatDays: checked.flatMap((activity) => floatDays(activity) ?? []),
    broken: schedule.broken,
    notes: schedule.notes,
  };
}

function notesFor(
  contents: XerContents,
  schedule: Schedule,
  enteredHoursPerDay: number | null,
): Note[] {
  const notes: Note[] = [];
  if (contents.paddedRows !== null) {
    notes.push({ kind: "padded-rows", ...contents.paddedRows });
  }
  if (contents.trimmedRows !== null) {
    notes.push({ kind: "trimmed-rows", ...contents.trimmedRows });
  }
  if (enteredHoursPerDay !== null) {
    notes.push({ kind: "hours-per-day-entered", hours: enteredHoursPerDay });
  }
  if (!schedule.hasRelationshipTable) {
    notes.push({ kind: "no-relationship-table" });
  }
  if (schedule.projects.length > 1) {
    notes.push({ kind: "several-projects", count: schedule.projects.length });
  }
  return notes;
}
