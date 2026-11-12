import type { Analysis, CheckedAnalysis } from "../core/analyze.ts";
import type { Project } from "../core/xer/schedule.ts";
import type { StoredFile } from "../shared/api.ts";

export type SeriesSlot = 1 | 2 | 3;

const SERIES_SLOTS: readonly SeriesSlot[] = [1, 2, 3];

export const MAX_FILES = SERIES_SLOTS.length;

export interface UnreadableFile {
  readonly kind: "unreadable";
  readonly reason: string;
}

export type FileResult = Analysis | UnreadableFile;

export interface LoadedFile {
  readonly key: string;
  readonly id: string | null;
  readonly fileName: string;
  readonly label: string;
  readonly slot: SeriesSlot;
  readonly result: FileResult;
}

export interface CheckedFile extends LoadedFile {
  readonly result: CheckedAnalysis;
}

export function isChecked(file: LoadedFile): file is CheckedFile {
  return file.result.kind === "checked";
}

function slotAt(position: number): SeriesSlot {
  return SERIES_SLOTS[position % SERIES_SLOTS.length] ?? 1;
}

const SLOTS_BY_COUNT: Readonly<Record<number, readonly SeriesSlot[]>> = {
  1: [2],
  2: [1, 2],
  3: [1, 3, 2],
};

export function arrangeFiles(files: readonly LoadedFile[]): LoadedFile[] {
  const checked = inDataDateOrder(files.filter(isChecked));
  const unchecked = files.filter((file) => !isChecked(file));
  const slots = SLOTS_BY_COUNT[checked.length] ?? SERIES_SLOTS;
  const projectNames = checked.map((file) => onlyProject(file)?.name.trim() ?? "");
  const useProjectNames = projectNames.every(
    (name, index) => name !== "" && projectNames.indexOf(name) === index,
  );
  return [
    ...checked.map((file, index) => ({
      ...file,
      slot: slots[index] ?? slotAt(index),
      label: useProjectNames ? (projectNames[index] ?? file.fileName) : file.fileName,
    })),
    ...unchecked,
  ];
}

export function inDataDateOrder<File extends CheckedFile>(files: readonly File[]): readonly File[] {
  const dated = files.every((file) => dataDateOf(file) !== null);
  return dated
    ? files.toSorted((a, b) => (dataDateOf(a) ?? "").localeCompare(dataDateOf(b) ?? ""))
    : files;
}

export function onlyProject(file: CheckedFile): Project | null {
  const { projects } = file.result.facts;
  return projects.length === 1 ? (projects[0] ?? null) : null;
}

export function dataDateOf(file: CheckedFile): string | null {
  return onlyProject(file)?.dataDate ?? null;
}

export function storedFile({ id, fileName, result }: StoredFile, position: number): LoadedFile {
  return { key: id, id, fileName, label: fileName, slot: slotAt(position), result };
}

export function unsavedFile(fileName: string, position: number, reason: string): LoadedFile {
  return {
    key: `unsaved-${position}`,
    id: null,
    fileName,
    label: fileName,
    slot: slotAt(position),
    result: { kind: "unreadable", reason },
  };
}
