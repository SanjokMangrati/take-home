import { describe, expect, test } from "vitest";
import type { CheckedAnalysis } from "../../src/core/analyze.ts";
import { arrangeFiles, type LoadedFile } from "../../src/ui/files.ts";
import { checkedFile } from "../support/xer.ts";

const month6 = checkedFile("data/dukhan-ph9-update-06.xer");
const month12 = checkedFile("data/dukhan-ph9-update-12.xer");

function loaded(fileName: string, result: CheckedAnalysis): LoadedFile {
  return { key: fileName, id: fileName, fileName, label: fileName, slot: 1, result };
}

function withProjectId(result: CheckedAnalysis, projectId: string): CheckedAnalysis {
  const projects = result.facts.projects.map((project) => ({ ...project, name: projectId }));
  return { ...result, facts: { ...result.facts, projects } };
}

function labelsOf(...files: LoadedFile[]): string[] {
  return arrangeFiles(files).map((file) => file.label);
}

describe("the label of each update", () => {
  test("leaves out the first words of the project ID that every update shares", () => {
    expect(labelsOf(loaded("06.xer", month6), loaded("12.xer", month12))).toEqual([
      "Month 6",
      "Month 12",
    ]);
  });

  test("keeps the shared word just before the part that differs", () => {
    const files = [
      loaded("a.xer", withProjectId(month6, "Month 6")),
      loaded("b.xer", withProjectId(month12, "Month 12")),
    ];

    expect(labelsOf(...files)).toEqual(["Month 6", "Month 12"]);
  });

  test("keeps the whole project ID of a single update", () => {
    expect(labelsOf(loaded("06.xer", month6))).toEqual(["DHBL Month 6"]);
  });

  test("uses the file names when two updates have the same project ID", () => {
    const files = [
      loaded("a.xer", withProjectId(month6, "Update")),
      loaded("b.xer", withProjectId(month12, "Update")),
    ];

    expect(labelsOf(...files)).toEqual(["a.xer", "b.xer"]);
  });
});
