import { HIGH_FLOAT_THRESHOLD_DAYS } from "./checks.ts";

const BIN_WIDTH_DAYS = 4;
const TAIL_SHARE = 0.005;

export type FloatZone = "negative" | "normal" | "high";

export interface Bin {
  readonly index: number;
  readonly zone: FloatZone;
  readonly from: number;
  readonly to: number;
  readonly includesBelow: boolean;
  readonly includesAbove: boolean;
}

export interface HistogramSeries {
  readonly counts: readonly number[];
  readonly total: number;
}

export interface Histogram {
  readonly bins: readonly Bin[];
  readonly series: readonly HistogramSeries[];
}

const LAST_NORMAL_INDEX = HIGH_FLOAT_THRESHOLD_DAYS / BIN_WIDTH_DAYS - 1;

export function binIndex(days: number): number {
  if (days < 0) {
    return Math.floor(days / BIN_WIDTH_DAYS);
  }
  if (days <= HIGH_FLOAT_THRESHOLD_DAYS) {
    return Math.min(Math.floor(days / BIN_WIDTH_DAYS), LAST_NORMAL_INDEX);
  }
  return LAST_NORMAL_INDEX + Math.ceil((days - HIGH_FLOAT_THRESHOLD_DAYS) / BIN_WIDTH_DAYS);
}

export function zoneOf(index: number): FloatZone {
  if (index < 0) {
    return "negative";
  }
  return index <= LAST_NORMAL_INDEX ? "normal" : "high";
}

export function buildHistogram(seriesValues: readonly (readonly number[])[]): Histogram | null {
  const all = seriesValues.flat().sort((a, b) => a - b);
  const lowest = all[0];
  const highest = all.at(-1);
  if (lowest === undefined || highest === undefined) {
    return null;
  }
  const first = Math.min(binIndex(quantile(all, TAIL_SHARE)), lowest < 0 ? -1 : 0);
  const last = Math.max(
    binIndex(quantile(all, 1 - TAIL_SHARE)),
    highest > HIGH_FLOAT_THRESHOLD_DAYS ? LAST_NORMAL_INDEX + 1 : LAST_NORMAL_INDEX,
  );
  const bins = Array.from({ length: last - first + 1 }, (_, offset) =>
    describeBin(first + offset, {
      includesBelow: offset === 0 && binIndex(lowest) < first,
      includesAbove: first + offset === last && binIndex(highest) > last,
    }),
  );
  const series = seriesValues.map((values) => {
    const counts = Array.from({ length: bins.length }, () => 0);
    for (const days of values) {
      const position = Math.min(Math.max(binIndex(days), first), last) - first;
      counts[position] = (counts[position] ?? 0) + 1;
    }
    return { counts, total: values.length };
  });
  return { bins, series };
}

export function sharePercent(series: HistogramSeries, position: number): number {
  const count = series.counts[position] ?? 0;
  return series.total === 0 ? 0 : (count / series.total) * 100;
}

function describeBin(
  index: number,
  tails: { includesBelow: boolean; includesAbove: boolean },
): Bin {
  return {
    index,
    zone: zoneOf(index),
    from: index * BIN_WIDTH_DAYS,
    to: (index + 1) * BIN_WIDTH_DAYS,
    ...tails,
  };
}

function quantile(sorted: readonly number[], share: number): number {
  const position = Math.min(sorted.length - 1, Math.max(0, Math.floor(share * sorted.length)));
  return sorted[position] ?? 0;
}
