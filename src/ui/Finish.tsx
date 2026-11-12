import "./Finish.css";
import { useId } from "react";
import { calendarDaysBetween } from "../core/compare.ts";
import { type CheckedFile, onlyProject } from "./files.ts";
import { formatDataDate, formatDayCount } from "./format.ts";

const END_ROOM = 0.24;

interface ScheduledFinish {
  readonly file: CheckedFile;
  readonly label: string;
  readonly dataDate: string | null;
  readonly finish: string;
  readonly mustFinishBy: string | null;
}

interface Update extends ScheduledFinish {
  readonly dataDate: string;
}

interface FinishProps {
  readonly files: readonly CheckedFile[];
}

export function Finish({ files }: FinishProps) {
  const headingId = useId();
  const finishes = files.map(scheduledFinishOf);
  const latest = finishes.at(-1);
  if (latest === null || latest === undefined) {
    return null;
  }
  const previous = finishes.slice(0, -1).findLast((finish) => finish !== null) ?? null;
  const updates = finishes.filter(isUpdate);
  return (
    <section className="finish" aria-labelledby={headingId}>
      <div className="finish-headline">
        <h2 id={headingId}>Scheduled finish</h2>
        <p className="finish-date">{formatDataDate(latest.finish)}</p>
        <ul className="finish-facts">
          {latest.mustFinishBy !== null && (
            <DeadlineFact finish={latest.finish} deadline={latest.mustFinishBy} />
          )}
          {previous !== null && <SlipFact latest={latest} previous={previous} />}
        </ul>
      </div>
      {updates.length > 0 && (
        <Strip updates={updates} latestKey={latest.file.key} deadline={latest.mustFinishBy} />
      )}
    </section>
  );
}

function scheduledFinishOf(file: CheckedFile): ScheduledFinish | null {
  const project = onlyProject(file);
  if (!project?.scheduledFinish) {
    return null;
  }
  return {
    file,
    label: file.label,
    dataDate: project.dataDate,
    finish: project.scheduledFinish,
    mustFinishBy: project.mustFinishBy,
  };
}

function isUpdate(finish: ScheduledFinish | null): finish is Update {
  return finish !== null && finish.dataDate !== null;
}

function DeadlineFact({
  finish,
  deadline,
}: {
  readonly finish: string;
  readonly deadline: string;
}) {
  const days = calendarDaysBetween(deadline, finish);
  const mustFinish = (
    <>
      The project must finish by <time dateTime={deadline}>{formatDataDate(deadline)}</time>.
    </>
  );
  if (days === 0) {
    return <li>On time. {mustFinish}</li>;
  }
  const amount = formatDayCount(days);
  return days > 0 ? (
    <li>
      <strong className="marked">{amount} late.</strong> {mustFinish}
    </li>
  ) : (
    <li>
      {amount} early. {mustFinish}
    </li>
  );
}

function SlipFact({
  latest,
  previous,
}: {
  readonly latest: ScheduledFinish;
  readonly previous: ScheduledFinish;
}) {
  const days = calendarDaysBetween(previous.finish, latest.finish);
  if (days === 0) {
    return <li>No change since {previous.label}.</li>;
  }
  const amount = formatDayCount(days);
  const from = (
    <>
      since {previous.label}, from{" "}
      <time dateTime={previous.finish}>{formatDataDate(previous.finish)}</time>.
    </>
  );
  return days > 0 ? (
    <li>
      <strong className="marked">Moved {amount} later</strong> {from}
    </li>
  ) : (
    <li>
      Moved {amount} earlier {from}
    </li>
  );
}

interface StripProps {
  readonly updates: readonly Update[];
  readonly latestKey: string;
  readonly deadline: string | null;
}

function Strip({ updates, latestKey, deadline }: StripProps) {
  const dates = updates.flatMap((update) => [update.dataDate, update.finish]);
  const first = dates.toSorted()[0] ?? updates[0]?.dataDate ?? "";
  const last = [...dates, deadline ?? ""].toSorted().at(-1) ?? first;
  const span = Math.max(calendarDaysBetween(first, last), 1);
  const at = (date: string) => (calendarDaysBetween(first, date) / (span * (1 + END_ROOM))) * 100;

  return (
    <figure className="strip">
      <div className="strip-plot" aria-hidden="true">
        {yearStarts(first, last).map((date) => (
          <span key={date} className="strip-year" style={{ left: `${at(date)}%` }}>
            {date.slice(0, 4)}
          </span>
        ))}
        {updates.map((update) => {
          const start = at(update.dataDate);
          const end = at(update.finish);
          const isLatest = update.file.key === latestKey;
          const overrunFrom =
            deadline !== null && update.finish > deadline && end > start
              ? Math.max(at(deadline), start)
              : null;
          return (
            <div
              key={update.file.key}
              className={`strip-row series-${update.file.slot}${isLatest ? " strip-current" : ""}`}
            >
              <span className="strip-name" style={{ left: `${start}%` }}>
                {update.label}
              </span>
              <span className="strip-bar" style={{ left: `${start}%`, width: `${end - start}%` }}>
                {overrunFrom !== null && (
                  <span
                    className="strip-overrun"
                    style={{ left: `${((overrunFrom - start) / (end - start)) * 100}%` }}
                  />
                )}
              </span>
              {!isLatest && (
                <span className="strip-end" style={{ left: `${end}%` }}>
                  {formatDataDate(update.finish)}
                </span>
              )}
            </div>
          );
        })}
        {deadline !== null && (
          <span className="strip-deadline" style={{ left: `${at(deadline)}%` }}>
            <span className="strip-deadline-label">Must finish by {formatDataDate(deadline)}</span>
          </span>
        )}
      </div>
      <div className="visually-hidden">
        <table>
          <caption>Data date and scheduled finish of each update</caption>
          <thead>
            <tr>
              <th scope="col">Update</th>
              <th scope="col">Data date</th>
              <th scope="col">Scheduled finish</th>
              <th scope="col">Must finish by</th>
            </tr>
          </thead>
          <tbody>
            {updates.map((update) => (
              <tr key={update.file.key}>
                <th scope="row">{update.label}</th>
                <td>{formatDataDate(update.dataDate)}</td>
                <td>{formatDataDate(update.finish)}</td>
                <td>
                  {update.mustFinishBy === null ? "Not set" : formatDataDate(update.mustFinishBy)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function yearStarts(first: string, last: string): string[] {
  const from = Number(first.slice(0, 4)) + 1;
  const to = Number(last.slice(0, 4));
  return Array.from({ length: Math.max(to - from + 1, 0) }, (_, index) => `${from + index}-01-01`);
}
