import type { Bin } from "../core/histogram.ts";

const MINUS_SIGN = "−";

const wholeNumber = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const upToOneDecimal = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
const upToTwoDecimals = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const dataDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function formatCount(count: number): string {
  return wholeNumber.format(count);
}

export function countOf(count: number, singular: string, plural: string): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

export function formatDayCount(days: number): string {
  return countOf(Math.abs(days), "day", "days");
}

export function formatPercent(percent: number): string {
  return `${oneDecimal.format(percent)}%`;
}

export function formatPercentOf(part: number, whole: number): string {
  return formatPercent(whole === 0 ? 0 : (part / whole) * 100);
}

export function formatAxisPercent(percent: number): string {
  return `${upToTwoDecimals.format(percent)}%`;
}

export function formatDays(days: number): string {
  return upToOneDecimal.format(days).replace("-", MINUS_SIGN);
}

export function formatSignedDays(days: number): string {
  return days > 0 ? `+${formatDays(days)}` : formatDays(days);
}

export function formatHours(hours: number): string {
  return `${upToOneDecimal.format(hours).replace("-", MINUS_SIGN)} h`;
}

export function formatDataDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return isoDate;
  }
  return dataDate.format(Date.UTC(year, month - 1, day));
}

export function binLabel(bin: Bin): string {
  const from = formatDays(bin.from);
  const to = formatDays(bin.to);
  if (bin.includesBelow) {
    return `Less than ${to} days`;
  }
  if (bin.includesAbove) {
    return `More than ${from} days`;
  }
  return bin.zone === "high" ? `More than ${from}, up to ${to} days` : `${from} to ${to} days`;
}
