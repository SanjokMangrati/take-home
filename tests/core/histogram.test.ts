import { describe, expect, test } from "vitest";
import { binIndex, buildHistogram, sharePercent, zoneOf } from "../../src/core/histogram.ts";

describe("binIndex", () => {
  test.each([
    [-4.001, -2],
    [-4, -1],
    [-0.001, -1],
    [0, 0],
    [3.99, 0],
    [4, 1],
    [43.9, 10],
    [44, 10],
    [44.001, 11],
    [48, 11],
    [48.001, 12],
  ])("%s days goes in bin %s", (days, index) => {
    expect(binIndex(days)).toBe(index);
  });
});

describe("zoneOf", () => {
  test.each([
    [-1, "negative"],
    [0, "normal"],
    [10, "normal"],
    [11, "high"],
  ])("bin %s is in the %s zone", (index, zone) => {
    expect(zoneOf(index)).toBe(zone);
  });
});

describe("buildHistogram", () => {
  test("returns nothing when there are no values", () => {
    expect(buildHistogram([])).toBeNull();
    expect(buildHistogram([[], []])).toBeNull();
  });

  test("always spans 0 to 44 days, so both limits are on the chart", () => {
    const histogram = buildHistogram([[10, 12, 15]]);

    expect(histogram?.bins.map((bin) => bin.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(histogram?.bins.at(-1)).toMatchObject({ from: 40, to: 44, zone: "normal" });
  });

  test("never folds a flagged value into a bar between 0 and 44 days", () => {
    const values = [-50, ...Array<number>(1000).fill(10), 300];
    const histogram = buildHistogram([values]);
    const bins = histogram?.bins ?? [];

    expect(bins.map((bin) => bin.index)).toEqual([-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(bins[0]).toMatchObject({ zone: "negative", includesBelow: true });
    expect(bins.at(-1)).toMatchObject({ zone: "high", includesAbove: true });
    expect(histogram?.series[0]?.counts[0]).toBe(1);
    expect(histogram?.series[0]?.counts.at(-1)).toBe(1);
  });

  test("counts every file on the same bins", () => {
    const histogram = buildHistogram([[-1], [45, 46]]);

    expect(histogram?.bins.map((bin) => bin.index)).toEqual([
      -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(histogram?.series).toEqual([
      { counts: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], total: 1 },
      { counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2], total: 2 },
    ]);
  });

  test("folds the outermost 0.5% at each end into the edge bars and marks them", () => {
    const values = [-300, ...Array<number>(200).fill(-10), ...Array<number>(200).fill(50), 900];
    const histogram = buildHistogram([values]);
    const bins = histogram?.bins ?? [];

    expect(bins[0]).toEqual({
      index: -3,
      zone: "negative",
      from: -12,
      to: -8,
      includesBelow: true,
      includesAbove: false,
    });
    expect(bins.at(-1)).toEqual({
      index: 12,
      zone: "high",
      from: 48,
      to: 52,
      includesBelow: false,
      includesAbove: true,
    });
    expect(histogram?.series[0]?.counts[0]).toBe(201);
    expect(histogram?.series[0]?.counts.at(-1)).toBe(201);
    expect(histogram?.series[0]?.total).toBe(402);
  });
});

describe("sharePercent", () => {
  test("is the share of the file's own activities, so files of different sizes compare", () => {
    expect(sharePercent({ counts: [1, 3], total: 4 }, 1)).toBe(75);
    expect(sharePercent({ counts: [0], total: 0 }, 0)).toBe(0);
  });
});
