import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Analysis,
  type CheckedAnalysis,
  checkSchedule,
  type ParsedSchedule,
  parseXer,
} from "../../src/core/analyze.ts";
import { readXer } from "../../src/core/xer/read.ts";
import { buildSchedule, type Schedule } from "../../src/core/xer/schedule.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export type XerLine = readonly string[];

export function xerBytes(lines: readonly XerLine[]): Uint8Array {
  return new TextEncoder().encode(`${lines.map((fields) => fields.join("\t")).join("\n")}\n`);
}

export interface TaskSpec {
  readonly id: string;
  readonly project?: string;
  readonly code?: string;
  readonly type?: string;
  readonly status?: string;
  readonly floatHours?: string;
  readonly calendar?: string;
}

export interface LinkSpec {
  readonly predecessor: string;
  readonly successor: string;
  readonly type?: string;
  readonly lagHours?: string;
}

export interface ScheduleSpec {
  readonly calendars?: readonly (readonly [id: string, hoursPerDay: string])[];
  readonly tasks: readonly TaskSpec[];
  readonly links?: readonly LinkSpec[];
}

export const HEADER: XerLine = ["ERMHDR", "17.12", "2026-11-12", "Project", "admin", "Test"];

export const TASK_COLUMNS: XerLine = [
  "%F",
  "task_id",
  "proj_id",
  "clndr_id",
  "task_code",
  "task_name",
  "task_type",
  "status_code",
  "total_float_hr_cnt",
];

export function scheduleXer({
  calendars = [["1", "8"]],
  tasks,
  links = [],
}: ScheduleSpec): Uint8Array {
  return xerBytes([
    HEADER,
    ["%T", "CALENDAR"],
    ["%F", "clndr_id", "clndr_name", "day_hr_cnt"],
    ...calendars.map(([id, hours]): XerLine => ["%R", id, `Calendar ${id}`, hours]),
    ["%T", "TASK"],
    TASK_COLUMNS,
    ...tasks.map(
      (task): XerLine => [
        "%R",
        task.id,
        task.project ?? "1",
        task.calendar ?? "1",
        task.code ?? `A${task.id}`,
        `Activity ${task.id}`,
        task.type ?? "TT_Task",
        task.status ?? "TK_NotStart",
        task.floatHours ?? "0",
      ],
    ),
    ["%T", "TASKPRED"],
    ["%F", "task_pred_id", "task_id", "pred_task_id", "pred_type", "lag_hr_cnt"],
    ...links.map(
      (link, index): XerLine => [
        "%R",
        String(index + 1),
        link.successor,
        link.predecessor,
        link.type ?? "PR_FS",
        link.lagHours ?? "0",
      ],
    ),
    ["%E"],
  ]);
}

export function chain(ids: readonly string[]): LinkSpec[] {
  return ids.slice(1).flatMap((successor, index) => {
    const predecessor = ids[index];
    return predecessor === undefined ? [] : [{ predecessor, successor }];
  });
}

export function scheduleFrom(spec: ScheduleSpec): Schedule {
  return buildSchedule(readXer(scheduleXer(spec)));
}

export function repoFile(pathFromRoot: string): Uint8Array {
  return readFileSync(resolve(REPO_ROOT, pathFromRoot));
}

export function analyzeXer(bytes: Uint8Array, hoursPerDay: number | null = null): Analysis {
  const parsed = parseXer(bytes, hoursPerDay);
  return parsed.kind === "parsed" ? checkSchedule(parsed) : parsed;
}

export function parsedFile(bytes: Uint8Array): ParsedSchedule {
  const result = parseXer(bytes);
  if (result.kind !== "parsed") {
    throw new Error(`The file was not read: ${JSON.stringify(result)}`);
  }
  return result;
}

export function checkedFile(pathFromRoot: string): CheckedAnalysis {
  const analysis = analyzeXer(repoFile(pathFromRoot));
  if (analysis.kind !== "checked") {
    throw new Error(`${pathFromRoot} was not checked: ${JSON.stringify(analysis)}`);
  }
  return analysis;
}
