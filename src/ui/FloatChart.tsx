import "./FloatChart.css";
import { useState } from "react";
import { medianOf } from "../core/compare.ts";
import { type Bin, buildHistogram, type Histogram, sharePercent } from "../core/histogram.ts";
import { type Column, DataTable } from "./DataTable.tsx";
import { type ChartLine, FloatPlot } from "./FloatPlot.tsx";
import type { CheckedFile } from "./files.ts";
import { binLabel, formatCount, formatDays, formatPercent } from "./format.ts";
import { SeriesKey } from "./marks.tsx";
import { Section } from "./Section.tsx";
import { type Choice, SegmentedControl } from "./SegmentedControl.tsx";

type View = "chart" | "table";

const NO_FLOAT_VALUES = "No open activity has a total float value to chart.";

const VIEWS: readonly Choice<View>[] = [
  { value: "chart", label: "Chart" },
  { value: "table", label: "Table" },
];

interface FloatChartProps {
  readonly files: readonly CheckedFile[];
}

export function FloatChart({ files }: FloatChartProps) {
  const [view, setView] = useState<View>("chart");
  const charted = files.filter((file) => file.result.floatDays.length > 0);
  const histogram = buildHistogram(charted.map((file) => file.result.floatDays));
  const lines = histogram === null ? [] : chartLines(charted, histogram);

  return (
    <Section
      title="Total float"
      lead={medianLead(charted)}
      actions={
        <div className="chart-controls">
          {charted.length > 1 && (
            <ul className="legend" aria-label="Files">
              {charted.map((file) => (
                <li key={file.key}>
                  <SeriesKey slot={file.slot} />
                  {file.label}
                </li>
              ))}
            </ul>
          )}
          {histogram !== null && (
            <SegmentedControl
              legend="Show float as"
              choices={VIEWS}
              value={view}
              onChange={setView}
            />
          )}
        </div>
      }
    >
      {histogram === null ? (
        <p className="empty">{NO_FLOAT_VALUES}</p>
      ) : view === "chart" ? (
        <FloatPlot bins={histogram.bins} lines={lines} />
      ) : (
        <FloatTable bins={histogram.bins} lines={lines} />
      )}
    </Section>
  );
}

function chartLines(files: readonly CheckedFile[], histogram: Histogram): ChartLine[] {
  return files.flatMap((file, index) => {
    const series = histogram.series[index];
    if (series === undefined) {
      return [];
    }
    const shares = series.counts.map((_, position) => sharePercent(series, position));
    return [{ file, label: file.label, counts: series.counts, shares }];
  });
}

function medianLead(files: readonly CheckedFile[]): string | undefined {
  const medians = files.flatMap((file) => {
    const median = medianOf(file.result.floatDays);
    return median === null ? [] : [{ label: file.label, median }];
  });
  const [only] = medians;
  if (only === undefined) {
    return undefined;
  }
  const share = "Share of open activities in each total float range.";
  if (medians.length === 1) {
    return `${share} Median: ${formatDays(only.median)} working days.`;
  }
  const parts = medians.map(
    ({ label, median }) => `${formatDays(median)} working days in ${label}`,
  );
  const last = parts.pop();
  return `${share} Median: ${parts.join(", ")} and ${last}.`;
}

interface BinRow {
  readonly position: number;
  readonly label: string;
}

interface FloatTableProps {
  readonly bins: readonly Bin[];
  readonly lines: readonly ChartLine[];
}

function FloatTable({ bins, lines }: FloatTableProps) {
  const rows = bins.map((bin, position) => ({ position, label: binLabel(bin) }));
  const lineColumns = lines.map(
    (line): Column<BinRow> => ({
      header: line.label,
      numeric: true,
      cell: ({ position }) =>
        `${formatPercent(line.shares[position] ?? 0)} (${formatCount(line.counts[position] ?? 0)})`,
    }),
  );
  return (
    <DataTable
      caption="Share of open activities by total float"
      columns={[{ header: "Total float", cell: (row) => row.label }, ...lineColumns]}
      rows={rows}
      rowKey={(row) => String(row.position)}
      empty={NO_FLOAT_VALUES}
    />
  );
}
