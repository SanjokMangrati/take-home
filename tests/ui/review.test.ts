import { describe, expect, test } from "vitest";
import { type CheckedAnalysis, checkSchedule } from "../../src/core/analyze.ts";
import { compareSchedules } from "../../src/core/compare.ts";
import type { CheckedFile, SeriesSlot } from "../../src/ui/files.ts";
import { type ComparedFile, comparedPair, reviewOf, reviewText } from "../../src/ui/review.ts";
import { checkedFile, parsedFile, repoFile, scheduleXer } from "../support/xer.ts";

function file(fileName: string, result: CheckedAnalysis, slot: SeriesSlot = 1): ComparedFile {
  return { key: fileName, id: fileName, fileName, label: fileName, slot, result };
}

describe("the review of two Dukhan updates", () => {
  const month6 = parsedFile(repoFile("data/dukhan-ph9-update-06.xer"));
  const month12 = parsedFile(repoFile("data/dukhan-ph9-update-12.xer"));

  const pair = {
    from: file("dukhan-ph9-update-06.xer", checkSchedule(month6), 1),
    to: file("dukhan-ph9-update-12.xer", checkSchedule(month12), 2),
  };

  test("states what changed from Month 6 to Month 12, grouped by topic", () => {
    expect(reviewOf(compareSchedules(month6, month12), pair)).toEqual([
      {
        title: "Progress",
        sentences: [
          "725 activities were completed and 43 were started. 1 activity was added and none were removed.",
        ],
      },
      {
        title: "Float",
        sentences: [
          "Of the 4,333 activities open in both files, 4,286 lost float, 31 gained float and 16 did not change.",
          "1,294 activities went from zero or positive float to negative float.",
        ],
      },
      {
        title: "Logic",
        sentences: [
          "Relationships changed between 63 pairs of activities that are linked in both files. The most common change, in 59 pairs, is from FS to FF.",
        ],
      },
    ]);
  });

  test("copies as plain text, one topic per paragraph", () => {
    const text = reviewText(reviewOf(compareSchedules(month6, month12), pair));

    expect(text.split("\n\n").map((paragraph) => paragraph.split("\n")[0])).toEqual([
      "Progress",
      "Float",
      "Logic",
    ]);
    expect(text).toContain("Progress\n725 activities were completed and 43 were started.");
  });
});

describe("files that do not share activity IDs", () => {
  test("says they may not be updates of the same schedule when fewer than half match", () => {
    const before = scheduleXer({
      tasks: [
        { id: "1", code: "A1" },
        { id: "2", code: "A2" },
        { id: "3", code: "A3" },
      ],
    });
    const after = scheduleXer({
      tasks: [
        { id: "1", code: "B1" },
        { id: "2", code: "B2" },
        { id: "3", code: "A3" },
      ],
    });
    const pair = {
      from: file("a.xer", checkSchedule(parsedFile(before))),
      to: file("b.xer", checkSchedule(parsedFile(after))),
    };
    const comparison = compareSchedules(parsedFile(before), parsedFile(after));

    expect(reviewOf(comparison, pair)[0]).toEqual({
      title: "Matching",
      sentences: [
        "Only 1 activity has the same activity ID in both files, so they may not be updates of the same schedule.",
      ],
    });
  });

  test("says no activity matches when the files share no activity IDs", () => {
    const before = scheduleXer({ tasks: [{ id: "1", code: "A1" }] });
    const after = scheduleXer({ tasks: [{ id: "1", code: "B1" }] });
    const pair = {
      from: file("a.xer", checkSchedule(parsedFile(before))),
      to: file("b.xer", checkSchedule(parsedFile(after))),
    };
    const comparison = compareSchedules(parsedFile(before), parsedFile(after));

    expect(reviewOf(comparison, pair)[0]).toEqual({
      title: "Matching",
      sentences: [
        "No activity has the same activity ID in both files, so they may not be updates of the same schedule.",
      ],
    });
  });
});

describe("choosing the two files to compare", () => {
  const fixture = checkedFile("tests/fixtures/broken-rows.xer");
  const dated = (date: string): CheckedAnalysis => ({
    ...fixture,
    facts: {
      ...fixture.facts,
      projects: fixture.facts.projects.map((project) => ({ ...project, dataDate: date })),
    },
  });

  test("compares the latest data date with the one before it", () => {
    const files: CheckedFile[] = [
      file("march.xer", dated("2026-03-31")),
      file("january.xer", dated("2026-01-31")),
      file("february.xer", dated("2026-02-28")),
    ];

    expect(comparedPair(files)).toMatchObject({
      from: { fileName: "february.xer" },
      to: { fileName: "march.xer" },
    });
  });

  test("keeps the order the files were picked in when one has no data date", () => {
    const files: CheckedFile[] = [
      file("march.xer", dated("2026-03-31")),
      file("undated.xer", { ...fixture, facts: { ...fixture.facts, projects: [] } }),
    ];

    expect(comparedPair(files)).toMatchObject({
      from: { fileName: "march.xer" },
      to: { fileName: "undated.xer" },
    });
  });

  test("needs two stored files", () => {
    expect(comparedPair([file("only.xer", fixture)])).toBeNull();
    expect(
      comparedPair([file("stored.xer", fixture), { ...file("x.xer", fixture), id: null }]),
    ).toBeNull();
  });
});
