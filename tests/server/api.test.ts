import { gzipSync } from "node:zlib";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { compareSchedules } from "../../src/core/compare.ts";
import { type AppOptions, createApp } from "../../src/server/app.ts";
import { FileStore } from "../../src/server/store.ts";
import { BYTES_PER_MEGABYTE, SAMPLE_FILES } from "../../src/shared/api.ts";
import { createTestDatabase, type TestDatabase } from "../support/database.ts";
import {
  analyzeXer,
  HEADER,
  parsedFile,
  repoFile,
  scheduleXer,
  TASK_COLUMNS,
  type XerLine,
  xerBytes,
} from "../support/xer.ts";

const oldExport = xerBytes([
  HEADER,
  ["%T", "CALENDAR"],
  ["%F", "clndr_id", "clndr_name"],
  ["%R", "1", "Standard"],
  ["%T", "TASK"],
  TASK_COLUMNS,
  ["%R", "1", "1", "1", "A1", "Excavation", "TT_Task", "TK_NotStart", "500"],
  ["%R", "2", "1", "1", "A2", "Backfill", "TT_Task", "TK_NotStart", "-40"],
  ["%E"],
]);

let testDatabase: TestDatabase;
let app: Hono;

beforeAll(async () => {
  testDatabase = await createTestDatabase();
  app = appWith();
});

afterAll(async () => {
  await testDatabase.close();
});

function appWith(options: Partial<AppOptions> = {}): Hono {
  return createApp({ store: new FileStore(testDatabase.database), ...options });
}

async function upload(
  bytes: Uint8Array,
  fileName = "schedule.xer",
  target = app,
): Promise<Response> {
  const form = new FormData();
  form.append("file", new File([bytes.slice()], fileName));
  return target.request("/api/files", { method: "POST", body: form });
}

async function enterHours(id: string, body: unknown): Promise<Response> {
  return app.request(`/api/files/${id}/hours-per-day`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function uploadedId(bytes: Uint8Array): Promise<string> {
  const { id } = await (await upload(bytes)).json();
  return id;
}

describe("uploading a file", () => {
  test("stores it and returns the same results as checking it in memory", async () => {
    const bytes = repoFile("tests/fixtures/broken-rows.xer");
    const response = await upload(bytes, "broken-rows.xer");
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("Location")).toBe(`/api/files/${body.id}`);
    expect(body).toMatchObject({ fileName: "broken-rows.xer", result: analyzeXer(bytes) });
  });

  test("returns the stored results when the file is opened again", async () => {
    const uploaded = await upload(repoFile("tests/fixtures/broken-rows.xer"));
    const opened = await app.request(uploaded.headers.get("Location") ?? "");

    expect(opened.status).toBe(200);
    expect(await opened.json()).toEqual(await uploaded.json());
  });

  test.each(SAMPLE_FILES)("reads back $fileName exactly as it was checked", async (sample) => {
    const bytes = repoFile(`data/${sample.fileName}`);
    const id = await uploadedId(bytes);
    const opened = await app.request(`/api/files/${id}`);

    expect((await opened.json()).result).toEqual(analyzeXer(bytes));
  });

  test("stores a file that is not an XER export, with the reason it was not checked", async () => {
    const id = await uploadedId(new TextEncoder().encode("meeting notes\n"));
    const opened = await app.request(`/api/files/${id}`);

    expect((await opened.json()).result).toEqual({
      kind: "rejected",
      reason: "This is not a P6 XER export. The first line of an XER file starts with ERMHDR.",
      line: 1,
    });
  });

  test("stores a NUL character in a value as U+FFFD, because Postgres text cannot hold it", async () => {
    const bytes = xerBytes([
      HEADER,
      ["%T", "CALENDAR"],
      ["%F", "clndr_id", "clndr_name", "day_hr_cnt"],
      ["%R", "1", "Standard", "8"],
      ["%T", "TASK"],
      TASK_COLUMNS,
      ["%R", "1", "1", "1", "A1", "Pump\u0000house", "TT_Task", "TK_NotStart", "-8"],
      ["%E"],
    ]);
    const id = await uploadedId(bytes);
    const { result } = await (await app.request(`/api/files/${id}`)).json();

    expect(result.checks.negativeFloat.findings[0].activity.name).toBe("Pump�house");
    expect(result.broken[0].problems).toEqual([{ kind: "damaged-text", codePoints: [0] }]);
  });

  test("rejects a request with no file", async () => {
    const response = await app.request("/api/files", { method: "POST", body: new FormData() });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "The request has no file. Send the .xer file in a form field named file.",
    });
  });

  test("accepts a file exactly at the size limit", async () => {
    const small = appWith({ maxUploadBytes: BYTES_PER_MEGABYTE });
    const response = await upload(new Uint8Array(BYTES_PER_MEGABYTE), "limit.xer", small);

    expect(response.status).toBe(201);
  });

  test("rejects a file one byte over the size limit", async () => {
    const small = appWith({ maxUploadBytes: BYTES_PER_MEGABYTE });
    const response = await upload(new Uint8Array(BYTES_PER_MEGABYTE + 1), "large.xer", small);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "This file is larger than the 1 MB limit." });
  });

  test("unzips a file the page compressed before uploading it", async () => {
    const bytes = repoFile("tests/fixtures/broken-rows.xer");
    const response = await upload(gzipSync(bytes), "broken-rows.xer");

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      fileName: "broken-rows.xer",
      result: analyzeXer(bytes),
    });
  });

  test("accepts a compressed file that unzips to exactly the size limit", async () => {
    const small = appWith({ maxUploadBytes: BYTES_PER_MEGABYTE });
    const compressed = gzipSync(new Uint8Array(BYTES_PER_MEGABYTE));
    const response = await upload(compressed, "limit.xer", small);

    expect(response.status).toBe(201);
  });

  test("rejects a compressed file that unzips to more than the size limit", async () => {
    const small = appWith({ maxUploadBytes: BYTES_PER_MEGABYTE });
    const compressed = gzipSync(new Uint8Array(BYTES_PER_MEGABYTE + 1));
    const response = await upload(compressed, "large.xer", small);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "This file is larger than the 1 MB limit." });
  });

  test("rejects a file far over the size limit before reading all of it", async () => {
    const small = appWith({ maxUploadBytes: BYTES_PER_MEGABYTE });
    const response = await upload(new Uint8Array(2 * BYTES_PER_MEGABYTE), "large.xer", small);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "This file is larger than the 1 MB limit." });
  });

  test("stores a file with more than 10,000 broken rows as rejected", async () => {
    const strayLines = Array.from({ length: 10_001 }, (): XerLine => ["x"]);
    const bytes = xerBytes([HEADER, ["%T", "TASK"], TASK_COLUMNS, ...strayLines, ["%E"]]);
    const id = await uploadedId(bytes);
    const opened = await app.request(`/api/files/${id}`);

    expect((await opened.json()).result).toEqual({
      kind: "rejected",
      reason:
        "This file has more than 10,000 broken rows, so it is too damaged to check. Export it from P6 again.",
      line: 10_004,
    });
  });
});

describe("opening a stored file", () => {
  test.each([
    ["an ID that was never issued", "1b4e28ba-2fa1-41d2-883f-0016d3cca427"],
    ["text that is not an ID", "not-an-id"],
  ])("says there is no such file for %s", async (_name, id) => {
    const response = await app.request(`/api/files/${id}`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "There is no uploaded file with this ID." });
  });
});

describe("entering the work hours in a day", () => {
  test("checks a stored file again with the hours entered", async () => {
    const id = await uploadedId(oldExport);
    expect((await (await app.request(`/api/files/${id}`)).json()).result).toEqual({
      kind: "needs-hours-per-day",
      line: 2,
    });

    const response = await enterHours(id, { hoursPerDay: 10 });
    const opened = await app.request(`/api/files/${id}`);

    expect(response.status).toBe(200);
    expect((await response.json()).result).toEqual(analyzeXer(oldExport, 10));
    expect((await opened.json()).result).toEqual(analyzeXer(oldExport, 10));
  });

  test.each([
    ["zero", { hoursPerDay: 0 }],
    ["less than 1", { hoursPerDay: 0.5 }],
    ["more than 24", { hoursPerDay: 25 }],
    ["a string", { hoursPerDay: "8" }],
    ["missing", {}],
  ])("rejects hours that are %s", async (_name, body) => {
    const id = await uploadedId(oldExport);
    const response = await enterHours(id, body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "hoursPerDay must be a number from 1 to 24.",
    });
  });

  test("rejects a request body over 1 KB", async () => {
    const id = await uploadedId(oldExport);
    const response = await enterHours(id, { hoursPerDay: 8, padding: "x".repeat(2048) });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "The request body is larger than 1 KB." });
  });

  test("accepts only the first of several hours sent at the same time", async () => {
    const id = await uploadedId(oldExport);
    const responses = await Promise.all(
      [8, 9, 10].map((hours) => enterHours(id, { hoursPerDay: hours })),
    );
    const statuses = responses.map((response) => response.status).sort();
    const winner = responses.find((response) => response.status === 200);
    const opened = await (await app.request(`/api/files/${id}`)).json();

    expect(statuses).toEqual([200, 409, 409]);
    expect(opened).toEqual(await winner?.json());
  });

  test("refuses hours for a file that has its own", async () => {
    const id = await uploadedId(repoFile("tests/fixtures/broken-rows.xer"));
    const response = await enterHours(id, { hoursPerDay: 8 });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "This file already has the work hours in a day.",
    });
  });

  test("says there is no such file for an unknown ID", async () => {
    const response = await enterHours("1b4e28ba-2fa1-41d2-883f-0016d3cca427", { hoursPerDay: 8 });

    expect(response.status).toBe(404);
  });
});

describe("comparing two stored files", () => {
  const month1 = scheduleXer({
    tasks: [
      { id: "1", code: "A1", floatHours: "16" },
      { id: "2", code: "A2", floatHours: "8" },
    ],
    links: [{ predecessor: "1", successor: "2" }],
  });
  const month2 = scheduleXer({
    tasks: [
      { id: "11", code: "A1", status: "TK_Complete" },
      { id: "12", code: "A2", floatHours: "-8" },
      { id: "13", code: "A3", floatHours: "0" },
    ],
    links: [
      { predecessor: "11", successor: "12", type: "PR_SS" },
      { predecessor: "12", successor: "13" },
    ],
  });

  async function compare(from: string, to: string): Promise<Response> {
    return app.request(`/api/comparison?${new URLSearchParams({ from, to })}`);
  }

  test("returns the same comparison as comparing the files in memory", async () => {
    const response = await compare(await uploadedId(month1), await uploadedId(month2));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(compareSchedules(parsedFile(month1), parsedFile(month2)));
  });

  test("says there is no such file for an unknown ID", async () => {
    const response = await compare(
      await uploadedId(month1),
      "1b4e28ba-2fa1-41d2-883f-0016d3cca427",
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "There is no uploaded file with this ID." });
  });

  test("refuses a file that was not checked", async () => {
    const response = await compare(await uploadedId(month1), await uploadedId(oldExport));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Only files that were checked can be compared.",
    });
  });

  test("asks for two different files", async () => {
    const id = await uploadedId(month1);
    const response = await compare(id, id);

    expect(response.status).toBe(400);
  });
});

describe("files stored by an older version of the reader", () => {
  const withProjectDates = xerBytes([
    HEADER,
    ["%T", "PROJECT"],
    ["%F", "proj_id", "proj_short_name", "last_recalc_date", "scd_end_date", "plan_end_date"],
    ["%R", "1", "Tower", "2026-10-31 00:00", "2027-06-30 17:00", "2027-05-31 17:00"],
    ["%T", "CALENDAR"],
    ["%F", "clndr_id", "clndr_name", "day_hr_cnt"],
    ["%R", "1", "Standard", "8"],
    ["%T", "TASK"],
    TASK_COLUMNS,
    ["%R", "1", "1", "1", "A1", "Excavation", "TT_Task", "TK_Active", "-16"],
    ["%E"],
  ]);

  async function makeReadingOld(id: string): Promise<void> {
    const { database } = testDatabase;
    await database.query("update file_reading set reader_version = 1 where file_id = $1", [id]);
    await database.query(
      "update project set scheduled_finish = null, must_finish_by = null where file_id = $1",
      [id],
    );
    await database.query("update activity set status = null where file_id = $1", [id]);
  }

  test("reads the stored file again before opening it", async () => {
    const id = await uploadedId(withProjectDates);
    await makeReadingOld(id);

    const opened = await (await app.request(`/api/files/${id}`)).json();
    const { rows } = await testDatabase.database.query(
      "select reader_version from file_reading where file_id = $1",
      [id],
    );

    expect(opened.result).toEqual(analyzeXer(withProjectDates));
    expect(opened.result.facts.projects[0]).toMatchObject({ scheduledFinish: "2027-06-30" });
    expect(rows).toEqual([{ reader_version: 2 }]);
  });

  test("keeps the work hours entered for it", async () => {
    const id = await uploadedId(oldExport);
    expect((await enterHours(id, { hoursPerDay: 10 })).status).toBe(200);
    await makeReadingOld(id);

    const opened = await (await app.request(`/api/files/${id}`)).json();

    expect(opened.result).toEqual(analyzeXer(oldExport, 10));
  });
});

describe("sample files", () => {
  test("checks both sample files and reuses them on the next request", async () => {
    const first = await (await app.request("/api/samples", { method: "POST" })).json();
    const second = await (await app.request("/api/samples", { method: "POST" })).json();

    expect(
      first.files.map((file: { fileName: string; result: { facts: object } }) => [
        file.fileName,
        file.result.facts,
      ]),
    ).toEqual([
      ["dukhan-ph9-update-06.xer", expect.objectContaining({ checkedActivityCount: 5058 })],
      ["dukhan-ph9-update-12.xer", expect.objectContaining({ checkedActivityCount: 4333 })],
    ]);
    expect(second.files.map((file: { id: string }) => file.id)).toEqual(
      first.files.map((file: { id: string }) => file.id),
    );
  });

  test("serves each sample file as a download", async () => {
    const response = await app.request("/samples/dukhan-ph9-update-06.xer");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="dukhan-ph9-update-06.xer"',
    );
    const download = Buffer.from(await response.arrayBuffer());
    expect(download.equals(repoFile("data/dukhan-ph9-update-06.xer"))).toBe(true);
  });

  test("has no download for other names", async () => {
    expect((await app.request("/samples/SOURCES.md")).status).toBe(404);
  });
});

test("answers an unknown API path with a JSON error", async () => {
  const response = await app.request("/api/projects");

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "There is no API endpoint at this path." });
});
