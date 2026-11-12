import { readdir, readFile } from "node:fs/promises";
import { Pool, type PoolClient, type PoolConfig } from "pg";

const MIGRATIONS = new URL("./migrations/", import.meta.url);
const MIGRATION_LOCK_KEY = 607_001;
const CONNECTION_TIMEOUT_MS = 10_000;

export type Database = Pool;

export function connect(config: PoolConfig): Database {
  const pool = new Pool({ connectionTimeoutMillis: CONNECTION_TIMEOUT_MS, ...config });
  pool.on("error", (error) => {
    console.error("An idle database connection failed.", error);
  });
  return pool;
}

export async function migrate(database: Database): Promise<void> {
  await inTransaction(database, async (client) => {
    await client.query("select pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(
      "create table if not exists schema_migration (name text primary key, applied_at timestamptz not null default now())",
    );
    const { rows } = await client.query<{ name: string }>("select name from schema_migration");
    const applied = new Set(rows.map((row) => row.name));
    for (const name of await migrationNames()) {
      if (!applied.has(name)) {
        await client.query(await readFile(new URL(name, MIGRATIONS), "utf8"));
        await client.query("insert into schema_migration (name) values ($1)", [name]);
      }
    }
  });
}

interface TransactionOptions {
  readonly readOnly?: boolean;
}

export async function inTransaction<T>(
  database: Database,
  work: (client: PoolClient) => Promise<T>,
  { readOnly = false }: TransactionOptions = {},
): Promise<T> {
  const client = await database.connect();
  try {
    await client.query(readOnly ? "begin isolation level repeatable read read only" : "begin");
    const result = await work(client);
    await client.query("commit");
    client.release();
    return result;
  } catch (error) {
    await client.query("rollback").then(
      () => client.release(),
      () => client.release(true),
    );
    throw error;
  }
}

async function migrationNames(): Promise<string[]> {
  const names = await readdir(MIGRATIONS);
  return names.filter((name) => name.endsWith(".sql")).sort();
}
