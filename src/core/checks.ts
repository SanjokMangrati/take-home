import type { Activity, Link } from "./xer/schedule.ts";

export const MISSING_LINKS_LIMIT_PERCENT = 5;
export const NEGATIVE_FLOAT_LIMIT_PERCENT = 0;
export const HIGH_FLOAT_LIMIT_PERCENT = 5;
export const HIGH_FLOAT_THRESHOLD_DAYS = 44;

export type CheckStatus = "pass" | "fail" | "nothing-to-check";

export interface CheckSummary {
  readonly counted: number;
  readonly leftOut: number;
  readonly flagged: number;
  readonly status: CheckStatus;
}

export interface MissingLinkFinding {
  readonly activity: Activity;
  readonly noPredecessor: boolean;
  readonly noSuccessor: boolean;
}

export interface FloatFinding {
  readonly activity: Activity;
  readonly floatDays: number | null;
}

export interface Check<Finding> {
  readonly summary: CheckSummary;
  readonly findings: readonly Finding[];
}

export interface CheckResults {
  readonly missingLinks: Check<MissingLinkFinding>;
  readonly negativeFloat: Check<FloatFinding>;
  readonly highFloat: Check<FloatFinding>;
}

export interface LinkedActivities {
  readonly activities: readonly Activity[];
  readonly links: readonly Link[];
}

export const byActivityCode = new Intl.Collator("en", { numeric: true }).compare;
const DAYS_TO_FOUR_DECIMALS = 10_000;

export function runChecks(schedule: LinkedActivities): CheckResults {
  const checked = schedule.activities.filter((activity) => activity.checked);
  return {
    missingLinks: missingLinks(checked, schedule),
    negativeFloat: negativeFloat(checked),
    highFloat: highFloat(checked),
  };
}

export function floatDays(activity: Activity): number | null {
  if (activity.totalFloatHours === null || activity.hoursPerDay === null) {
    return null;
  }
  const days = activity.totalFloatHours / activity.hoursPerDay;
  return Number.isFinite(days) ? roundDays(days) : null;
}

export function roundDays(days: number): number {
  return Math.round(days * DAYS_TO_FOUR_DECIMALS) / DAYS_TO_FOUR_DECIMALS;
}

function missingLinks(
  checked: readonly Activity[],
  schedule: LinkedActivities,
): Check<MissingLinkFinding> {
  const withPredecessor = new Set(schedule.links.map((link) => link.successorId));
  const withSuccessor = new Set(schedule.links.map((link) => link.predecessorId));
  const projectStarts = onlyOnePerProject(
    schedule.activities.filter(
      (activity) => activity.type === "TT_Mile" && !withPredecessor.has(activity.id),
    ),
  );
  const projectFinishes = onlyOnePerProject(
    schedule.activities.filter(
      (activity) => activity.type === "TT_FinMile" && !withSuccessor.has(activity.id),
    ),
  );
  const findings = checked
    .map((activity) => ({
      activity,
      noPredecessor: !withPredecessor.has(activity.id) && !projectStarts.has(activity),
      noSuccessor: !withSuccessor.has(activity.id) && !projectFinishes.has(activity),
    }))
    .filter((finding) => finding.noPredecessor || finding.noSuccessor)
    .sort((a, b) => byActivityCode(a.activity.code, b.activity.code));
  return {
    summary: summarize(
      checked.length,
      checked.length,
      findings.length,
      MISSING_LINKS_LIMIT_PERCENT,
    ),
    findings,
  };
}

function negativeFloat(checked: readonly Activity[]): Check<FloatFinding> {
  const measured = checked.filter(hasFloat);
  const findings = measured
    .filter((activity) => activity.totalFloatHours < 0)
    .map((activity) => ({ activity, floatDays: floatDays(activity) }))
    .sort(
      (a, b) =>
        byNumberNullsLast(a.floatDays, b.floatDays) ||
        byActivityCode(a.activity.code, b.activity.code),
    );
  return {
    summary: summarize(
      checked.length,
      measured.length,
      findings.length,
      NEGATIVE_FLOAT_LIMIT_PERCENT,
    ),
    findings,
  };
}

function highFloat(checked: readonly Activity[]): Check<FloatFinding> {
  const measured = checked.flatMap((activity) => {
    const days = floatDays(activity);
    return days === null ? [] : [{ activity, floatDays: days }];
  });
  const findings = measured
    .filter((finding) => finding.floatDays > HIGH_FLOAT_THRESHOLD_DAYS)
    .sort(
      (a, b) =>
        byNumberNullsLast(b.floatDays, a.floatDays) ||
        byActivityCode(a.activity.code, b.activity.code),
    );
  return {
    summary: summarize(checked.length, measured.length, findings.length, HIGH_FLOAT_LIMIT_PERCENT),
    findings,
  };
}

function summarize(
  checked: number,
  counted: number,
  flagged: number,
  limitPercent: number,
): CheckSummary {
  return {
    counted,
    leftOut: checked - counted,
    flagged,
    status: percentStatus(flagged, counted, limitPercent),
  };
}

function hasFloat(activity: Activity): activity is Activity & { readonly totalFloatHours: number } {
  return activity.totalFloatHours !== null;
}

function onlyOnePerProject(activities: readonly Activity[]): ReadonlySet<Activity> {
  const countByProject = new Map<string, number>();
  for (const activity of activities) {
    countByProject.set(activity.projectId, (countByProject.get(activity.projectId) ?? 0) + 1);
  }
  return new Set(activities.filter((activity) => countByProject.get(activity.projectId) === 1));
}

export function byNumberNullsLast(a: number | null, b: number | null): number {
  if (a === null || b === null) {
    return Number(a === null) - Number(b === null);
  }
  return a - b;
}

function percentStatus(flagged: number, counted: number, limitPercent: number): CheckStatus {
  if (counted === 0) {
    return "nothing-to-check";
  }
  return flagged * 100 <= limitPercent * counted ? "pass" : "fail";
}
