import { describe, expect, test } from "vitest";
import { affectsChecks } from "../../src/core/xer/problems.ts";

describe("affectsChecks", () => {
  test("is false for rows the checks never use or still use", () => {
    expect(affectsChecks({ kind: "not-used" })).toBe(false);
    expect(affectsChecks({ kind: "still-used" })).toBe(false);
    expect(affectsChecks({ kind: "calendar-unusable", activities: 0 })).toBe(false);
  });

  test("is true when a row changes what the checks count", () => {
    expect(affectsChecks({ kind: "activity-not-read" })).toBe(true);
    expect(affectsChecks({ kind: "link-not-counted" })).toBe(true);
    expect(affectsChecks({ kind: "calendar-unusable", activities: 1 })).toBe(true);
  });
});
