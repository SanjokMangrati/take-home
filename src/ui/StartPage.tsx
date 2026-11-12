import "./StartPage.css";
import { type DragEvent, useId, useState } from "react";
import { MAX_UPLOAD_MEGABYTES, SAMPLE_FILES, SAMPLE_SOURCE_URL } from "../shared/api.ts";
import { MAX_FILES } from "./files.ts";

interface StartPageProps {
  readonly alert: string | null;
  readonly onUpload: (files: readonly File[]) => void;
  readonly onCheckSamples: () => void;
}

export function StartPage({ alert, onUpload, onCheckSamples }: StartPageProps) {
  const samplesHeadingId = useId();
  return (
    <div className="start">
      <div className="start-intro">
        <h1>Check a P6 schedule update</h1>
        <p className="lede">
          Upload this month's .xer export, and last month's to see what changed.
        </p>
      </div>
      <div className="start-actions">
        <UploadArea onUpload={onUpload} />
        <section className="samples" aria-labelledby={samplesHeadingId}>
          <h2 id={samplesHeadingId}>Try it with sample files</h2>
          <button type="button" className="button button-secondary" onClick={onCheckSamples}>
            Check the sample files
          </button>
          <p>
            <a href={SAMPLE_SOURCE_URL}>Dukhan Housing Project Phase IX</a>, exported from P6 17.12.
          </p>
          <p className="note">
            Or download them:{" "}
            {SAMPLE_FILES.map((sample, index) => (
              <span key={sample.fileName}>
                {index > 0 && " and "}
                <a href={`/samples/${sample.fileName}`} download>
                  {sample.label}
                </a>
              </span>
            ))}
            .
          </p>
        </section>
      </div>
      {alert !== null && (
        <p className="alert" role="alert">
          {alert}
        </p>
      )}
    </div>
  );
}

function UploadArea({ onUpload }: { readonly onUpload: (files: readonly File[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const hintId = useId();

  function stopDragging(event: DragEvent<HTMLElement>) {
    const { relatedTarget } = event;
    if (!(relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget))) {
      setDragging(false);
    }
  }

  return (
    <section
      aria-label="Upload"
      className={dragging ? "upload-area dragging" : "upload-area"}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={stopDragging}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const files = [...event.dataTransfer.files];
        if (files.length > 0) {
          onUpload(files);
        }
      }}
    >
      <p className="upload-title">Drop .xer files here</p>
      <label className="button button-primary">
        <input
          type="file"
          accept=".xer"
          multiple
          className="visually-hidden"
          aria-describedby={hintId}
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])];
            event.currentTarget.value = "";
            if (files.length > 0) {
              onUpload(files);
            }
          }}
        />
        Choose .xer files
      </label>
      <p id={hintId} className="note">
        Up to {MAX_FILES} files, {MAX_UPLOAD_MEGABYTES} MB each. Files are stored on the server.
      </p>
    </section>
  );
}
