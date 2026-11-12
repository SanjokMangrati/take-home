import "./DataTable.css";
import { type ReactNode, useState } from "react";
import { formatCount } from "./format.ts";

const PAGE_SIZE = 25;

export interface Column<Row> {
  readonly header: string;
  readonly cell: (row: Row) => ReactNode;
  readonly numeric?: boolean;
  readonly mono?: boolean;
}

export type Columns<Row> = readonly [Column<Row>, ...Column<Row>[]];

interface DataTableProps<Row> {
  readonly caption: string;
  readonly columns: Columns<Row>;
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  readonly empty: string;
}

export function DataTable<Row>({ caption, columns, rows, rowKey, empty }: DataTableProps<Row>) {
  const [page, setPage] = useState(0);
  if (rows.length === 0) {
    return <p className="empty">{empty}</p>;
  }
  const pageCount = Math.ceil(rows.length / PAGE_SIZE);
  const currentPage = Math.min(page, pageCount - 1);
  const start = currentPage * PAGE_SIZE;
  const shown = rows.slice(start, start + PAGE_SIZE);
  const [rowHeader, ...rest] = columns;
  return (
    <>
      <div className="table-frame">
        <table className="data-table">
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.header} scope="col" className={alignClass(column)}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={rowKey(row)}>
                <th scope="row" className={cellClass(rowHeader)} data-label={rowHeader.header}>
                  {rowHeader.cell(row)}
                </th>
                {rest.map((column) => (
                  <td key={column.header} className={cellClass(column)} data-label={column.header}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageCount > 1 && (
        <nav className="pager" aria-label={`Pages of ${caption}`}>
          <span aria-live="polite">
            Rows {formatCount(start + 1)} to {formatCount(start + shown.length)} of{" "}
            {formatCount(rows.length)}
          </span>
          <span className="pager-buttons">
            <button
              type="button"
              className="button button-secondary button-small"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous
            </button>
            <button
              type="button"
              className="button button-secondary button-small"
              disabled={currentPage === pageCount - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </button>
          </span>
        </nav>
      )}
    </>
  );
}

function alignClass<Row>(column: Column<Row>): string | undefined {
  return column.numeric ? "numeric" : undefined;
}

function cellClass<Row>(column: Column<Row>): string | undefined {
  const names = [alignClass(column), column.mono ? "mono" : undefined].filter(
    (name) => name !== undefined,
  );
  return names.length > 0 ? names.join(" ") : undefined;
}
