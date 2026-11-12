import { useEffect, useState } from "react";
import type { Comparison } from "../core/compare.ts";
import { type CheckerApi, reasonOf } from "./api.ts";
import type { ComparedPair } from "./review.ts";

export type ComparisonState =
  | { readonly kind: "none" }
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly comparison: Comparison }
  | { readonly kind: "failed"; readonly reason: string };

interface Fetched {
  readonly key: string;
  readonly state: ComparisonState;
}

const NONE: ComparisonState = { kind: "none" };
const LOADING: ComparisonState = { kind: "loading" };

export function useComparison(api: CheckerApi, pair: ComparedPair | null): ComparisonState {
  const fromId = pair?.from.id ?? null;
  const toId = pair?.to.id ?? null;
  const key = `${fromId}:${toId}`;
  const [fetched, setFetched] = useState<Fetched | null>(null);

  useEffect(() => {
    if (fromId === null || toId === null) {
      return;
    }
    let cancelled = false;
    const settle = (state: ComparisonState) => {
      if (!cancelled) {
        setFetched({ key: `${fromId}:${toId}`, state });
      }
    };
    api.compareFiles(fromId, toId).then(
      (comparison) => settle({ kind: "loaded", comparison }),
      (error: unknown) => settle({ kind: "failed", reason: reasonOf(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, fromId, toId]);

  if (pair === null) {
    return NONE;
  }
  return fetched?.key === key ? fetched.state : LOADING;
}
