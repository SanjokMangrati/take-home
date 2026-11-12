import type { Note } from "../core/analyze.ts";
import type { Relationship } from "../core/compare.ts";
import type { Effect, Problem } from "../core/xer/problems.ts";
import { type ActivityStatus, FLOAT_COLUMN, MAX_HOURS_PER_DAY } from "../core/xer/schedule.ts";
import { countOf, formatHours } from "./format.ts";

const STATUS_LABELS: Readonly<Record<ActivityStatus, string>> = {
  TK_NotStart: "Not started",
  TK_Active: "In progress",
  TK_Complete: "Complete",
};

export function describeStatus(status: ActivityStatus): string {
  return STATUS_LABELS[status];
}

export function describeRelationships(relationships: readonly Relationship[]): string {
  if (relationships.length === 0) {
    return "Not linked";
  }
  return relationships.map(describeRelationship).join(", ");
}

function describeRelationship({ type, lagHours }: Relationship): string {
  const shortType = type.replace("PR_", "");
  if (lagHours === null) {
    return `${shortType}, lag not a number`;
  }
  return lagHours === 0 ? shortType : `${shortType} with ${formatHours(lagHours)} lag`;
}

export function describeProblem(problem: Problem): string {
  switch (problem.kind) {
    case "extra-fields":
      return `Has ${problem.fields} fields, but the table has ${problem.columns} columns, so some values may be in the wrong columns. This usually means a value contains a tab.`;
    case "damaged-text":
      return `Contains control characters (${problem.codePoints.map(codePointLabel).join(", ")}), so its text is damaged.`;
    case "not-a-row": {
      const hint =
        problem.previousLine === null
          ? ""
          : ` It may be the rest of line ${problem.previousLine}, split by a line break inside a value.`;
      return `Does not start with %T, %F, %R or %E, so it is not a row.${hint}`;
    }
    case "row-before-columns":
      return "Comes before the %F column line of its table.";
    case "text-after-end":
      return "Comes after the %E end line.";
    case "missing-value":
      return `${problem.column} is empty.`;
    case "missing-float":
      return `${FLOAT_COLUMN} is empty. Schedule the project in P6 (F9), then export it again.`;
    case "not-an-integer":
      return `${problem.column} is "${problem.value}", which is not a whole number.`;
    case "not-a-number":
      return `${problem.column} is "${problem.value}", which is not a number.`;
    case "number-too-large":
      return `${problem.column} is too large to read as a number.`;
    case "unknown-value":
      return `${problem.column} is "${problem.value}", which is not a P6 value.`;
    case "duplicate-id":
      return `${problem.column} ${problem.value} is already used on line ${problem.firstLine}.`;
    case "calendar-not-in-file":
      return `Calendar ${problem.calendarId} is not in the file.`;
    case "calendar-broken":
      return `Calendar ${problem.calendarId} is the broken row on line ${problem.line}.`;
    case "hours-per-day-out-of-range":
      return `Hours per day is ${problem.value}. It must be more than 0 and at most ${MAX_HOURS_PER_DAY}.`;
    case "self-link":
      return "Has the same activity as predecessor and successor.";
    case "link-end-not-in-file":
      return `${linkEnd(problem.column)} ${problem.taskId} is not in the file. It may belong to another project.`;
    case "link-end-broken":
      return `${linkEnd(problem.column)} ${problem.taskId} is the broken row on line ${problem.line}.`;
  }
}

export function describeEffect(effect: Effect): string {
  switch (effect.kind) {
    case "not-used":
      return "Not used by the checks.";
    case "row-ignored":
      return "Not read.";
    case "still-used":
      return "Still used by the checks.";
    case "activity-not-read":
      return "Activity not read, so no check counts it.";
    case "left-out-of-float-checks":
      return "Left out of the negative and high float checks.";
    case "left-out-of-high-float-check":
      return "Left out of the high float check.";
    case "link-not-counted":
      return "Relationship not counted.";
    case "calendar-unusable":
      return effect.activities === 0
        ? "No open activity with a float value uses this calendar."
        : `${countOf(effect.activities, "activity", "activities")} on this calendar left out of the high float check.`;
  }
}

export function describeNote(note: Note): string {
  switch (note.kind) {
    case "padded-rows":
      return `${countOf(note.count, "row ends", "rows end")} early, starting at line ${note.firstLine}. P6 leaves out empty fields at the end of a row, so the checker filled them in as empty.`;
    case "trimmed-rows":
      return `Removed empty fields after the last column from ${countOf(note.count, "row", "rows")}, starting at line ${note.firstLine}. Every row in those tables has fields after the last column, so the tool that wrote the file added them.`;
    case "hours-per-day-entered":
      return `This file does not include the work hours in a day, so float is counted in days of ${note.hours} hours, the value you entered.`;
    case "no-relationship-table":
      return "This file has no TASKPRED table, so it has no relationships between activities.";
    case "several-projects":
      return `This file holds ${note.count} projects. The checks count them together.`;
  }
}

function codePointLabel(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

function linkEnd(column: string): string {
  return column === "pred_task_id" ? "Predecessor" : "Successor";
}
