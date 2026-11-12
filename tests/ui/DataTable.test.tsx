import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { type Columns, DataTable } from "../../src/ui/DataTable.tsx";

const COLUMNS: Columns<number> = [{ header: "Row", cell: (row) => row }];

function numbers(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

function table(rows: readonly number[]) {
  return (
    <DataTable caption="Numbers" columns={COLUMNS} rows={rows} rowKey={String} empty="None." />
  );
}

function renderTable(rows: readonly number[]) {
  return render(table(rows));
}

function shownRows(): (string | null)[] {
  return screen.getAllByRole("rowheader").map((cell) => cell.textContent);
}

function pager() {
  return screen.getByRole("navigation", { name: "Pages of Numbers" });
}

afterEach(cleanup);

describe("DataTable", () => {
  test("shows a long table 25 rows at a time", () => {
    renderTable(numbers(60));

    expect(shownRows()).toEqual(numbers(25).map(String));
    expect(pager().textContent).toContain("Rows 1 to 25 of 60");
    expect(within(pager()).getByRole("button", { name: "Previous" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  test("moves to the next and previous pages", () => {
    renderTable(numbers(60));
    const next = within(pager()).getByRole("button", { name: "Next" });
    fireEvent.click(next);
    fireEvent.click(next);

    expect(shownRows()).toEqual(["51", "52", "53", "54", "55", "56", "57", "58", "59", "60"]);
    expect(pager().textContent).toContain("Rows 51 to 60 of 60");
    expect(next).toHaveProperty("disabled", true);

    fireEvent.click(within(pager()).getByRole("button", { name: "Previous" }));
    expect(shownRows()[0]).toBe("26");
  });

  test("has no pager when every row fits on one page", () => {
    renderTable(numbers(25));

    expect(screen.queryByRole("navigation")).toBeNull();
  });

  test("moves back to the last page when the table gets shorter", () => {
    const { rerender } = renderTable(numbers(60));
    fireEvent.click(within(pager()).getByRole("button", { name: "Next" }));
    fireEvent.click(within(pager()).getByRole("button", { name: "Next" }));
    rerender(table(numbers(30)));

    expect(shownRows()).toEqual(["26", "27", "28", "29", "30"]);
    expect(pager().textContent).toContain("Rows 26 to 30 of 30");
  });
});
