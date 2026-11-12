import {
  type Comparison,
  isLostFloat,
  isNowNegative,
  type RelationshipChange,
} from "../core/compare.ts";
import { describeRelationships } from "./describe.ts";
import { type CheckedFile, inDataDateOrder } from "./files.ts";
import { countOf, formatCount } from "./format.ts";

export interface ComparedFile extends CheckedFile {
  readonly id: string;
}

export interface ComparedPair {
  readonly from: ComparedFile;
  readonly to: ComparedFile;
}

interface ReviewTopic {
  readonly title: string;
  readonly sentences: readonly string[];
}

export function comparedPair(files: readonly CheckedFile[]): ComparedPair | null {
  const ordered = inDataDateOrder(files.filter((file): file is ComparedFile => file.id !== null));
  const from = ordered.at(-2);
  const to = ordered.at(-1);
  return from === undefined || to === undefined ? null : { from, to };
}

export function reviewOf(comparison: Comparison, { from, to }: ComparedPair): ReviewTopic[] {
  const topics: ReviewTopic[] = [
    {
      title: "Matching",
      sentences: [...matchWarning(comparison, from, to), ...repeatedCodes(comparison)],
    },
    { title: "Progress", sentences: [progress(comparison)] },
    { title: "Float", sentences: floatReview(comparison) },
    { title: "Logic", sentences: [relationships(comparison)] },
  ];
  return topics.filter((topic) => topic.sentences.length > 0);
}

export function reviewText(topics: readonly ReviewTopic[]): string {
  return topics.map((topic) => [topic.title, ...topic.sentences].join("\n")).join("\n\n");
}

function matchWarning(comparison: Comparison, from: CheckedFile, to: CheckedFile): string[] {
  const smaller = Math.min(from.result.facts.activityCount, to.result.facts.activityCount);
  const matched = comparison.matchedActivityCount;
  if (matched * 2 >= smaller) {
    return [];
  }
  const sharing =
    matched === 0
      ? "No activity has"
      : `Only ${countOf(matched, "activity has", "activities have")}`;
  return [
    `${sharing} the same activity ID in both files, so they may not be updates of the same schedule.`,
  ];
}

function progress({ completedCount, startedCount, added, removed }: Comparison): string {
  return [
    `${activitiesWere(completedCount)} completed, and ${otherWere(startedCount)} started but not finished.`,
    `${activitiesWere(added.length)} added and ${otherWere(removed.length)} removed.`,
  ].join(" ");
}

function activitiesWere(count: number): string {
  return count === 0 ? "No activities were" : countOf(count, "activity was", "activities were");
}

function otherWere(count: number): string {
  return count === 0 ? "none were" : countOf(count, "was", "were");
}

function floatReview(comparison: Comparison): string[] {
  const { openInBothCount, unchangedFloatCount, floatChanges } = comparison;
  if (openInBothCount === 0) {
    return ["No activity is open in both files, so float is not compared."];
  }
  const lost = floatChanges.filter(isLostFloat).length;
  const gained = floatChanges.length - lost;
  const notCompared = openInBothCount - floatChanges.length - unchangedFloatCount;
  const nowNegative = floatChanges.filter(isNowNegative).length;
  return [
    `Of the ${countOf(openInBothCount, "activity", "activities")} open in both files, ${formatCount(lost)} lost float, ${formatCount(gained)} gained float and ${formatCount(unchangedFloatCount)} kept the same float.${notCompared > 0 ? ` ${countOf(notCompared, "has", "have")} no float value in one of the files.` : ""}`,
    `${countOf(nowNegative, "activity", "activities")} went from zero or positive float to negative float.`,
  ];
}

function relationships(comparison: Comparison): string {
  const changes = comparison.relationshipChanges;
  if (changes.length === 0) {
    return "No relationships changed.";
  }
  const linked = changes.filter((change) => change.before.length === 0).length;
  const unlinked = changes.filter((change) => change.after.length === 0).length;
  const stillLinked = changes.filter(
    (change) => change.before.length > 0 && change.after.length > 0,
  );
  const common = mostCommonChange(stillLinked);
  return [
    stillLinked.length > 0 &&
      `${countOf(stillLinked.length, "pair", "pairs")} of activities ${stillLinked.length === 1 ? "is" : "are"} linked in both files, but the relationships between them changed.`,
    common !== null && `In ${formatCount(common.count)} of them, ${common.change}.`,
    linked > 0 && `${countOf(linked, "pair", "pairs")} of activities were newly linked.`,
    unlinked > 0 && `${countOf(unlinked, "pair", "pairs")} of activities are no longer linked.`,
  ]
    .filter((sentence) => sentence !== false)
    .join(" ");
}

function mostCommonChange(
  changes: readonly RelationshipChange[],
): { change: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const change of changes) {
    const label = `${describeRelationships(change.before)} became ${describeRelationships(change.after)}`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const [top] = [...counts].sort((a, b) => b[1] - a[1]);
  return top === undefined || top[1] < 2 ? null : { change: top[0], count: top[1] };
}

function repeatedCodes(comparison: Comparison): string[] {
  const count = comparison.repeatedCodeCount;
  return count === 0
    ? []
    : [
        `${countOf(count, "activity ID is", "activity IDs are")} used by more than one activity in a file, so those activities are left out of this comparison.`,
      ];
}
