export type Problem =
  | { readonly kind: "extra-fields"; readonly fields: number; readonly columns: number }
  | { readonly kind: "damaged-text"; readonly codePoints: readonly number[] }
  | { readonly kind: "not-a-row"; readonly previousLine: number | null }
  | { readonly kind: "row-before-columns" }
  | { readonly kind: "text-after-end" }
  | { readonly kind: "missing-value"; readonly column: string }
  | { readonly kind: "missing-float" }
  | { readonly kind: "not-an-integer"; readonly column: string; readonly value: string }
  | { readonly kind: "not-a-number"; readonly column: string; readonly value: string }
  | { readonly kind: "number-too-large"; readonly column: string; readonly value: string }
  | { readonly kind: "unknown-value"; readonly column: string; readonly value: string }
  | {
      readonly kind: "duplicate-id";
      readonly column: string;
      readonly value: string;
      readonly firstLine: number;
    }
  | { readonly kind: "calendar-not-in-file"; readonly calendarId: string }
  | { readonly kind: "calendar-broken"; readonly calendarId: string; readonly line: number }
  | { readonly kind: "hours-per-day-out-of-range"; readonly value: number }
  | { readonly kind: "self-link" }
  | { readonly kind: "link-end-not-in-file"; readonly column: string; readonly taskId: string }
  | {
      readonly kind: "link-end-broken";
      readonly column: string;
      readonly taskId: string;
      readonly line: number;
    };

export type Effect =
  | { readonly kind: "not-used" }
  | { readonly kind: "row-ignored" }
  | { readonly kind: "still-used" }
  | { readonly kind: "activity-not-read" }
  | { readonly kind: "left-out-of-float-checks" }
  | { readonly kind: "left-out-of-high-float-check" }
  | { readonly kind: "link-not-counted" }
  | { readonly kind: "calendar-unusable"; readonly activities: number };

export function affectsChecks(effect: Effect): boolean {
  switch (effect.kind) {
    case "not-used":
    case "row-ignored":
    case "still-used":
      return false;
    case "calendar-unusable":
      return effect.activities > 0;
    case "activity-not-read":
    case "left-out-of-float-checks":
    case "left-out-of-high-float-check":
    case "link-not-counted":
      return true;
  }
}

export interface BrokenRow {
  readonly line: number;
  readonly table: string | null;
  readonly subject: string | null;
  readonly problems: readonly Problem[];
  readonly effect: Effect;
}

export const MAX_BROKEN_ROWS = 10_000;

export function tooManyBrokenRows(line: number): XerFileError {
  return new XerFileError(
    `This file has more than ${MAX_BROKEN_ROWS.toLocaleString("en-GB")} broken rows, so it is too damaged to check. Export it from P6 again.`,
    line,
  );
}

export function byLine(a: { readonly line: number }, b: { readonly line: number }): number {
  return a.line - b.line;
}

export class XerFileError extends Error {
  override readonly name = "XerFileError";
  readonly line: number | null;

  constructor(message: string, line: number | null = null) {
    super(message);
    this.line = line;
  }
}
