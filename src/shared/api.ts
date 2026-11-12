import type { Analysis } from "../core/analyze.ts";

export const MAX_UPLOAD_MEGABYTES = 100;

export const BYTES_PER_MEGABYTE = 1024 * 1024;

export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MEGABYTES * BYTES_PER_MEGABYTE;

export const MIN_ENTERED_HOURS_PER_DAY = 1;

export interface StoredFile {
  readonly id: string;
  readonly fileName: string;
  readonly result: Analysis;
}

export interface SampleFilesResponse {
  readonly files: readonly StoredFile[];
}

export interface HoursPerDayRequest {
  readonly hoursPerDay: number;
}

interface SampleFile {
  readonly fileName: string;
  readonly label: string;
}

export const SAMPLE_FILES: readonly SampleFile[] = [
  { fileName: "dukhan-ph9-update-06.xer", label: "Month 6 update" },
  { fileName: "dukhan-ph9-update-12.xer", label: "Month 12 update" },
];

export const SAMPLE_SOURCE_URL =
  "https://github.com/Projecting-Success-Solutions-Portal/hack26-autoplan-wbs-generator/tree/49a889b2639c7db40c8828820d932e7877f3e0eb/Data/Extra%20Schedule%20Data";
