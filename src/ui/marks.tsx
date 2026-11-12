import "./marks.css";
import type { CheckStatus } from "../core/checks.ts";
import type { SeriesSlot } from "./files.ts";

type VerdictStatus = Exclude<CheckStatus, "nothing-to-check">;

const VERDICT_LABELS: Readonly<Record<VerdictStatus, string>> = {
  pass: "Pass",
  fail: "Fail",
};

export function Verdict({ status }: { readonly status: VerdictStatus }) {
  return <span className={`verdict verdict-${status}`}>{VERDICT_LABELS[status]}</span>;
}

export function SeriesKey({ slot }: { readonly slot: SeriesSlot }) {
  return <span className={`series-key series-${slot}`} aria-hidden="true" />;
}
