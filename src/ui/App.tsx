import "./App.css";
import { type RefObject, useEffect, useRef, useState } from "react";
import { BYTES_PER_MEGABYTE, MAX_UPLOAD_BYTES, MAX_UPLOAD_MEGABYTES } from "../shared/api.ts";
import { type CheckerApi, CONFLICT, RequestError, reasonOf } from "./api.ts";
import { CheckSheet } from "./CheckSheet.tsx";
import { resolveSelection, type Selection } from "./details.ts";
import { Finish } from "./Finish.tsx";
import { FloatChart } from "./FloatChart.tsx";
import {
  arrangeFiles,
  type CheckedFile,
  type FileResult,
  isChecked,
  type LoadedFile,
  MAX_FILES,
  storedFile,
  unsavedFile,
} from "./files.ts";
import { countOf } from "./format.ts";
import { Lists } from "./Lists.tsx";
import { comparedPair } from "./review.ts";
import { StartPage } from "./StartPage.tsx";
import { useComparison } from "./useComparison.ts";
import { WrittenReview } from "./WrittenReview.tsx";

type View =
  | { readonly kind: "start"; readonly alert: string | null }
  | { readonly kind: "busy"; readonly message: string }
  | {
      readonly kind: "results";
      readonly files: readonly LoadedFile[];
      readonly alert: string | null;
    };

const START: View = { kind: "start", alert: null };
const OPENING: View = { kind: "busy", message: "Opening the checked files…" };
const FILES_PARAMETER = "files";

interface HoursOutcome {
  readonly result: FileResult;
  readonly alert: string | null;
}

interface AppProps {
  readonly api: CheckerApi;
}

export function App({ api }: AppProps) {
  const [view, setView] = useState<View>(() => (fileIdsInUrl().length > 0 ? OPENING : START));
  const [chosen, setChosen] = useState<Selection | null>(null);
  const [checkingKeys, setCheckingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const latestRequest = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function showFilesInUrl() {
      const isLatest = nextRequest(latestRequest);
      const ids = fileIdsInUrl();
      if (ids.length > 0) {
        setView(OPENING);
      }
      const next = ids.length > 0 ? await openFiles(api, ids) : START;
      if (!cancelled && isLatest()) {
        setView(next);
        setChosen(null);
      }
    }
    showFilesInUrl();
    addEventListener("popstate", showFilesInUrl);
    return () => {
      cancelled = true;
      removeEventListener("popstate", showFilesInUrl);
    };
  }, [api]);

  function showResults(files: readonly LoadedFile[]) {
    const ids = files.flatMap((file) => file.id ?? []);
    if (ids.length > 0) {
      history.pushState(null, "", `?${FILES_PARAMETER}=${ids.map(encodeURIComponent).join(",")}`);
    }
    setView({ kind: "results", files, alert: null });
    setChosen(null);
  }

  async function uploadFiles(picked: readonly File[]) {
    const isLatest = nextRequest(latestRequest);
    if (picked.length > MAX_FILES) {
      setView({ kind: "start", alert: `Choose up to ${MAX_FILES} files at a time.` });
      return;
    }
    setView({
      kind: "busy",
      message:
        picked.length === 1
          ? "Uploading and checking the file…"
          : `Uploading and checking ${picked.length} files…`,
    });
    const files = await Promise.all(picked.map((file, position) => upload(api, file, position)));
    if (isLatest()) {
      showResults(files);
    }
  }

  async function checkSampleFiles() {
    const isLatest = nextRequest(latestRequest);
    setView({ kind: "busy", message: "Checking the sample files…" });
    try {
      const samples = await api.checkSampleFiles();
      if (isLatest()) {
        showResults(samples.map((sample, position) => storedFile(sample, position)));
      }
    } catch (error) {
      if (isLatest()) {
        setView({
          kind: "start",
          alert: `The sample files could not be checked. ${reasonOf(error)}`,
        });
      }
    }
  }

  async function enterHoursPerDay(file: LoadedFile, hoursPerDay: number) {
    const { id } = file;
    if (id === null) {
      return;
    }
    const shownRequest = latestRequest.current;
    setCheckingKeys((keys) => new Set(keys).add(file.key));
    const outcome = await api.enterHoursPerDay(id, hoursPerDay).then(
      (stored): HoursOutcome => ({ result: stored.result, alert: null }),
      (error: unknown) => hoursNotEntered(api, id, file, error),
    );
    setCheckingKeys((keys) => {
      const remaining = new Set(keys);
      remaining.delete(file.key);
      return remaining;
    });
    if (shownRequest !== latestRequest.current) {
      return;
    }
    setView((current) =>
      current.kind === "results"
        ? {
            kind: "results",
            alert: outcome.alert,
            files: current.files.map((shown) =>
              shown.key === file.key ? { ...shown, result: outcome.result } : shown,
            ),
          }
        : current,
    );
  }

  function startOver() {
    nextRequest(latestRequest);
    history.pushState(null, "", location.pathname);
    setView(START);
  }

  return (
    <div className="page">
      <header className="app-bar">
        <span className="wordmark">P6 schedule checker</span>
        {view.kind === "results" && (
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={startOver}
          >
            Check other files
          </button>
        )}
      </header>
      <main>
        {view.kind === "start" && (
          <StartPage alert={view.alert} onUpload={uploadFiles} onCheckSamples={checkSampleFiles} />
        )}
        {view.kind === "busy" && (
          <p className="loading" role="status">
            <span className="loading-bar" aria-hidden="true" />
            {view.message}
          </p>
        )}
        {view.kind === "results" && (
          <Report
            api={api}
            files={view.files}
            alert={view.alert}
            checkingKeys={checkingKeys}
            chosen={chosen}
            onSelect={setChosen}
            onHoursPerDay={enterHoursPerDay}
          />
        )}
      </main>
    </div>
  );
}

interface ReportProps {
  readonly api: CheckerApi;
  readonly files: readonly LoadedFile[];
  readonly alert: string | null;
  readonly checkingKeys: ReadonlySet<string>;
  readonly chosen: Selection | null;
  readonly onSelect: (selection: Selection) => void;
  readonly onHoursPerDay: (file: LoadedFile, hoursPerDay: number) => void;
}

function Report({ api, files, alert, checkingKeys, chosen, onSelect, onHoursPerDay }: ReportProps) {
  const arranged = arrangeFiles(files);
  const checked = arranged.filter(isChecked);
  const pair = comparedPair(checked);
  const comparison = useComparison(api, pair);
  const selection = resolveSelection(checked, chosen, pair !== null);
  const listsRef = useRef<HTMLElement>(null);

  function showList(next: Selection) {
    onSelect(next);
    listsRef.current?.scrollIntoView?.({ block: "start" });
  }

  return (
    <>
      <ReportHeader files={arranged} checked={checked} />
      {alert !== null && (
        <p className="alert report-alert" role="alert">
          {alert}
        </p>
      )}
      <Finish files={checked} />
      <CheckSheet
        files={arranged}
        checkingKeys={checkingKeys}
        selection={selection}
        onSelect={showList}
        onHoursPerDay={onHoursPerDay}
      />
      {checked.length > 0 && <FloatChart files={checked} />}
      {pair !== null && <WrittenReview state={comparison} pair={pair} />}
      {selection !== null && (
        <Lists
          ref={listsRef}
          files={checked}
          selection={selection}
          onSelect={onSelect}
          pair={pair}
          comparison={comparison}
        />
      )}
    </>
  );
}

interface ReportHeaderProps {
  readonly files: readonly LoadedFile[];
  readonly checked: readonly CheckedFile[];
}

function ReportHeader({ files, checked }: ReportHeaderProps) {
  const latest = checked.at(-1);
  if (latest === undefined) {
    return (
      <div className="report-head">
        <h1>{files.length === 1 ? "The file could not be checked" : "No file could be checked"}</h1>
        <p className="report-sub">The reason is under each file name below.</p>
      </div>
    );
  }
  const first = checked[0] ?? latest;
  const several = first !== latest;
  const { facts } = latest.result;
  return (
    <div className="report-head">
      <h1>{several ? `${first.label} to ${latest.label}` : latest.label}</h1>
      <p className="report-source">
        {several && `${latest.label} has `}
        {countOf(facts.activityCount, "activity", "activities")} and{" "}
        {countOf(facts.linkCount, "relationship", "relationships")}
        {facts.p6Version !== "" && <>, exported from P6 {facts.p6Version}</>}.
      </p>
    </div>
  );
}

function nextRequest(latestRequest: RefObject<number>): () => boolean {
  latestRequest.current += 1;
  const request = latestRequest.current;
  return () => request === latestRequest.current;
}

async function hoursNotEntered(
  api: CheckerApi,
  id: string,
  file: LoadedFile,
  error: unknown,
): Promise<HoursOutcome> {
  if (error instanceof RequestError && error.status === CONFLICT) {
    const stored = await api.openFile(id).catch(() => null);
    if (stored !== null) {
      return {
        result: stored.result,
        alert: `The work hours in a day were already entered for ${file.fileName}, so it shows the results checked with those hours.`,
      };
    }
  }
  return {
    result: file.result,
    alert: `${file.fileName} could not be checked with these hours. ${reasonOf(error)}`,
  };
}

async function upload(api: CheckerApi, file: File, position: number): Promise<LoadedFile> {
  if (file.size > MAX_UPLOAD_BYTES) {
    const megabytes = Math.ceil(file.size / BYTES_PER_MEGABYTE);
    return unsavedFile(
      file.name,
      position,
      `This file is ${megabytes} MB. The checker reads files up to ${MAX_UPLOAD_MEGABYTES} MB.`,
    );
  }
  try {
    return storedFile(await api.uploadFile(file), position);
  } catch (error) {
    return unsavedFile(file.name, position, reasonOf(error));
  }
}

async function openFiles(api: CheckerApi, ids: readonly string[]): Promise<View> {
  const opened = await Promise.allSettled(ids.map((id) => api.openFile(id)));
  const files = opened.flatMap((outcome, position) =>
    outcome.status === "fulfilled" ? [storedFile(outcome.value, position)] : [],
  );
  const failure = opened.find((outcome) => outcome.status === "rejected");
  const alert =
    failure === undefined
      ? null
      : `Could not open ${countOf(ids.length - files.length, "file", "files")} in this link. ${reasonOf(failure.reason)}`;
  return files.length > 0 ? { kind: "results", files, alert } : { kind: "start", alert };
}

function fileIdsInUrl(): string[] {
  const value = new URLSearchParams(location.search).get(FILES_PARAMETER) ?? "";
  const ids = value.split(",").filter((id) => id !== "");
  return [...new Set(ids)].slice(0, MAX_FILES);
}
