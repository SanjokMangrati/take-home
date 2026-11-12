import "./WrittenReview.css";
import { useState } from "react";
import { type ComparedPair, reviewOf, reviewText } from "./review.ts";
import { Section } from "./Section.tsx";
import type { ComparisonState } from "./useComparison.ts";

interface WrittenReviewProps {
  readonly state: ComparisonState;
  readonly pair: ComparedPair;
}

export function WrittenReview({ state, pair }: WrittenReviewProps) {
  const topics = state.kind === "loaded" ? reviewOf(state.comparison, pair) : null;
  const text = topics === null ? null : reviewText(topics);
  return (
    <Section
      title={`What changed since ${pair.from.label}`}
      actions={text !== null && <CopyButton key={text} text={text} />}
    >
      {state.kind === "loading" && (
        <p className="empty" role="status">
          Comparing the files…
        </p>
      )}
      {state.kind === "failed" && (
        <p className="alert" role="alert">
          The files could not be compared. {state.reason}
        </p>
      )}
      {topics !== null && (
        <dl className="review">
          {topics.map((topic) => (
            <div key={topic.title} className="review-topic">
              <dt>{topic.title}</dt>
              <dd>
                {topic.sentences.map((sentence) => (
                  <p key={sentence}>{sentence}</p>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Section>
  );
}

type CopyState = "ready" | "copied" | "failed";

const COPY_LABELS: Readonly<Record<CopyState, string>> = {
  ready: "Copy as text",
  copied: "Copied",
  failed: "Could not copy",
};

function CopyButton({ text }: { readonly text: string }) {
  const [state, setState] = useState<CopyState>("ready");
  return (
    <button
      type="button"
      className="button button-secondary button-small"
      onClick={() => {
        if (navigator.clipboard === undefined) {
          setState("failed");
          return;
        }
        navigator.clipboard.writeText(text).then(
          () => setState("copied"),
          () => setState("failed"),
        );
      }}
    >
      <span aria-live="polite">{COPY_LABELS[state]}</span>
    </button>
  );
}
