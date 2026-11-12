import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Analysis, CheckedAnalysis } from "../../src/core/analyze.ts";
import { type Comparison, compareSchedules } from "../../src/core/compare.ts";
import type { Project } from "../../src/core/xer/schedule.ts";
import { BYTES_PER_MEGABYTE, type StoredFile } from "../../src/shared/api.ts";
import { App } from "../../src/ui/App.tsx";
import { type CheckerApi, RequestError } from "../../src/ui/api.ts";
import { analyzeXer, chain, checkedFile, scheduleFrom, scheduleXer } from "../support/xer.ts";

const PLOT_WIDTH = 800;

class FixedWidthObserver implements ResizeObserver {
  readonly #callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }

  observe(target: Element) {
    const entry = { target, contentRect: { width: PLOT_WIDTH } } as ResizeObserverEntry;
    this.#callback([entry], this);
  }

  unobserve() {}

  disconnect() {}
}

const fixture = checkedFile("tests/fixtures/broken-rows.xer");

const notAnXer = analyzeXer(new TextEncoder().encode("meeting notes\n"));

const noFloat = analyzeXer(
  scheduleXer({
    tasks: [
      { id: "1", floatHours: "" },
      { id: "2", floatHours: "" },
    ],
    links: chain(["1", "2"]),
  }),
);

function update(
  name: string,
  dates: Pick<Project, "dataDate" | "scheduledFinish" | "mustFinishBy">,
): CheckedAnalysis {
  return {
    ...fixture,
    facts: {
      ...fixture.facts,
      projects: fixture.facts.projects.map((project) => ({ ...project, name, ...dates })),
    },
  };
}

const longTail = analyzeXer(
  scheduleXer({
    tasks: [
      ...Array.from({ length: 1000 }, (_, index) => ({ id: String(index + 1), floatHours: "80" })),
      ...Array.from({ length: 10 }, (_, index) => ({
        id: String(index + 1001),
        floatHours: "688",
      })),
      { id: "1011", floatHours: "2400" },
    ],
  }),
);

const resultsByName: Readonly<Record<string, Analysis>> = {
  "broken-rows.xer": fixture,
  "notes.txt": notAnXer,
  "no-float.xer": noFloat,
  "long-tail.xer": longTail,
  "may.xer": update("May update", {
    dataDate: "2026-05-01",
    scheduledFinish: "2027-03-01",
    mustFinishBy: "2027-02-01",
  }),
  "june.xer": update("June update", {
    dataDate: "2026-06-01",
    scheduledFinish: "2027-03-15",
    mustFinishBy: "2027-02-01",
  }),
  "july.xer": update("July update", {
    dataDate: "2026-07-01",
    scheduledFinish: null,
    mustFinishBy: null,
  }),
  "august.xer": update("August update", {
    dataDate: "2026-08-01",
    scheduledFinish: "2027-04-01",
    mustFinishBy: "2027-02-01",
  }),
};

function stored(fileName: string, result: Analysis): StoredFile {
  return {
    id: `id-${fileName}`,
    fileName,
    result,
  };
}

function fakeApi(overrides: Partial<CheckerApi> = {}): CheckerApi {
  return {
    uploadFile: vi.fn(async (file: File) => {
      const result = resultsByName[file.name];
      if (result === undefined) {
        throw new Error(`No result for ${file.name}`);
      }
      return stored(file.name, result);
    }),
    openFile: vi.fn(async (id: string) => {
      throw new RequestError(`No file ${id}`, 404);
    }),
    enterHoursPerDay: vi.fn(async () => {
      throw new RequestError("No hours", 500);
    }),
    checkSampleFiles: vi.fn(async () => [
      stored("dukhan-ph9-update-06.xer", fixture),
      stored("dukhan-ph9-update-12.xer", notAnXer),
    ]),
    compareFiles: vi.fn(() => new Promise<Comparison>(() => {})),
    ...overrides,
  };
}

async function renderApp(api: CheckerApi = fakeApi()) {
  await act(async () => {
    render(<App api={api} />);
  });
  return api;
}

async function pickFiles(...names: string[]) {
  const files = names.map((name) => new File(["ERMHDR"], name));
  fireEvent.change(await screen.findByLabelText("Choose .xer files"), {
    target: { files },
  });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FixedWidthObserver);
});

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
});

describe("start page", () => {
  test("opens on the upload form, with the sample files to check or download", async () => {
    await renderApp();

    expect(screen.getByLabelText("Choose .xer files")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check the sample files" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Month 6 update" }).getAttribute("href")).toBe(
      "/samples/dukhan-ph9-update-06.xer",
    );
    expect(screen.getByRole("link", { name: "Month 12 update" }).getAttribute("href")).toBe(
      "/samples/dukhan-ph9-update-12.xer",
    );
  });

  test("checks the sample files on the server", async () => {
    const api = await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Check the sample files" }));

    expect(await screen.findByRole("columnheader", { name: /dukhan-ph9-update-06/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /dukhan-ph9-update-12/ })).toBeTruthy();
    expect(api.checkSampleFiles).toHaveBeenCalledOnce();
  });

  test("says why the sample files could not be checked", async () => {
    await renderApp(
      fakeApi({
        checkSampleFiles: vi.fn(async () => {
          throw new RequestError("The server could not be reached.", null);
        }),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Check the sample files" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The sample files could not be checked. The server could not be reached.",
    );
  });

  test("asks for fewer files when more than 3 are picked", async () => {
    const api = await renderApp();
    await pickFiles("a.xer", "b.xer", "c.xer", "d.xer");

    expect(screen.getByRole("alert").textContent).toBe("Choose up to 3 files at a time.");
    expect(api.uploadFile).not.toHaveBeenCalled();
  });

  test("ignores a drop that has no files in it", async () => {
    const api = await renderApp();
    fireEvent.drop(screen.getByRole("region", { name: "Upload" }), {
      dataTransfer: { files: [] },
    });

    expect(screen.getByLabelText("Choose .xer files")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(api.uploadFile).not.toHaveBeenCalled();
  });
});

describe("uploading", () => {
  test("shows each uploaded file's results in its own column", async () => {
    await renderApp();
    await pickFiles("broken-rows.xer", "notes.txt");
    const highFloat = await screen.findByRole("row", { name: /^High float/ });

    expect(within(highFloat).getByText("22.2%")).toBeTruthy();
    expect(within(highFloat).getByText("4 left out")).toBeTruthy();
    expect(
      screen.getByText(
        "This is not a P6 XER export. The first line of an XER file starts with ERMHDR.",
      ),
    ).toBeTruthy();
  });

  test("puts the stored files in the page address, so the results can be opened again", async () => {
    await renderApp();
    await pickFiles("broken-rows.xer", "notes.txt");
    await screen.findByRole("row", { name: /^High float/ });

    expect(new URLSearchParams(location.search).get("files")).toBe(
      "id-broken-rows.xer,id-notes.txt",
    );
  });

  test("shows the reason when an upload fails", async () => {
    await renderApp(
      fakeApi({
        uploadFile: vi.fn(async () => {
          throw new RequestError("This file is larger than the 100 MB limit.", 413);
        }),
      }),
    );
    await pickFiles("big.xer");

    expect(await screen.findByText("This file is larger than the 100 MB limit.")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "big.xer" })).toBeTruthy();
  });

  test("does not upload a file over the size limit", async () => {
    const api = await renderApp();
    const large = new File(["ERMHDR"], "large.xer");
    Object.defineProperty(large, "size", { value: 101 * BYTES_PER_MEGABYTE });
    fireEvent.change(screen.getByLabelText("Choose .xer files"), { target: { files: [large] } });

    expect(
      await screen.findByText("This file is 101 MB. The checker reads files up to 100 MB."),
    ).toBeTruthy();
    expect(api.uploadFile).not.toHaveBeenCalled();
  });

  test("stays on the upload form when Back is pressed before an upload finishes", async () => {
    let finishUpload = (_file: StoredFile) => {};
    const uploadFile = vi.fn(
      () =>
        new Promise<StoredFile>((resolve) => {
          finishUpload = resolve;
        }),
    );
    await renderApp(fakeApi({ uploadFile }));
    await pickFiles("broken-rows.xer");
    expect(screen.getByRole("status").textContent).toBe("Uploading and checking the file…");

    await act(async () => {
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await act(async () => {
      finishUpload(stored("broken-rows.xer", fixture));
    });

    expect(screen.getByLabelText("Choose .xer files")).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: /broken-rows\.xer/ })).toBeNull();
    expect(location.search).toBe("");
  });

  test("goes back to the upload form", async () => {
    await renderApp();
    await pickFiles("broken-rows.xer");
    fireEvent.click(await screen.findByRole("button", { name: "Check other files" }));

    expect(screen.getByLabelText("Choose .xer files")).toBeTruthy();
    expect(location.search).toBe("");
  });
});

describe("changes between updates", () => {
  const comparison = compareSchedules(
    scheduleFrom({
      tasks: [
        { id: "1", code: "A1", floatHours: "16" },
        { id: "2", code: "A2", floatHours: "16" },
      ],
      links: chain(["1", "2"]),
    }),
    scheduleFrom({
      tasks: [
        { id: "1", code: "A1", floatHours: "-8" },
        { id: "2", code: "A2", floatHours: "8" },
        { id: "3", code: "A3" },
      ],
      links: [{ predecessor: "1", successor: "2", type: "PR_FF", lagHours: "16" }],
    }),
  );

  test("compares two checked files and writes the review", async () => {
    const api = await renderApp(fakeApi({ compareFiles: vi.fn(async () => comparison) }));
    await pickFiles("broken-rows.xer", "no-float.xer");
    const review = await screen.findByRole("region", {
      name: "What changed since broken-rows.xer",
    });

    expect(api.compareFiles).toHaveBeenCalledWith("id-broken-rows.xer", "id-no-float.xer");
    expect(
      await within(review).findByText(
        "No activities were completed and none were started. 1 activity was added and none were removed.",
      ),
    ).toBeTruthy();
  });

  test("lists the activities that lost float, with their float before and after", async () => {
    await renderApp(fakeApi({ compareFiles: vi.fn(async () => comparison) }));
    await pickFiles("broken-rows.xer", "no-float.xer");
    const lists = await screen.findByRole("region", { name: "Activity lists" });
    fireEvent.click(await within(lists).findByRole("radio", { name: /^Lost float/ }));

    expect(within(lists).getByRole("row", { name: /^A1 Activity 1 2 −1 −3$/ })).toBeTruthy();
  });

  test("lists the relationships that changed, with their lag in hours", async () => {
    await renderApp(fakeApi({ compareFiles: vi.fn(async () => comparison) }));
    await pickFiles("broken-rows.xer", "no-float.xer");
    const lists = await screen.findByRole("region", { name: "Activity lists" });
    fireEvent.click(await within(lists).findByRole("radio", { name: /^Relationships/ }));

    expect(within(lists).getByRole("row", { name: "A1 A2 FS FF with 16 h lag" })).toBeTruthy();
  });

  test("says why the files could not be compared", async () => {
    await renderApp(
      fakeApi({
        compareFiles: vi.fn(async () => {
          throw new RequestError("Only files that were checked can be compared.", 409);
        }),
      }),
    );
    await pickFiles("broken-rows.xer", "no-float.xer");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The files could not be compared. Only files that were checked can be compared.",
    );
  });

  test("does not compare when only one file was checked", async () => {
    const api = await renderApp();
    await pickFiles("broken-rows.xer", "notes.txt");
    await screen.findByRole("row", { name: /^High float/ });

    expect(screen.queryByRole("region", { name: /^What changed since/ })).toBeNull();
    expect(api.compareFiles).not.toHaveBeenCalled();
  });
});

describe("opening a link", () => {
  test("opens the stored files named in the page address", async () => {
    history.replaceState(null, "", "/?files=id-broken-rows.xer");
    const api = await renderApp(
      fakeApi({ openFile: vi.fn(async () => stored("broken-rows.xer", fixture)) }),
    );

    expect(await screen.findByRole("columnheader", { name: /broken-rows\.xer/ })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "FIXTURE" })).toBeTruthy();
    expect(api.openFile).toHaveBeenCalledWith("id-broken-rows.xer");
  });

  test("says how many files in the link could not be opened", async () => {
    history.replaceState(null, "", "/?files=id-broken-rows.xer,id-gone");
    await renderApp(
      fakeApi({
        openFile: vi.fn(async (id: string) => {
          if (id === "id-gone") {
            throw new RequestError("There is no uploaded file with this ID.", 404);
          }
          return stored("broken-rows.xer", fixture);
        }),
      }),
    );

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not open 1 file in this link. There is no uploaded file with this ID.",
    );
    expect(screen.getByRole("columnheader", { name: /broken-rows\.xer/ })).toBeTruthy();
  });
});

describe("scheduled finish", () => {
  async function finishFacts() {
    const finish = await screen.findByRole("region", { name: "Scheduled finish" });
    return {
      date: finish.querySelector(".finish-date")?.textContent,
      facts: within(finish)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    };
  }

  test("shows the latest update's finish against the must finish by date and the update before", async () => {
    await renderApp();
    await pickFiles("june.xer", "may.xer");

    expect(await finishFacts()).toEqual({
      date: "15 Mar 2027",
      facts: ["42 days after the must finish by date.", "14 days later than in May update."],
    });
  });

  test("compares with the latest earlier update that has a finish", async () => {
    await renderApp();
    await pickFiles("may.xer", "july.xer", "august.xer");

    expect(await finishFacts()).toEqual({
      date: "1 Apr 2027",
      facts: ["59 days after the must finish by date.", "31 days later than in May update."],
    });
  });

  test("does not show another update's finish when the latest has none", async () => {
    await renderApp();
    await pickFiles("may.xer", "july.xer");
    await screen.findByRole("heading", { level: 1, name: "July update" });

    expect(screen.queryByRole("region", { name: "Scheduled finish" })).toBeNull();
  });
});

describe("results", () => {
  test("draws one float line for each file that was checked", async () => {
    await renderApp();
    await pickFiles("broken-rows.xer", "notes.txt");
    const chart = await screen.findByRole("slider", { name: "Total float chart" });

    expect(chart.querySelectorAll(".series-line")).toHaveLength(1);
  });

  test("labels the bar that holds the highest float instead of drawing a tick past it", async () => {
    await renderApp();
    await pickFiles("long-tail.xer");
    const chart = await screen.findByRole("slider", { name: "Total float chart" });
    const dayLabels = [...chart.querySelectorAll(".tick")]
      .map((tick) => tick.textContent ?? "")
      .filter((text) => !text.endsWith("%"));

    expect(dayLabels).toEqual(["0", "22", "44", "66", ">84"]);
  });

  test("leaves a file with no float values out of the chart", async () => {
    await renderApp();
    await pickFiles("broken-rows.xer", "no-float.xer");
    const chart = await screen.findByRole("slider", { name: "Total float chart" });

    expect(chart.querySelectorAll(".series-line")).toHaveLength(1);
    expect(screen.queryByRole("list", { name: "Files" })).toBeNull();
  });

  test("says how many activities were left out when a check has nothing to count", async () => {
    await renderApp();
    await pickFiles("no-float.xer");
    const negativeFloat = await screen.findByRole("row", { name: /^Negative float/ });
    const cell = within(negativeFloat).getByRole("button");

    expect(within(cell).getByText("Nothing to check")).toBeTruthy();
    expect(within(cell).getByText("2 left out")).toBeTruthy();
    fireEvent.click(cell);
    const details = screen.getByRole("region", { name: "Negative float in no-float.xer" });
    expect(
      within(details).getByText(
        "Nothing to check. 2 activities were left out. See Broken rows for details.",
      ),
    ).toBeTruthy();
  });

  test("opens on the first failing check of the latest file", async () => {
    await renderApp();
    await pickFiles("broken-rows.xer");
    const missingLinks = await screen.findByRole("row", { name: /^Missing links/ });

    expect(within(missingLinks).getByRole("button").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("region", { name: "Missing links in FIXTURE" })).toBeTruthy();
  });

  test("lists the activities a check flagged, by Activity ID", async () => {
    await renderApp();
    await pickFiles("broken-rows.xer");
    const highFloat = await screen.findByRole("row", { name: /^High float/ });
    fireEvent.click(within(highFloat).getByRole("button"));
    const details = screen.getByRole("region", { name: "High float in FIXTURE" });

    expect(
      within(details)
        .getAllByRole("rowheader")
        .map((cell) => cell.textContent),
    ).toEqual(["A1030", "A1040"]);
  });

  test("explains each broken row and what it did to the checks", async () => {
    await renderApp();
    await pickFiles("broken-rows.xer");
    const brokenRows = await screen.findByRole("row", { name: /^Broken rows/ });
    fireEvent.click(within(brokenRows).getByRole("button"));
    const row = screen.getByRole("row", { name: /^53 TASKPRED/ });

    expect(within(row).getByText("Predecessor 112 is the broken row on line 30.")).toBeTruthy();
    expect(within(row).getByText("Relationship not counted.")).toBeTruthy();
  });

  test("asks for the work hours in a day, then checks the stored file again", async () => {
    const enterHoursPerDay = vi.fn(async () => stored("old.xer", fixture));
    await renderApp(
      fakeApi({
        uploadFile: vi.fn(async () => stored("old.xer", { kind: "needs-hours-per-day", line: 7 })),
        enterHoursPerDay,
      }),
    );
    await pickFiles("old.xer");

    const hours = await screen.findByLabelText("Work hours in a day");
    expect(screen.getByText("Line 7")).toBeTruthy();
    fireEvent.change(hours, { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Check with this value" }));

    expect(await screen.findByRole("region", { name: "Activity lists" })).toBeTruthy();
    expect(enterHoursPerDay).toHaveBeenCalledWith("id-old.xer", 10);
  });

  test("keeps the hours question and says why when checking with the hours fails", async () => {
    await renderApp(
      fakeApi({
        uploadFile: vi.fn(async () => stored("old.xer", { kind: "needs-hours-per-day", line: 7 })),
      }),
    );
    await pickFiles("old.xer");
    fireEvent.click(await screen.findByRole("button", { name: "Check with this value" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "old.xer could not be checked with these hours. No hours",
    );
    expect(screen.getByLabelText("Work hours in a day")).toBeTruthy();
  });

  test("shows the stored results when the hours were already entered from another page", async () => {
    await renderApp(
      fakeApi({
        uploadFile: vi.fn(async () => stored("old.xer", { kind: "needs-hours-per-day", line: 7 })),
        enterHoursPerDay: vi.fn(async () => {
          throw new RequestError("This file already has the work hours in a day.", 409);
        }),
        openFile: vi.fn(async () => stored("old.xer", fixture)),
      }),
    );
    await pickFiles("old.xer");
    fireEvent.click(await screen.findByRole("button", { name: "Check with this value" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The work hours in a day were already entered for old.xer, so it shows the results checked with those hours.",
    );
    expect(screen.getByRole("region", { name: "Activity lists" })).toBeTruthy();
    expect(screen.queryByLabelText("Work hours in a day")).toBeNull();
  });
});
