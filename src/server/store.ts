import { createHash } from "node:crypto";
import type { PoolClient, QueryConfig, QueryResultRow } from "pg";
import {
  type Analysis,
  checkSchedule,
  type Note,
  type ParsedSchedule,
  type ParseResult,
} from "../core/analyze.ts";
import type { BrokenRow } from "../core/xer/problems.ts";
import type { Activity, Link, Project } from "../core/xer/schedule.ts";
import type { StoredFile } from "../shared/api.ts";
import { type Database, inTransaction } from "./database.ts";

export interface Upload {
  readonly fileName: string;
  readonly content: Uint8Array;
}

interface Table<Row> {
  readonly name: string;
  readonly columns: readonly (readonly [column: string, field: keyof Row & string, type: string])[];
}

const PROJECT_TABLE: Table<Project> = {
  name: "project",
  columns: [
    ["line", "line", "integer"],
    ["project_id", "id", "text"],
    ["name", "name", "text"],
    ["data_date", "dataDate", "text"],
    ["scheduled_finish", "scheduledFinish", "text"],
    ["must_finish_by", "mustFinishBy", "text"],
  ],
};

const ACTIVITY_TABLE: Table<Activity> = {
  name: "activity",
  columns: [
    ["task_id", "id", "text"],
    ["line", "line", "integer"],
    ["project_id", "projectId", "text"],
    ["code", "code", "text"],
    ["name", "name", "text"],
    ["type", "type", "text"],
    ["status", "status", "text"],
    ["checked", "checked", "boolean"],
    ["calendar_id", "calendarId", "text"],
    ["total_float_hours", "totalFloatHours", "double precision"],
    ["hours_per_day", "hoursPerDay", "double precision"],
  ],
};

const RELATIONSHIP_TABLE: Table<Link> = {
  name: "relationship",
  columns: [
    ["line", "line", "integer"],
    ["predecessor_task_id", "predecessorId", "text"],
    ["successor_task_id", "successorId", "text"],
    ["type", "type", "text"],
    ["lag_hours", "lagHours", "double precision"],
  ],
};

const BROKEN_ROW_TABLE: Table<BrokenRow> = {
  name: "broken_row",
  columns: [
    ["line", "line", "integer"],
    ["table_name", "table", "text"],
    ["subject", "subject", "text"],
    ["problems", "problems", "jsonb"],
    ["effect", "effect", "jsonb"],
  ],
};

const READER_VERSION = 2;

type ResultRow<Row> = Row & QueryResultRow;

export interface ReadingState {
  readonly outcome: ParseResult["kind"];
  readonly current: boolean;
  readonly hoursPerDay: number | null;
}

interface FileRow {
  readonly id: string;
  readonly fileName: string;
}

type ReadingRow =
  | { readonly outcome: "parsed"; readonly p6Version: string; readonly notes: Note[] }
  | { readonly outcome: "rejected"; readonly reason: string; readonly line: number | null }
  | { readonly outcome: "needs-hours-per-day"; readonly line: number };

export class FileStore {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  add(upload: Upload, reading: ParseResult): Promise<string> {
    return inTransaction(this.#database, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "insert into uploaded_file (file_name, content, sha256) values ($1, $2, $3) returning id",
        [storable(upload.fileName), upload.content, sha256(upload.content)],
      );
      const id = rows[0]?.id;
      if (id === undefined) {
        throw new Error("Saving the upload returned no ID.");
      }
      await insertReading(client, id, reading, null);
      return id;
    });
  }

  replaceReadingThatNeedsHours(
    id: string,
    reading: ParseResult,
    hoursPerDay: number,
  ): Promise<boolean> {
    return this.#replaceReading(id, reading, hoursPerDay, {
      text: "delete from file_reading where file_id = $1 and outcome = 'needs-hours-per-day'",
      values: [id],
    });
  }

  replaceOutdatedReading(
    id: string,
    reading: ParseResult,
    hoursPerDay: number | null,
  ): Promise<boolean> {
    return this.#replaceReading(id, reading, hoursPerDay, {
      text: "delete from file_reading where file_id = $1 and reader_version < $2",
      values: [id, READER_VERSION],
    });
  }

  async findIdByContent(upload: Upload): Promise<string | null> {
    const { rows } = await this.#database.query<{ id: string }>(
      "select id from uploaded_file where sha256 = $1 and file_name = $2 order by uploaded_at limit 1",
      [sha256(upload.content), storable(upload.fileName)],
    );
    return rows[0]?.id ?? null;
  }

  async findReadingState(id: string): Promise<ReadingState | null> {
    const { rows } = await this.#database.query<
      ResultRow<Omit<ReadingState, "current"> & { readerVersion: number }>
    >(
      `select outcome, hours_per_day as "hoursPerDay", reader_version as "readerVersion"
       from file_reading where file_id = $1`,
      [id],
    );
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    return {
      outcome: row.outcome,
      current: row.readerVersion >= READER_VERSION,
      hoursPerDay: row.hoursPerDay,
    };
  }

  findSchedule(id: string): Promise<ParsedSchedule | null> {
    return inTransaction(
      this.#database,
      async (client) => {
        const { rows } = await client.query<ResultRow<{ p6Version: string; notes: Note[] }>>(
          `select p6_version as "p6Version", notes from file_reading
           where file_id = $1 and outcome = 'parsed'`,
          [id],
        );
        const row = rows[0];
        return row === undefined ? null : readSchedule(client, id, row);
      },
      { readOnly: true },
    );
  }

  async findUpload(id: string): Promise<Upload | null> {
    const { rows } = await this.#database.query<ResultRow<Upload>>(
      'select file_name as "fileName", content from uploaded_file where id = $1',
      [id],
    );
    return rows[0] ?? null;
  }

  find(id: string): Promise<StoredFile | null> {
    return inTransaction(
      this.#database,
      async (client) => {
        const { rows } = await client.query<ResultRow<FileRow & ReadingRow>>(
          `select f.id, f.file_name as "fileName",
             r.outcome, r.p6_version as "p6Version", r.notes, r.reason, r.line
           from uploaded_file f join file_reading r on r.file_id = f.id
           where f.id = $1`,
          [id],
        );
        const row = rows[0];
        if (row === undefined) {
          return null;
        }
        return {
          id: row.id,
          fileName: row.fileName,
          result: await analysisOf(client, row.id, row),
        };
      },
      { readOnly: true },
    );
  }

  #replaceReading(
    id: string,
    reading: ParseResult,
    hoursPerDay: number | null,
    deleteOldReading: QueryConfig,
  ): Promise<boolean> {
    return inTransaction(this.#database, async (client) => {
      const { rowCount } = await client.query(deleteOldReading);
      if (rowCount === 0) {
        return false;
      }
      await insertReading(client, id, reading, hoursPerDay);
      return true;
    });
  }
}

async function insertReading(
  client: PoolClient,
  fileId: string,
  reading: ParseResult,
  hoursPerDay: number | null,
): Promise<void> {
  const parsed = reading.kind === "parsed" ? reading : null;
  await client.query(
    `insert into file_reading
       (file_id, reader_version, outcome, hours_per_day, p6_version, notes, reason, line)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      fileId,
      READER_VERSION,
      reading.kind,
      hoursPerDay,
      storable(parsed?.p6Version ?? null),
      storable(parsed?.notes ?? null),
      storable(reading.kind === "rejected" ? reading.reason : null),
      reading.kind === "parsed" ? null : reading.line,
    ],
  );
  if (parsed !== null) {
    await insertRows(client, fileId, PROJECT_TABLE, parsed.projects);
    await insertRows(client, fileId, ACTIVITY_TABLE, parsed.activities);
    await insertRows(client, fileId, RELATIONSHIP_TABLE, parsed.links);
    await insertRows(client, fileId, BROKEN_ROW_TABLE, parsed.broken);
  }
}

async function analysisOf(
  client: PoolClient,
  fileId: string,
  reading: ReadingRow,
): Promise<Analysis> {
  switch (reading.outcome) {
    case "rejected":
      return { kind: "rejected", reason: reading.reason, line: reading.line };
    case "needs-hours-per-day":
      return { kind: "needs-hours-per-day", line: reading.line };
    case "parsed":
      return checkSchedule(await readSchedule(client, fileId, reading));
  }
}

async function readSchedule(
  client: PoolClient,
  fileId: string,
  reading: { readonly p6Version: string; readonly notes: readonly Note[] },
): Promise<ParsedSchedule> {
  return {
    kind: "parsed",
    p6Version: reading.p6Version,
    projects: await selectRows(client, fileId, PROJECT_TABLE),
    activities: await selectRows(client, fileId, ACTIVITY_TABLE),
    links: await selectRows(client, fileId, RELATIONSHIP_TABLE),
    broken: await selectRows(client, fileId, BROKEN_ROW_TABLE),
    notes: reading.notes,
  };
}

async function insertRows<Row>(
  client: PoolClient,
  fileId: string,
  table: Table<Row>,
  rows: readonly Row[],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const columns = table.columns.map(([column]) => column).join(", ");
  const arrays = table.columns.map(([, , type], index) => `$${index + 2}::${type}[]`).join(", ");
  await client.query(
    `insert into ${table.name} (file_id, ${columns}) select $1, * from unnest(${arrays})`,
    [fileId, ...table.columns.map(([, field]) => rows.map((row) => storable(row[field])))],
  );
}

async function selectRows<Row>(
  client: PoolClient,
  fileId: string,
  table: Table<Row>,
): Promise<Row[]> {
  const fields = table.columns.map(([column, field]) => `${column} as "${field}"`).join(", ");
  const { rows } = await client.query<ResultRow<Row>>(
    `select ${fields} from ${table.name} where file_id = $1 order by line`,
    [fileId],
  );
  return rows;
}

function storable(value: unknown): unknown {
  if (typeof value === "string") {
    return withoutNul(value);
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "string" ? withoutNul(item) : item,
    );
  }
  return value;
}

function withoutNul(text: string): string {
  return text.replaceAll("\0", "�");
}

function sha256(content: Uint8Array): Buffer {
  return createHash("sha256").update(content).digest();
}
