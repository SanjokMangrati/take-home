import type { Comparison } from "../core/compare.ts";
import {
  type HoursPerDayRequest,
  MAX_UPLOAD_MEGABYTES,
  type SampleFilesResponse,
  type StoredFile,
} from "../shared/api.ts";
import { type ErrorResponse, SERVER_ERROR } from "../shared/errors.ts";

const SERVER_UNREACHABLE = "The server could not be reached. Check your connection and try again.";
const SERVER_BUSY = "The checker is busy or starting up. Try again in a minute.";

const STATUS_MESSAGES: Readonly<Record<number, string>> = {
  413: `This file is larger than the ${MAX_UPLOAD_MEGABYTES} MB limit.`,
  429: "Too many requests from this address. Wait a minute and try again.",
  502: SERVER_BUSY,
  503: SERVER_BUSY,
  504: SERVER_BUSY,
};

export const CONFLICT = 409;

export class RequestError extends Error {
  override readonly name = "RequestError";
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.status = status;
  }
}

export interface CheckerApi {
  readonly uploadFile: (file: File) => Promise<StoredFile>;
  readonly openFile: (id: string) => Promise<StoredFile>;
  readonly enterHoursPerDay: (id: string, hoursPerDay: number) => Promise<StoredFile>;
  readonly checkSampleFiles: () => Promise<readonly StoredFile[]>;
  readonly compareFiles: (fromId: string, toId: string) => Promise<Comparison>;
}

export const serverApi: CheckerApi = {
  uploadFile: async (file) => {
    const form = new FormData();
    form.append("file", await gzipped(file), file.name);
    return send<StoredFile>("/api/files", { method: "POST", body: form });
  },
  openFile: (id) => send<StoredFile>(`/api/files/${encodeURIComponent(id)}`),
  enterHoursPerDay: (id, hoursPerDay) => {
    const body: HoursPerDayRequest = { hoursPerDay };
    return send<StoredFile>(`/api/files/${encodeURIComponent(id)}/hours-per-day`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  checkSampleFiles: async () =>
    (await send<SampleFilesResponse>("/api/samples", { method: "POST" })).files,
  compareFiles: (fromId, toId) =>
    send<Comparison>(`/api/comparison?${new URLSearchParams({ from: fromId, to: toId })}`),
};

export function reasonOf(error: unknown): string {
  return error instanceof RequestError ? error.message : SERVER_ERROR;
}

function gzipped(file: File): Promise<Blob> {
  return new Response(file.stream().pipeThrough(new CompressionStream("gzip"))).blob();
}

async function send<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, init).catch(() => {
    throw new RequestError(SERVER_UNREACHABLE, null);
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || body === null) {
    const message = isErrorResponse(body)
      ? body.error
      : (STATUS_MESSAGES[response.status] ?? SERVER_ERROR);
    throw new RequestError(message, response.status);
  }
  return body as T;
}

function isErrorResponse(body: unknown): body is ErrorResponse {
  return (
    typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
  );
}
