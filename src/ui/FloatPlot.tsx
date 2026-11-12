import "./FloatPlot.css";
import { type KeyboardEvent, useState } from "react";
import { HIGH_FLOAT_THRESHOLD_DAYS } from "../core/checks.ts";
import type { Bin, FloatZone } from "../core/histogram.ts";
import type { CheckedFile } from "./files.ts";
import { binLabel, countOf, formatAxisPercent, formatDays, formatPercent } from "./format.ts";
import { SeriesKey } from "./marks.tsx";
import { useWidth } from "./useWidth.ts";

const PLOT_HEIGHT = 280;
const MARGIN = { top: 36, right: 16, bottom: 52, left: 48 } as const;
const HEIGHT = MARGIN.top + PLOT_HEIGHT + MARGIN.bottom;
const BASELINE = MARGIN.top + PLOT_HEIGHT;
const NARROW_PLOT_WIDTH = 480;
const WIDE_TICK_DAYS = HIGH_FLOAT_THRESHOLD_DAYS / 2;
const NARROW_TICK_DAYS = HIGH_FLOAT_THRESHOLD_DAYS;
const HEADROOM = 1.15;
const CHARACTER_WIDTH = 7;
const LABEL_GAP = 6;
const TOOLTIP_GAP = 12;
const Y_TICK_GAP = 8;
const X_TICK_Y = BASELINE + 20;
const AXIS_TITLE_Y = HEIGHT - 10;
const LIMIT_TOP = MARGIN.top - 22;
const LIMIT_LABEL_Y = MARGIN.top - 12;

type Scale = (value: number) => number;

interface Span {
  readonly from: number;
  readonly to: number;
}

export interface ChartLine {
  readonly file: CheckedFile;
  readonly label: string;
  readonly counts: readonly number[];
  readonly shares: readonly number[];
}

interface FloatPlotProps {
  readonly bins: readonly Bin[];
  readonly lines: readonly ChartLine[];
}

export function FloatPlot({ bins, lines }: FloatPlotProps) {
  const [frameRef, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  function moveWithKeys(event: KeyboardEvent<HTMLDivElement>) {
    const next = nextPosition(event.key, active, bins.length);
    if (next !== undefined) {
      event.preventDefault();
      setActive(next);
    }
  }

  return (
    <div
      ref={frameRef}
      className="plot-frame"
      style={{ minHeight: HEIGHT }}
      role="slider"
      aria-label="Total float chart"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={bins.length - 1}
      aria-valuenow={active ?? 0}
      aria-valuetext={
        active === null
          ? "Use the left and right arrow keys to read each bar."
          : readout(bins, lines, active)
      }
      tabIndex={0}
      onKeyDown={moveWithKeys}
      onBlur={() => setActive(null)}
      onPointerLeave={() => setActive(null)}
    >
      {width > 0 && (
        <Plot bins={bins} lines={lines} width={width} active={active} onActivate={setActive} />
      )}
    </div>
  );
}

interface PlotProps extends FloatPlotProps {
  readonly width: number;
  readonly active: number | null;
  readonly onActivate: (position: number) => void;
}

function Plot({ bins, lines, width, active, onActivate }: PlotProps) {
  const firstDay = bins[0]?.from ?? 0;
  const lastDay = bins.at(-1)?.to ?? HIGH_FLOAT_THRESHOLD_DAYS;
  const plotRight = width - MARGIN.right;
  const x: Scale = (days) =>
    MARGIN.left + ((days - firstDay) / (lastDay - firstDay)) * (plotRight - MARGIN.left);
  const yTicks = percentTicks(Math.max(...lines.flatMap((line) => line.shares)) * HEADROOM);
  const yMax = yTicks.at(-1) ?? 1;
  const y: Scale = (percent) => BASELINE - (percent / yMax) * PLOT_HEIGHT;
  const tickStep = plotRight - MARGIN.left < NARROW_PLOT_WIDTH ? NARROW_TICK_DAYS : WIDE_TICK_DAYS;
  const negative = zoneSpan(bins, "negative");
  const high = zoneSpan(bins, "high");
  const activeBin = active === null ? undefined : bins[active];

  return (
    <>
      <svg className="plot" width={width} height={HEIGHT} aria-hidden="true">
        {negative && (
          <ZoneBand className="zone zone-negative" from={x(negative.from)} to={x(negative.to)} />
        )}
        {high && <ZoneBand className="zone" from={x(high.from)} to={x(high.to)} />}
        {yTicks.map((tick) => (
          <g key={tick}>
            <line className="grid" x1={MARGIN.left} x2={plotRight} y1={y(tick)} y2={y(tick)} />
            <text
              className="tick"
              x={MARGIN.left - Y_TICK_GAP}
              y={y(tick)}
              dy="0.32em"
              textAnchor="end"
            >
              {formatAxisPercent(tick)}
            </text>
          </g>
        ))}
        {activeBin && (
          <rect
            className="hover-column"
            x={x(activeBin.from)}
            y={MARGIN.top}
            width={x(activeBin.to) - x(activeBin.from)}
            height={PLOT_HEIGHT}
          />
        )}
        {lines.map((line) => {
          const outline = stepPath(bins, line.shares, x, y);
          return (
            <g key={line.file.key} className={`series-${line.file.slot}`}>
              <path className="series-area" d={`${outline}Z`} />
              <path className="series-line" d={outline} />
            </g>
          );
        })}
        <line className="baseline" x1={MARGIN.left} x2={plotRight} y1={BASELINE} y2={BASELINE} />
        <LimitRule
          x={x(0)}
          label={negative === null ? null : "Negative float"}
          side="before"
          width={width}
        />
        <LimitRule
          x={x(HIGH_FLOAT_THRESHOLD_DAYS)}
          label={high === null ? null : "High float"}
          side="after"
          width={width}
        />
        {dayLabels(bins, tickStep, x).map((label) => (
          <text
            key={label.text}
            className="tick"
            x={x(label.days)}
            y={X_TICK_Y}
            textAnchor="middle"
          >
            {label.text}
          </text>
        ))}
        <text
          className="axis-title"
          x={(MARGIN.left + plotRight) / 2}
          y={AXIS_TITLE_Y}
          textAnchor="middle"
        >
          Total float, working days
        </text>
        {bins.map((bin, position) => (
          <rect
            key={bin.index}
            className="hit-area"
            x={x(bin.from)}
            y={MARGIN.top}
            width={x(bin.to) - x(bin.from)}
            height={PLOT_HEIGHT}
            onPointerEnter={() => onActivate(position)}
          />
        ))}
      </svg>
      {activeBin && active !== null && (
        <Tooltip
          lines={lines}
          position={active}
          bin={activeBin}
          placement={
            x(activeBin.to) + TOOLTIP_GAP < width / 2
              ? { left: x(activeBin.to) + TOOLTIP_GAP }
              : { right: width - x(activeBin.from) + TOOLTIP_GAP }
          }
        />
      )}
    </>
  );
}

function ZoneBand({ className, from, to }: Span & { readonly className: string }) {
  return (
    <rect className={className} x={from} y={MARGIN.top} width={to - from} height={PLOT_HEIGHT} />
  );
}

interface LimitRuleProps {
  readonly x: number;
  readonly label: string | null;
  readonly side: "before" | "after";
  readonly width: number;
}

function LimitRule({ x, label, side, width }: LimitRuleProps) {
  const labelWidth = (label?.length ?? 0) * CHARACTER_WIDTH;
  const fits =
    side === "before" ? x - LABEL_GAP - labelWidth >= 0 : x + LABEL_GAP + labelWidth <= width;
  return (
    <>
      <line className="limit" x1={x} x2={x} y1={LIMIT_TOP} y2={BASELINE} />
      {label !== null && fits && (
        <text
          className="zone-label"
          x={side === "before" ? x - LABEL_GAP : x + LABEL_GAP}
          y={LIMIT_LABEL_Y}
          textAnchor={side === "before" ? "end" : "start"}
        >
          {label}
        </text>
      )}
    </>
  );
}

interface TooltipProps {
  readonly lines: readonly ChartLine[];
  readonly position: number;
  readonly bin: Bin;
  readonly placement: { readonly left: number } | { readonly right: number };
}

function Tooltip({ lines, position, bin, placement }: TooltipProps) {
  return (
    <div className="tooltip" style={placement} aria-hidden="true">
      <p className="tooltip-title">{binLabel(bin)}</p>
      <ul>
        {lines.map((line) => (
          <li key={line.file.key}>
            <SeriesKey slot={line.file.slot} />
            <strong>{formatPercent(line.shares[position] ?? 0)}</strong>
            <span>{line.label}</span>
            <span className="tooltip-count">
              {countOf(line.counts[position] ?? 0, "activity", "activities")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function nextPosition(
  key: string,
  active: number | null,
  count: number,
): number | null | undefined {
  switch (key) {
    case "ArrowRight":
      return active === null ? 0 : Math.min(active + 1, count - 1);
    case "ArrowLeft":
      return active === null ? count - 1 : Math.max(active - 1, 0);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "Escape":
      return null;
    default:
      return undefined;
  }
}

function readout(bins: readonly Bin[], lines: readonly ChartLine[], position: number): string {
  const bin = bins[position];
  if (bin === undefined) {
    return "";
  }
  const values = lines.map((line) => `${line.label} ${formatPercent(line.shares[position] ?? 0)}`);
  return `${binLabel(bin)}: ${values.join(", ")}`;
}

function zoneSpan(bins: readonly Bin[], zone: FloatZone): Span | null {
  const inZone = bins.filter((bin) => bin.zone === zone);
  const first = inZone[0];
  const last = inZone.at(-1);
  return first === undefined || last === undefined ? null : { from: first.from, to: last.to };
}

function stepPath(bins: readonly Bin[], shares: readonly number[], x: Scale, y: Scale): string {
  const start = bins[0]?.from ?? 0;
  const steps = bins.map((bin, position) => `V${y(shares[position] ?? 0)}H${x(bin.to)}`);
  return `M${x(start)},${BASELINE}${steps.join("")}V${BASELINE}`;
}

function percentTicks(peak: number): number[] {
  const rough = Math.max(peak, 1) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((s) => s >= rough);
  const tickStep = step ?? rough;
  const count = Math.ceil(Math.max(peak, 1) / tickStep);
  return Array.from({ length: count + 1 }, (_, index) => index * tickStep);
}

interface AxisLabel {
  readonly days: number;
  readonly text: string;
}

function dayLabels(bins: readonly Bin[], step: number, x: Scale): AxisLabel[] {
  const first = bins[0];
  const last = bins.at(-1);
  if (first === undefined || last === undefined) {
    return [];
  }
  const tails: AxisLabel[] = [
    ...(first.includesBelow
      ? [{ days: (first.from + first.to) / 2, text: `<${formatDays(first.to)}` }]
      : []),
    ...(last.includesAbove
      ? [{ days: (last.from + last.to) / 2, text: `>${formatDays(last.from)}` }]
      : []),
  ];
  const ticks = dayTicks(
    first.includesBelow ? first.to : first.from,
    last.includesAbove ? last.from : last.to,
    step,
  )
    .map((days) => ({ days, text: formatDays(days) }))
    .filter((tick) => tails.every((tail) => !overlap(tick, tail, x)));
  return [...ticks, ...tails];
}

function overlap(a: AxisLabel, b: AxisLabel, x: Scale): boolean {
  const room = ((a.text.length + b.text.length) * CHARACTER_WIDTH) / 2 + LABEL_GAP;
  return Math.abs(x(a.days) - x(b.days)) < room;
}

function dayTicks(firstDay: number, lastDay: number, step: number): number[] {
  const first = Math.ceil(firstDay / step);
  const last = Math.floor(lastDay / step);
  return Array.from({ length: last - first + 1 }, (_, index) => (first + index) * step);
}
