import "./CheckSheet.css";
import { useId } from "react";
import type { NeedsHoursPerDayAnalysis, RejectedAnalysis } from "../core/analyze.ts";
import type { CheckSummary } from "../core/checks.ts";
import { affectsChecks, type BrokenRow } from "../core/xer/problems.ts";
import { MAX_HOURS_PER_DAY } from "../core/xer/schedule.ts";
import { MIN_ENTERED_HOURS_PER_DAY } from "../shared/api.ts";
import { CHECK_LIMITS, DETAIL_LABELS, DETAIL_NAMES, type Selection } from "./details.ts";
import { dataDateOf, isChecked, type LoadedFile, type UnreadableFile } from "./files.ts";
import { countOf, formatCount, formatDataDate, formatPercentOf } from "./format.ts";
import { Verdict } from "./marks.tsx";
import { Section } from "./Section.tsx";

const SUGGESTED_HOURS_PER_DAY = 8;

interface CheckSheetProps {
  readonly files: readonly LoadedFile[];
  readonly checkingKeys: ReadonlySet<string>;
  readonly selection: Selection | null;
  readonly onSelect: (selection: Selection) => void;
  readonly onHoursPerDay: (file: LoadedFile, hoursPerDay: number) => void;
}

export function CheckSheet({
  files,
  checkingKeys,
  selection,
  onSelect,
  onHoursPerDay,
}: CheckSheetProps) {
  return (
    <Section title="Checks">
      <table className={`sheet files-${files.length}`}>
        <thead>
          <tr>
            <th scope="col" className="sheet-corner">
              Check
            </th>
            <th scope="col" className="sheet-limit">
              Passes if
            </th>
            {files.map((file) => (
              <th key={file.key} scope="col" className={`sheet-file series-${file.slot}`}>
                <FileHeading file={file} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DETAIL_NAMES.map((detail, index) => (
            <tr key={detail}>
              <th scope="row" className="sheet-check">
                <span className="sheet-check-name">{DETAIL_LABELS[detail]}</span>
                {detail !== "brokenRows" && (
                  <span className="sheet-limit-inline">Passes if {CHECK_LIMITS[detail]}.</span>
                )}
              </th>
              <td className="sheet-limit">
                {detail === "brokenRows" ? "No pass or fail" : CHECK_LIMITS[detail]}
              </td>
              {files.map((file) =>
                file.result.kind === "checked" ? (
                  <td key={file.key}>
                    <button
                      type="button"
                      className="result"
                      aria-pressed={selection?.fileKey === file.key && selection.list === detail}
                      onClick={() => onSelect({ fileKey: file.key, list: detail })}
                    >
                      {detail === "brokenRows" ? (
                        <BrokenRowsResult broken={file.result.broken} />
                      ) : (
                        <CheckResult summary={file.result.checks[detail].summary} />
                      )}
                    </button>
                  </td>
                ) : (
                  index === 0 && (
                    <td key={file.key} rowSpan={DETAIL_NAMES.length} className="not-checked-cell">
                      {checkingKeys.has(file.key) ? (
                        <span className="result-note" role="status">
                          Checking the file…
                        </span>
                      ) : (
                        <NotChecked
                          result={file.result}
                          onHoursPerDay={(hoursPerDay) => onHoursPerDay(file, hoursPerDay)}
                        />
                      )}
                    </td>
                  )
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function FileHeading({ file }: { readonly file: LoadedFile }) {
  if (!isChecked(file)) {
    return <span className="sheet-file-name">{file.fileName}</span>;
  }
  const { projects } = file.result.facts;
  const dataDate = dataDateOf(file);
  return (
    <>
      <span className="sheet-file-name">{file.label}</span>
      {dataDate !== null && (
        <span className="sheet-file-meta">Data date {formatDataDate(dataDate)}</span>
      )}
      {projects.length > 1 && <span className="sheet-file-meta">{projects.length} projects</span>}
      {file.label !== file.fileName && (
        <span className="sheet-file-meta sheet-file-source">{file.fileName}</span>
      )}
    </>
  );
}

function CheckResult({ summary }: { readonly summary: CheckSummary }) {
  const leftOut = summary.leftOut > 0 && (
    <span className="result-note marked">
      {countOf(summary.leftOut, "activity", "activities")} left out
    </span>
  );
  if (summary.status === "nothing-to-check") {
    return (
      <>
        <span className="result-note">Nothing to check</span>
        {leftOut}
      </>
    );
  }
  return (
    <>
      <span className="result-line">
        <span className={`result-figure result-${summary.status}`}>
          {formatPercentOf(summary.flagged, summary.counted)}
        </span>{" "}
        <Verdict status={summary.status} />
      </span>{" "}
      <span className="result-note">
        {formatCount(summary.flagged)} of{" "}
        {countOf(summary.counted, "open activity", "open activities")}
      </span>
      {leftOut}
    </>
  );
}

function BrokenRowsResult({ broken }: { readonly broken: readonly BrokenRow[] }) {
  const affecting = broken.filter((row) => affectsChecks(row.effect)).length;
  return (
    <>
      <span className="result-line">
        <span className="result-figure">{formatCount(broken.length)}</span>
      </span>{" "}
      {affecting > 0 && (
        <span className="result-note marked">
          {formatCount(affecting)} {affecting === 1 ? "changes" : "change"} the check results
        </span>
      )}
      {affecting === 0 && broken.length > 0 && (
        <span className="result-note">None change the check results</span>
      )}
      {broken.length === 0 && <span className="result-note">None found</span>}
    </>
  );
}

interface NotCheckedProps {
  readonly result: RejectedAnalysis | UnreadableFile | NeedsHoursPerDayAnalysis;
  readonly onHoursPerDay: (hours: number) => void;
}

function NotChecked({ result, onHoursPerDay }: NotCheckedProps) {
  if (result.kind === "needs-hours-per-day") {
    return <HoursPerDayQuestion line={result.line} onAnswer={onHoursPerDay} />;
  }
  return (
    <div className="not-checked">
      <span className="not-checked-title">Not checked</span>
      {result.reason}
      {result.kind === "rejected" && result.line !== null && (
        <span className="result-note">Line {result.line}</span>
      )}
    </div>
  );
}

interface HoursPerDayQuestionProps {
  readonly line: number;
  readonly onAnswer: (hours: number) => void;
}

function HoursPerDayQuestion({ line, onAnswer }: HoursPerDayQuestionProps) {
  const inputId = useId();
  return (
    <form
      className="not-checked"
      onSubmit={(event) => {
        event.preventDefault();
        onAnswer(Number(new FormData(event.currentTarget).get("hours")));
      }}
    >
      <span className="not-checked-title">Not checked yet</span>
      This P6 export leaves out the work hours in a day, so float cannot be counted in days.
      <span className="result-note">Line {line}</span>
      <span className="hours-field">
        <label htmlFor={inputId}>Work hours in a day</label>
        <input
          id={inputId}
          name="hours"
          type="number"
          min={MIN_ENTERED_HOURS_PER_DAY}
          max={MAX_HOURS_PER_DAY}
          step="any"
          defaultValue={SUGGESTED_HOURS_PER_DAY}
          required
        />
      </span>
      <button type="submit" className="button button-primary">
        Check with this value
      </button>
    </form>
  );
}
