import {
  byActivityCode,
  byNumberNullsLast,
  floatDays,
  type LinkedActivities,
  roundDays,
} from "./checks.ts";
import type { Activity, ActivityStatus, Link, LinkType } from "./xer/schedule.ts";

export interface ActivitySummary {
  readonly code: string;
  readonly name: string;
  readonly status: ActivityStatus;
}

export interface FloatChange {
  readonly code: string;
  readonly name: string;
  readonly beforeDays: number;
  readonly afterDays: number;
  readonly changeDays: number;
}

export interface Relationship {
  readonly type: LinkType;
  readonly lagHours: number | null;
}

export interface RelationshipChange {
  readonly predecessorCode: string;
  readonly successorCode: string;
  readonly before: readonly Relationship[];
  readonly after: readonly Relationship[];
}

export interface Comparison {
  readonly matchedActivityCount: number;
  readonly repeatedCodeCount: number;
  readonly added: readonly ActivitySummary[];
  readonly removed: readonly ActivitySummary[];
  readonly completedCount: number;
  readonly startedCount: number;
  readonly openInBothCount: number;
  readonly unchangedFloatCount: number;
  readonly floatChanges: readonly FloatChange[];
  readonly relationshipChanges: readonly RelationshipChange[];
}

interface ActivitiesByCode {
  readonly unique: ReadonlyMap<string, Activity>;
  readonly repeated: ReadonlySet<string>;
}

interface LinkedPair {
  readonly predecessorCode: string;
  readonly successorCode: string;
  readonly relationships: Relationship[];
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function compareSchedules(before: LinkedActivities, after: LinkedActivities): Comparison {
  const earlier = activitiesByCode(before.activities);
  const later = activitiesByCode(after.activities);
  const matched = [...earlier.unique].flatMap(([code, activity]) => {
    const match = later.unique.get(code);
    return match === undefined ? [] : [{ before: activity, after: match }];
  });
  const openInBoth = matched.filter((pair) => pair.before.checked && pair.after.checked);
  const floatPairs = openInBoth.flatMap(({ before: earlierActivity, after: laterActivity }) => {
    const beforeDays = floatDays(earlierActivity);
    const afterDays = floatDays(laterActivity);
    if (beforeDays === null || afterDays === null) {
      return [];
    }
    return [
      {
        code: laterActivity.code,
        name: laterActivity.name,
        beforeDays,
        afterDays,
        changeDays: roundDays(afterDays - beforeDays),
      },
    ];
  });
  const floatChanges = floatPairs
    .filter((change) => change.changeDays !== 0)
    .sort((a, b) => a.changeDays - b.changeDays || byActivityCode(a.code, b.code));

  return {
    matchedActivityCount: matched.length,
    repeatedCodeCount: new Set([...earlier.repeated, ...later.repeated]).size,
    added: onlyIn(later, earlier),
    removed: onlyIn(earlier, later),
    completedCount: matched.filter(
      (pair) => pair.before.status !== "TK_Complete" && pair.after.status === "TK_Complete",
    ).length,
    startedCount: matched.filter(
      (pair) => pair.before.status === "TK_NotStart" && pair.after.status === "TK_Active",
    ).length,
    openInBothCount: openInBoth.length,
    unchangedFloatCount: floatPairs.length - floatChanges.length,
    floatChanges,
    relationshipChanges: relationshipChanges(
      linkedPairs(before.links, earlier),
      linkedPairs(after.links, later),
    ),
  };
}

export function isLostFloat(change: FloatChange): boolean {
  return change.changeDays < 0;
}

export function isNowNegative(change: FloatChange): boolean {
  return change.beforeDays >= 0 && change.afterDays < 0;
}

export function medianOf(values: readonly number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) {
    return null;
  }
  const lower = sorted.length % 2 === 0 ? (sorted[middle - 1] ?? upper) : upper;
  return roundDays((lower + upper) / 2);
}

export function calendarDaysBetween(fromDate: string, toDate: string): number {
  return (utcDay(toDate) - utcDay(fromDate)) / MILLISECONDS_PER_DAY;
}

function utcDay(isoDate: string): number {
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = isoDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function activitiesByCode(activities: readonly Activity[]): ActivitiesByCode {
  const unique = new Map<string, Activity>();
  const repeated = new Set<string>();
  for (const activity of activities) {
    if (repeated.has(activity.code)) {
      continue;
    }
    if (unique.has(activity.code)) {
      unique.delete(activity.code);
      repeated.add(activity.code);
      continue;
    }
    unique.set(activity.code, activity);
  }
  return { unique, repeated };
}

function onlyIn(side: ActivitiesByCode, other: ActivitiesByCode): ActivitySummary[] {
  return [...side.unique.values()]
    .filter((activity) => !other.unique.has(activity.code) && !other.repeated.has(activity.code))
    .map(({ code, name, status }) => ({ code, name, status }))
    .sort((a, b) => byActivityCode(a.code, b.code));
}

function linkedPairs(
  links: readonly Link[],
  activities: ActivitiesByCode,
): ReadonlyMap<string, LinkedPair> {
  const codeById = new Map(
    [...activities.unique.values()].map((activity) => [activity.id, activity.code]),
  );
  const pairs = new Map<string, LinkedPair>();
  for (const link of links) {
    const predecessorCode = codeById.get(link.predecessorId);
    const successorCode = codeById.get(link.successorId);
    if (predecessorCode === undefined || successorCode === undefined) {
      continue;
    }
    const key = JSON.stringify([predecessorCode, successorCode]);
    const pair = pairs.get(key) ?? { predecessorCode, successorCode, relationships: [] };
    pair.relationships.push({ type: link.type, lagHours: link.lagHours });
    pairs.set(key, pair);
  }
  for (const pair of pairs.values()) {
    pair.relationships.sort(byTypeAndLag);
  }
  return pairs;
}

function relationshipChanges(
  before: ReadonlyMap<string, LinkedPair>,
  after: ReadonlyMap<string, LinkedPair>,
): RelationshipChange[] {
  const changes: RelationshipChange[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const earlier = before.get(key);
    const later = after.get(key);
    const pair = later ?? earlier;
    if (pair === undefined) {
      continue;
    }
    const beforeRelationships = earlier?.relationships ?? [];
    const afterRelationships = later?.relationships ?? [];
    if (!sameRelationships(beforeRelationships, afterRelationships)) {
      changes.push({
        predecessorCode: pair.predecessorCode,
        successorCode: pair.successorCode,
        before: beforeRelationships,
        after: afterRelationships,
      });
    }
  }
  return changes.sort(
    (a, b) =>
      byActivityCode(a.predecessorCode, b.predecessorCode) ||
      byActivityCode(a.successorCode, b.successorCode),
  );
}

function sameRelationships(a: readonly Relationship[], b: readonly Relationship[]): boolean {
  return (
    a.length === b.length &&
    a.every((relationship, index) => {
      const other = b[index];
      return other !== undefined && byTypeAndLag(relationship, other) === 0;
    })
  );
}

function byTypeAndLag(a: Relationship, b: Relationship): number {
  return a.type.localeCompare(b.type) || byNumberNullsLast(a.lagHours, b.lagHours);
}
