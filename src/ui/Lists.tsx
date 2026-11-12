import "./Lists.css";
import { type ReactNode, type Ref, useId } from "react";
import {
  type CheckSummary,
  type FloatFinding,
  HIGH_FLOAT_THRESHOLD_DAYS,
  type MissingLinkFinding,
} from "../core/checks.ts";
import {
  type ActivitySummary,
  type Comparison,
  type FloatChange,
  isLostFloat,
  isNowNegative,
  type RelationshipChange,
} from "../core/compare.ts";
import { affectsChecks, type BrokenRow } from "../core/xer/problems.ts";
import { type Columns, DataTable } from "./DataTable.tsx";
import {
  describeEffect,
  describeNote,
  describeProblem,
  describeRelationships,
  describeStatus,
} from "./describe.ts";
import {
  CHANGE_LIST_LABELS,
  CHANGE_LIST_NAMES,
  type ChangeListName,
  DETAIL_DEFINITIONS,
  DETAIL_LABELS,
  DETAIL_NAMES,
  type DetailName,
  firstFailingCheck,
  isChangeList,
  type Selection,
} from "./details.ts";
import type { CheckedFile } from "./files.ts";
import { countOf, formatDays, formatSignedDays } from "./format.ts";
import type { ComparedPair } from "./review.ts";
import { Section } from "./Section.tsx";
import { SegmentedControl } from "./SegmentedControl.tsx";
import type { ComparisonState } from "./useComparison.ts";

interface ChangedActivity extends ActivitySummary {
  readonly change: "Added" | "Removed";
}

interface ChangeRows {
  readonly lostFloat: readonly FloatChange[];
  readonly nowNegative: readonly FloatChange[];
  readonly addedOrRemoved: readonly ChangedActivity[];
  readonly relationships: readonly RelationshipChange[];
}

const NONE_FOUND: Readonly<Record<DetailName, string>> = {
  missingLinks: "Every open activity has a predecessor and a successor.",
  negativeFloat: "No open activity has negative float.",
  highFloat: `No open activity has more than ${HIGH_FLOAT_THRESHOLD_DAYS} working days of float.`,
  brokenRows: "No broken rows.",
};

const CHANGE_DESCRIPTIONS: Readonly<Record<ChangeListName, string>> = {
  lostFloat:
    "Activities open in both updates whose total float went down, largest drop first. Float is in working days.",
  nowNegative:
    "Activities open in both updates whose total float went from zero or more to below zero. Float is in working days.",
  addedOrRemoved: "Activities that are in only one of the two updates.",
  relationships:
    "Pairs of activities that were newly linked, are no longer linked, or are linked in a different way.",
};

interface ListsProps {
  readonly files: readonly CheckedFile[];
  readonly selection: Selection;
  readonly onSelect: (selection: Selection) => void;
  readonly pair: ComparedPair | null;
  readonly comparison: ComparisonState;
  readonly ref?: Ref<HTMLElement>;
}

export function Lists({ files, selection, onSelect, pair, comparison, ref }: ListsProps) {
  const group = useId();
  const file = files.find((shown) => shown.key === selection.fileKey) ?? files.at(-1);
  if (file === undefined) {
    return null;
  }
  const rows = comparison.kind === "loaded" ? changeRows(comparison.comparison) : null;
  const detail = isChangeList(selection.list) ? firstFailingCheck(file) : selection.list;
  return (
    <Section ref={ref} title="Activity lists">
      <div className="lists">
        <div className="lists-rail">
          <fieldset className="rail-group">
            <legend>Checks</legend>
            {files.length > 1 && (
              <SegmentedControl
                legend="Update"
                choices={files.map((shown) => ({ value: shown.key, label: shown.label }))}
                value={file.key}
                onChange={(fileKey) => {
                  const chosen = files.find((shown) => shown.key === fileKey) ?? file;
                  onSelect({
                    fileKey,
                    list: isChangeList(selection.list) ? firstFailingCheck(chosen) : selection.list,
                  });
                }}
              />
            )}
            {DETAIL_NAMES.map((name) => (
              <RailItem
                key={name}
                group={group}
                label={DETAIL_LABELS[name]}
                checked={selection.list === name}
                onChoose={() => onSelect({ fileKey: file.key, list: name })}
              />
            ))}
          </fieldset>
          {pair !== null && (
            <fieldset className="rail-group">
              <legend>Changes</legend>
              {CHANGE_LIST_NAMES.map((name) => (
                <RailItem
                  key={name}
                  group={group}
                  label={CHANGE_LIST_LABELS[name]}
                  checked={selection.list === name}
                  onChoose={() => onSelect({ fileKey: file.key, list: name })}
                />
              ))}
            </fieldset>
          )}
        </div>
        {isChangeList(selection.list) && pair !== null ? (
          <ListContent
            title={`${CHANGE_LIST_LABELS[selection.list]}, ${pair.from.label} to ${pair.to.label}`}
            description={CHANGE_DESCRIPTIONS[selection.list]}
          >
            <ChangeTable
              key={selection.list}
              list={selection.list}
              pair={pair}
              comparison={comparison}
              rows={rows}
            />
          </ListContent>
        ) : (
          <DetailContent key={`${file.key}-${detail}`} file={file} detail={detail} />
        )}
      </div>
    </Section>
  );
}

interface RailItemProps {
  readonly group: string;
  readonly label: string;
  readonly checked: boolean;
  readonly onChoose: () => void;
}

function RailItem({ group, label, checked, onChoose }: RailItemProps) {
  return (
    <label className="rail-item">
      <input type="radio" name={group} checked={checked} onChange={onChoose} />
      {label}
    </label>
  );
}

interface ListContentProps {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}

function ListContent({ title, description, children }: ListContentProps) {
  const headingId = useId();
  return (
    <section className="lists-content" aria-labelledby={headingId}>
      <div className="lists-content-head">
        <h3 id={headingId} className="visually-hidden">
          {title}
        </h3>
        <p className="note">{description}</p>
      </div>
      {children}
    </section>
  );
}

interface DetailContentProps {
  readonly file: CheckedFile;
  readonly detail: DetailName;
}

function DetailContent({ file, detail }: DetailContentProps) {
  const { checks, broken, notes } = file.result;
  const caption = `${DETAIL_LABELS[detail]} in ${file.label}`;
  return (
    <ListContent title={caption} description={DETAIL_DEFINITIONS[detail]}>
      {detail === "missingLinks" && (
        <DataTable
          caption={caption}
          columns={MISSING_LINK_COLUMNS}
          rows={checks.missingLinks.findings}
          rowKey={(finding) => finding.activity.id}
          empty={emptyMessage(checks.missingLinks.summary, NONE_FOUND[detail])}
        />
      )}
      {(detail === "negativeFloat" || detail === "highFloat") && (
        <DataTable
          caption={caption}
          columns={FLOAT_COLUMNS}
          rows={checks[detail].findings}
          rowKey={(finding) => finding.activity.id}
          empty={emptyMessage(checks[detail].summary, NONE_FOUND[detail])}
        />
      )}
      {detail === "brokenRows" && (
        <>
          {notes.length > 0 && (
            <ul className="lists-notes">
              {notes.map((note) => (
                <li key={note.kind}>{describeNote(note)}</li>
              ))}
            </ul>
          )}
          <DataTable
            caption={caption}
            columns={BROKEN_ROW_COLUMNS}
            rows={broken}
            rowKey={(row) => String(row.line)}
            empty={NONE_FOUND[detail]}
          />
        </>
      )}
    </ListContent>
  );
}

interface ChangeTableProps {
  readonly list: ChangeListName;
  readonly pair: ComparedPair;
  readonly comparison: ComparisonState;
  readonly rows: ChangeRows | null;
}

function ChangeTable({ list, pair, comparison, rows }: ChangeTableProps) {
  if (comparison.kind === "failed") {
    return <p className="empty">The files could not be compared. {comparison.reason}</p>;
  }
  if (rows === null) {
    return <p className="empty">Comparing the files…</p>;
  }
  switch (list) {
    case "lostFloat":
      return (
        <DataTable
          caption="Activities that lost float"
          columns={floatChangeColumns(pair)}
          rows={rows.lostFloat}
          rowKey={(change) => change.code}
          empty="No activity open in both files lost float."
        />
      );
    case "nowNegative":
      return (
        <DataTable
          caption="Activities whose float went negative"
          columns={floatChangeColumns(pair)}
          rows={rows.nowNegative}
          rowKey={(change) => change.code}
          empty="No activity went from zero or positive float to negative float."
        />
      );
    case "addedOrRemoved":
      return (
        <DataTable
          caption="Activities added or removed"
          columns={activityColumns(pair)}
          rows={rows.addedOrRemoved}
          rowKey={(activity) => `${activity.change}-${activity.code}`}
          empty="No activities were added or removed."
        />
      );
    case "relationships":
      return (
        <DataTable
          caption="Relationships that changed"
          columns={relationshipColumns(pair)}
          rows={rows.relationships}
          rowKey={(change) => JSON.stringify([change.predecessorCode, change.successorCode])}
          empty="No relationships changed."
        />
      );
  }
}

function changeRows(comparison: Comparison): ChangeRows {
  return {
    lostFloat: comparison.floatChanges.filter(isLostFloat),
    nowNegative: comparison.floatChanges.filter(isNowNegative),
    addedOrRemoved: [
      ...comparison.added.map((activity) => ({ ...activity, change: "Added" as const })),
      ...comparison.removed.map((activity) => ({ ...activity, change: "Removed" as const })),
    ],
    relationships: comparison.relationshipChanges,
  };
}

function emptyMessage(summary: CheckSummary, noneFound: string): string {
  if (summary.counted > 0) {
    return noneFound;
  }
  if (summary.leftOut === 0) {
    return "Nothing to check.";
  }
  const leftOut = countOf(summary.leftOut, "activity was", "activities were");
  return `Nothing to check. ${leftOut} left out. See Broken rows for details.`;
}

function missingLinkLabel(finding: MissingLinkFinding): string {
  if (finding.noPredecessor && finding.noSuccessor) {
    return "Predecessor and successor";
  }
  return finding.noPredecessor ? "Predecessor" : "Successor";
}

const MISSING_LINK_COLUMNS: Columns<MissingLinkFinding> = [
  { header: "Activity ID", mono: true, cell: (finding) => finding.activity.code },
  { header: "Activity name", cell: (finding) => finding.activity.name },
  { header: "Missing", cell: missingLinkLabel },
  { header: "Line", numeric: true, cell: (finding) => finding.activity.line },
];

const FLOAT_COLUMNS: Columns<FloatFinding> = [
  { header: "Activity ID", mono: true, cell: (finding) => finding.activity.code },
  { header: "Activity name", cell: (finding) => finding.activity.name },
  {
    header: "Total float, working days",
    numeric: true,
    cell: (finding) => (finding.floatDays === null ? "—" : formatDays(finding.floatDays)),
  },
  { header: "Line", numeric: true, cell: (finding) => finding.activity.line },
];

const BROKEN_ROW_COLUMNS: Columns<BrokenRow> = [
  { header: "Line", numeric: true, cell: (row) => row.line },
  {
    header: "Table",
    cell: (row) => (
      <>
        <span className="mono">{row.table ?? ""}</span>
        {row.subject !== null && <span className="row-subject">{row.subject}</span>}
      </>
    ),
  },
  {
    header: "Problem",
    cell: (row) => row.problems.map(describeProblem).join(" "),
  },
  {
    header: "Effect on the checks",
    cell: (row) => (
      <span className={affectsChecks(row.effect) ? "marked" : "effect-none"}>
        {describeEffect(row.effect)}
      </span>
    ),
  },
];

function floatChangeColumns({ from, to }: ComparedPair): Columns<FloatChange> {
  return [
    { header: "Activity ID", mono: true, cell: (change) => change.code },
    { header: "Activity name", cell: (change) => change.name },
    {
      header: `Float in ${from.label}`,
      numeric: true,
      cell: (change) => formatDays(change.beforeDays),
    },
    {
      header: `Float in ${to.label}`,
      numeric: true,
      cell: (change) => formatDays(change.afterDays),
    },
    { header: "Change", numeric: true, cell: (change) => formatSignedDays(change.changeDays) },
  ];
}

function activityColumns({ to }: ComparedPair): Columns<ChangedActivity> {
  return [
    { header: "Activity ID", mono: true, cell: (activity) => activity.code },
    { header: "Activity name", cell: (activity) => activity.name },
    { header: "Change", cell: (activity) => `${activity.change} in ${to.label}` },
    { header: "Status", cell: (activity) => describeStatus(activity.status) },
  ];
}

function relationshipColumns({ from, to }: ComparedPair): Columns<RelationshipChange> {
  return [
    { header: "Predecessor", mono: true, cell: (change) => change.predecessorCode },
    { header: "Successor", mono: true, cell: (change) => change.successorCode },
    { header: `In ${from.label}`, cell: (change) => describeRelationships(change.before) },
    { header: `In ${to.label}`, cell: (change) => describeRelationships(change.after) },
  ];
}
