import {
  type CheckResults,
  HIGH_FLOAT_LIMIT_PERCENT,
  HIGH_FLOAT_THRESHOLD_DAYS,
  MISSING_LINKS_LIMIT_PERCENT,
  NEGATIVE_FLOAT_LIMIT_PERCENT,
} from "../core/checks.ts";
import type { CheckedFile } from "./files.ts";

export type CheckName = keyof CheckResults;

export type DetailName = CheckName | "brokenRows";

export type ChangeListName = "lostFloat" | "nowNegative" | "addedOrRemoved" | "relationships";

export type ListName = DetailName | ChangeListName;

export interface Selection {
  readonly fileKey: string;
  readonly list: ListName;
}

const CHECK_NAMES: readonly CheckName[] = ["missingLinks", "negativeFloat", "highFloat"];

export const DETAIL_NAMES: readonly DetailName[] = [...CHECK_NAMES, "brokenRows"];

export const CHANGE_LIST_NAMES: readonly ChangeListName[] = [
  "lostFloat",
  "nowNegative",
  "addedOrRemoved",
  "relationships",
];

export const DETAIL_LABELS: Readonly<Record<DetailName, string>> = {
  missingLinks: "Missing links",
  negativeFloat: "Negative float",
  highFloat: "High float",
  brokenRows: "Broken rows",
};

export const CHANGE_LIST_LABELS: Readonly<Record<ChangeListName, string>> = {
  lostFloat: "Lost float",
  nowNegative: "Now negative",
  addedOrRemoved: "Added or removed",
  relationships: "Relationships",
};

export const DETAIL_DEFINITIONS: Readonly<Record<DetailName, string>> = {
  missingLinks: "Open activities with no predecessor or no successor.",
  negativeFloat: "Open activities with total float below zero.",
  highFloat: `Open activities with more than ${HIGH_FLOAT_THRESHOLD_DAYS} working days of total float.`,
  brokenRows: "Rows the reader could not use.",
};

export const CHECK_LIMITS: Readonly<Record<CheckName, string>> = {
  missingLinks: `${MISSING_LINKS_LIMIT_PERCENT}%`,
  negativeFloat: `${NEGATIVE_FLOAT_LIMIT_PERCENT}%`,
  highFloat: `${HIGH_FLOAT_LIMIT_PERCENT}%`,
};

export function isChangeList(list: ListName): list is ChangeListName {
  return (CHANGE_LIST_NAMES as readonly ListName[]).includes(list);
}

export function resolveSelection(
  files: readonly CheckedFile[],
  chosen: Selection | null,
  comparing: boolean,
): Selection | null {
  if (
    chosen !== null &&
    files.some((file) => file.key === chosen.fileKey) &&
    (comparing || !isChangeList(chosen.list))
  ) {
    return chosen;
  }
  const latest = files.at(-1);
  return latest === undefined ? null : { fileKey: latest.key, list: firstFailingCheck(latest) };
}

export function firstFailingCheck(file: CheckedFile): CheckName {
  const failing = CHECK_NAMES.find((name) => file.result.checks[name].summary.status === "fail");
  return failing ?? "missingLinks";
}
