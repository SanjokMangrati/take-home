import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { COMPRESSIBLE_CONTENT_TYPE_REGEX, compress } from "hono/compress";
import { HTTPException } from "hono/http-exception";
import { compareSchedules } from "../core/compare.ts";
import { isHoursPerDayInRange, MAX_HOURS_PER_DAY } from "../core/xer/schedule.ts";
import {
  BYTES_PER_MEGABYTE,
  MAX_UPLOAD_BYTES,
  MIN_ENTERED_HOURS_PER_DAY,
  SAMPLE_FILES,
  type SampleFilesResponse,
  type StoredFile,
} from "../shared/api.ts";
import { SERVER_ERROR } from "../shared/errors.ts";
import { fail, IMMUTABLE, securityHeaders } from "./http.ts";
import { ParserStoppedError, parseInWorker } from "./parse.ts";
import type { FileStore, ReadingState, Upload } from "./store.ts";

export interface AppOptions {
  readonly store: FileStore;
  readonly maxUploadBytes?: number;
  readonly clientDirectory?: string | null;
}

const SAMPLES_DIRECTORY = new URL("../../data/", import.meta.url);
const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const XER_CONTENT_TYPE = "application/octet-stream";
const SAMPLE_CACHE = "public, max-age=86400";
const MULTIPART_ENVELOPE_BYTES = 64 * 1024;
const MAX_JSON_BODY_BYTES = 1024;
const GZIP_SIGNATURE = [0x1f, 0x8b];

const gunzipAsync = promisify(gunzip);

const NO_SUCH_FILE = "There is no uploaded file with this ID.";
const ALREADY_HAS_HOURS = "This file already has the work hours in a day.";
const NOT_COMPARABLE = "Only files that were checked can be compared.";
const PARSER_STOPPED = "The checker stopped while reading this file. Try again.";

export function createApp({
  store,
  maxUploadBytes = MAX_UPLOAD_BYTES,
  clientDirectory = null,
}: AppOptions): Hono {
  async function storedFile(id: string): Promise<StoredFile> {
    const file = await store.find(id);
    if (file === null) {
      throw new Error(`File ${id} was saved but could not be read back.`);
    }
    return file;
  }

  async function addUpload(upload: Upload): Promise<string> {
    const reading = await parseInWorker({ bytes: upload.content, hoursPerDay: null });
    return store.add(upload, reading);
  }

  async function currentReading(id: string): Promise<ReadingState | null> {
    if (!FILE_ID.test(id)) {
      return null;
    }
    const state = await store.findReadingState(id);
    if (state === null || state.current) {
      return state;
    }
    const upload = await store.findUpload(id);
    if (upload === null) {
      return null;
    }
    const reading = await parseInWorker({ bytes: upload.content, hoursPerDay: state.hoursPerDay });
    await store.replaceOutdatedReading(id, reading, state.hoursPerDay);
    return { ...state, outcome: reading.kind, current: true };
  }

  async function openFile(id: string): Promise<StoredFile | null> {
    return (await currentReading(id)) === null ? null : store.find(id);
  }

  const tooLarge = (c: Context) =>
    fail(c, 413, `This file is larger than the ${formatMegabytes(maxUploadBytes)} MB limit.`);

  const api = new Hono();

  api.post(
    "/files",
    bodyLimit({ maxSize: maxUploadBytes + MULTIPART_ENVELOPE_BYTES, onError: tooLarge }),
    async (c) => {
      const body = await c.req.parseBody().catch(() => null);
      const file = body?.["file"];
      if (!(file instanceof File)) {
        return fail(
          c,
          400,
          "The request has no file. Send the .xer file in a form field named file.",
        );
      }
      if (file.size > maxUploadBytes) {
        return tooLarge(c);
      }
      const fileName = file.name.trim();
      if (fileName === "") {
        return fail(c, 400, "The uploaded file has no name.");
      }
      const content = await unzipped(new Uint8Array(await file.arrayBuffer()), maxUploadBytes);
      if (content === null) {
        return tooLarge(c);
      }
      const id = await addUpload({ fileName, content });
      c.header("Location", `/api/files/${id}`);
      return c.json(await storedFile(id), 201);
    },
  );

  api.get("/files/:id", async (c) => {
    const file = await openFile(c.req.param("id"));
    return file === null ? fail(c, 404, NO_SUCH_FILE) : c.json(file);
  });

  api.get("/comparison", async (c) => {
    const from = c.req.query("from") ?? "";
    const to = c.req.query("to") ?? "";
    if (from === to) {
      return fail(c, 400, "Give the IDs of two different uploaded files as from and to.");
    }
    const [fromState, toState] = await Promise.all([currentReading(from), currentReading(to)]);
    if (fromState === null || toState === null) {
      return fail(c, 404, NO_SUCH_FILE);
    }
    if (fromState.outcome !== "parsed" || toState.outcome !== "parsed") {
      return fail(c, 409, NOT_COMPARABLE);
    }
    const [before, after] = await Promise.all([store.findSchedule(from), store.findSchedule(to)]);
    if (before === null || after === null) {
      return fail(c, 409, NOT_COMPARABLE);
    }
    return c.json(compareSchedules(before, after));
  });

  api.put(
    "/files/:id/hours-per-day",
    bodyLimit({
      maxSize: MAX_JSON_BODY_BYTES,
      onError: (c) =>
        fail(c, 413, `The request body is larger than ${MAX_JSON_BODY_BYTES / 1024} KB.`),
    }),
    async (c) => {
      const hoursPerDay = hoursPerDayIn(await c.req.json<unknown>().catch(() => null));
      if (hoursPerDay === null) {
        return fail(
          c,
          400,
          `hoursPerDay must be a number from ${MIN_ENTERED_HOURS_PER_DAY} to ${MAX_HOURS_PER_DAY}.`,
        );
      }
      const id = c.req.param("id");
      const state = await currentReading(id);
      if (state === null) {
        return fail(c, 404, NO_SUCH_FILE);
      }
      if (state.outcome !== "needs-hours-per-day") {
        return fail(c, 409, ALREADY_HAS_HOURS);
      }
      const upload = await store.findUpload(id);
      if (upload === null) {
        return fail(c, 404, NO_SUCH_FILE);
      }
      const reading = await parseInWorker({ bytes: upload.content, hoursPerDay });
      if (!(await store.replaceReadingThatNeedsHours(id, reading, hoursPerDay))) {
        return fail(c, 409, ALREADY_HAS_HOURS);
      }
      return c.json(await storedFile(id));
    },
  );

  async function sampleFile(fileName: string): Promise<StoredFile> {
    const upload = { fileName, content: await readSample(fileName) };
    const id = (await store.findIdByContent(upload)) ?? (await addUpload(upload));
    await currentReading(id);
    return storedFile(id);
  }

  api.post("/samples", async (c) => {
    const files = await Promise.all(SAMPLE_FILES.map(({ fileName }) => sampleFile(fileName)));
    const body: SampleFilesResponse = { files };
    return c.json(body);
  });

  const app = new Hono();
  app.use(securityHeaders());
  app.use(
    compress({
      contentTypeFilter: (type) =>
        COMPRESSIBLE_CONTENT_TYPE_REGEX.test(type) || type === XER_CONTENT_TYPE,
    }),
  );
  app.route("/api", api);
  app.all("/api/*", (c) => fail(c, 404, "There is no API endpoint at this path."));

  app.get("/samples/:fileName", async (c) => {
    const sample = SAMPLE_FILES.find(({ fileName }) => fileName === c.req.param("fileName"));
    if (sample === undefined) {
      return c.notFound();
    }
    return c.body(await readSample(sample.fileName), 200, {
      "Content-Type": XER_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${sample.fileName}"`,
      "Cache-Control": SAMPLE_CACHE,
    });
  });

  if (clientDirectory !== null) {
    app.use(
      "*",
      serveStatic({
        root: clientDirectory,
        onFound: (path, c) => {
          c.header("Cache-Control", path.includes("/assets/") ? IMMUTABLE : "no-cache");
        },
      }),
    );
  }

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return fail(c, error.status, error.message || SERVER_ERROR);
    }
    console.error(error);
    return fail(c, 500, error instanceof ParserStoppedError ? PARSER_STOPPED : SERVER_ERROR);
  });

  return app;
}

function hoursPerDayIn(body: unknown): number | null {
  if (typeof body !== "object" || body === null || !("hoursPerDay" in body)) {
    return null;
  }
  const { hoursPerDay } = body;
  return typeof hoursPerDay === "number" &&
    hoursPerDay >= MIN_ENTERED_HOURS_PER_DAY &&
    isHoursPerDayInRange(hoursPerDay)
    ? hoursPerDay
    : null;
}

async function unzipped(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array | null> {
  if (!GZIP_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return bytes;
  }
  try {
    return await gunzipAsync(bytes, { maxOutputLength: maxBytes });
  } catch (error) {
    return error instanceof RangeError ? null : bytes;
  }
}

function readSample(fileName: string): Promise<Uint8Array<ArrayBuffer>> {
  return readFile(new URL(fileName, SAMPLES_DIRECTORY));
}

function formatMegabytes(bytes: number): string {
  return String(Math.round(bytes / BYTES_PER_MEGABYTE));
}
